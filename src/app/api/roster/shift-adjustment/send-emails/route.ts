import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMailMode, sendAvailabilityCheckEmail } from "@/lib/mailer";
import { formatDateJp, monthLabel } from "@/lib/shortageMail";
import { z } from "zod";

const InputSchema = z.object({
  month: z.string(), // "2026-09"
  selections: z.array(
    z.object({
      employeeId: z.string(),
      date: z.string(),
      shiftLabel: z.string(),
      shiftTypeId: z.string().optional(), // 依頼を ShiftClaimRequest として記録するために使用
    })
  ),
});

// POST /api/roster/shift-adjustment/send-emails
// STEP4「シフト調整」の2回目メール（勤務可否のご確認）。
// Adminが確認・選択した候補者について、不足している日時ごとに1通ずつ個別に送る
// （件名・本文が日時単位のため。1人が複数の日時の候補なら、その日時の数だけ届く）。
// メール未登録の従業員は送信をスキップする（依頼の記録も作らない）。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "メール送信は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const { month, selections } = parsed.data;
    console.log(`[shift-adjustment/send-emails] 選択された件数: ${selections.length}`);

    if (selections.length === 0) {
      return NextResponse.json({ sent: 0, skippedNoEmail: 0, failed: 0, failures: [], error: "送信対象が選択されていません" }, { status: 400 });
    }

    const mode = getMailMode();
    const mLabel = monthLabel(month);

    const employeeIds = [...new Set(selections.map((s) => s.employeeId))];
    const shiftTypeIds = [...new Set(selections.map((s) => s.shiftTypeId).filter((x): x is string => !!x))];
    const [employees, shiftTypes] = await Promise.all([
      prisma.employee.findMany({ where: { id: { in: employeeIds } } }),
      prisma.shiftType.findMany({ where: { id: { in: shiftTypeIds } } }),
    ]);
    const employeeById = new Map(employees.map((e): [string, typeof e] => [e.id, e]));
    const shiftTypeById = new Map(shiftTypes.map((s): [string, typeof s] => [s.id, s]));
    console.log(`[shift-adjustment/send-emails] 対象従業員数: ${employeeIds.length}件、DBから取得できた数: ${employees.length}件`);

    // 勤務時間の表示用ラベル。シフト名（早番など）は出さず、時間のみ使う。
    function timeLabelOf(s: { shiftTypeId?: string; shiftLabel: string }): string {
      const st = s.shiftTypeId ? shiftTypeById.get(s.shiftTypeId) : undefined;
      if (st) return `${st.defaultStartTime}〜${st.defaultEndTime}`;
      const m = s.shiftLabel.match(/(\d{1,2}:\d{2})\s*[〜~～-]\s*(\d{1,2}:\d{2})/);
      return m ? `${m[1]}〜${m[2]}` : s.shiftLabel;
    }

    let sent = 0;
    let failed = 0;
    const failures: string[] = [];
    const recipientMap = new Map<string, { employeeId: string; employeeName: string; email: string }>();
    const skippedSet = new Set<string>();
    let skippedNoEmail = 0;

    for (const s of selections) {
      const employee = employeeById.get(s.employeeId);
      if (!employee) {
        console.warn(`[shift-adjustment/send-emails] 従業員が見つかりません: ${s.employeeId}`);
        continue;
      }
      if (!employee.contactEmail) {
        console.warn(`[shift-adjustment/send-emails] 連絡先メール未登録のためスキップ: ${employee.fullName}`);
        if (!skippedSet.has(employee.id)) {
          skippedSet.add(employee.id);
          skippedNoEmail++;
        }
        continue;
      }

      const result = await sendAvailabilityCheckEmail({
        to: employee.contactEmail,
        employeeName: employee.fullName,
        monthLabel: mLabel,
        dateLabel: formatDateJp(s.date),
        timeLabel: timeLabelOf(s),
      });
      if (!result.ok) {
        console.error(`[shift-adjustment/send-emails] 送信失敗: ${employee.fullName} ${s.date} — ${result.reason}`);
        failed++;
        failures.push(`${employee.fullName}（${s.date}）: ${result.reason}`);
        continue;
      }
      sent++;
      recipientMap.set(employee.id, { employeeId: employee.id, employeeName: employee.fullName, email: employee.contactEmail });

      // 送信できたものだけ「招待済み・未回答」(INVITED) として記録する（次回の候補者検索から除外し、
      // 同じ日時への二重依頼を防ぐ）。メール未登録・送信失敗の人は記録しないので、候補に残る。
      // 既に記録がある場合（P2002: employeeId+workDate の一意制約）は何もしない。
      try {
        await prisma.shiftClaimRequest.create({
          data: {
            employeeId: s.employeeId,
            workDate: new Date(s.date + "T00:00:00Z"),
            shiftTypeId: s.shiftTypeId ?? null,
            status: "INVITED",
          },
        });
      } catch (err: any) {
        if (err?.code !== "P2002") {
          console.error(`[shift-adjustment/send-emails] 依頼記録の作成に失敗: ${s.employeeId} ${s.date}`, err);
        }
      }
    }

    const skippedNames = [...skippedSet].map((id) => employeeById.get(id)?.fullName ?? id);
    console.log(`[shift-adjustment/send-emails] 結果 — 成功:${sent}通 未登録スキップ:${skippedNoEmail}名 失敗:${failed}通 mode=${mode}`);
    return NextResponse.json({
      sent, // 送信できたメールの通数
      sentPeople: recipientMap.size,
      skippedNoEmail,
      failed,
      failures,
      recipients: [...recipientMap.values()],
      skippedNames,
      mode,
    });
  } catch (err) {
    console.error("[shift-adjustment/send-emails] 予期しないエラー:", err);
    return NextResponse.json(
      { error: "メール送信処理中にエラーが発生しました", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
