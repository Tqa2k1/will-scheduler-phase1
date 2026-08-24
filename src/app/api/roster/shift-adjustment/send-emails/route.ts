import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendKiboInviteEmail } from "@/lib/mailer";
import { z } from "zod";

const InputSchema = z.object({
  month: z.string(), // "2026-09"
  selections: z.array(
    z.object({
      employeeId: z.string(),
      date: z.string(),
      shiftLabel: z.string(),
    })
  ),
});

// POST /api/roster/shift-adjustment/send-emails
// Adminが確認・選択した候補者（selections）に対して、従業員ごとにまとめて1通のメールを送る。
// 1人が複数シフトの候補になっている場合、その人のメールにはその人の分だけをまとめて記載する。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
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

    const [year, mon] = month.split("-").map(Number);
    const monthLabel = `${year}年${mon}月`;

    // 従業員ごとにシフトをまとめる
    const shiftsByEmployee = new Map<string, { date: string; shiftLabel: string }[]>();
    for (const s of selections) {
      if (!shiftsByEmployee.has(s.employeeId)) shiftsByEmployee.set(s.employeeId, []);
      shiftsByEmployee.get(s.employeeId)!.push({ date: s.date, shiftLabel: s.shiftLabel });
    }

    const employeeIds = [...shiftsByEmployee.keys()];
    const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } } });
    const employeeById = new Map(employees.map((e): [string, typeof e] => [e.id, e]));
    console.log(`[shift-adjustment/send-emails] 対象従業員数: ${employeeIds.length}件、DBから取得できた数: ${employees.length}件`);

    const baseUrl = process.env.NEXTAUTH_URL ?? "";
    const loginUrl = `${baseUrl}/shift-requests`;

    let sent = 0;
    let skippedNoEmail = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const [employeeId, shifts] of shiftsByEmployee) {
      const employee = employeeById.get(employeeId);
      if (!employee) {
        console.warn(`[shift-adjustment/send-emails] 従業員が見つかりません: ${employeeId}`);
        continue;
      }
      if (!employee.contactEmail) {
        console.warn(`[shift-adjustment/send-emails] 連絡先メール未登録のためスキップ: ${employee.fullName}`);
        skippedNoEmail++;
        continue;
      }
      const result = await sendKiboInviteEmail({
        to: employee.contactEmail,
        employeeName: employee.fullName,
        month: monthLabel,
        shifts,
        loginUrl,
      });
      if (result.ok) {
        sent++;
      } else {
        console.error(`[shift-adjustment/send-emails] 送信失敗: ${employee.fullName} — ${result.reason}`);
        failed++;
        failures.push(`${employee.fullName}: ${result.reason}`);
      }
    }

    console.log(`[shift-adjustment/send-emails] 結果 — 成功:${sent} 未登録スキップ:${skippedNoEmail} 失敗:${failed}`);
    return NextResponse.json({ sent, skippedNoEmail, failed, failures });
  } catch (err) {
    console.error("[shift-adjustment/send-emails] 予期しないエラー:", err);
    return NextResponse.json(
      { error: "メール送信処理中にエラーが発生しました", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
