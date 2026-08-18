import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SHIFT_WINDOWS, getShiftWindowStatus, findEligibleEmployeesForWindow } from "@/lib/shiftWindowStaffing";
import { sendShiftAdjustmentEmail } from "@/lib/mailer";
import { z } from "zod";

const LOOKAHEAD_DAYS = 30;

// GET /api/shift-adjustment?date=2026-08-20 — 指定日の3ダイヤ（早番/遅番/明番）の充足状況
// GET /api/shift-adjustment（dateなし）— 今後30日のうち、いずれかのダイヤが不足している日の一覧
// 管理者のみ（admin向け「シフト調整」画面用）。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "この画面は管理者のみ利用できます" }, { status: 403 });
  }

  const dateParam = req.nextUrl.searchParams.get("date");

  if (dateParam) {
    const workDate = new Date(dateParam);
    const windows = await getShiftWindowStatus(workDate);
    return NextResponse.json({ date: dateParam, windows });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const results: { date: string; windows: Awaited<ReturnType<typeof getShiftWindowStatus>> }[] = [];
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const windows = await getShiftWindowStatus(d);
    if (windows.some((w) => w.shortage > 0)) {
      results.push({ date: d.toISOString().slice(0, 10), windows });
    }
  }

  return NextResponse.json({ dates: results });
}

const AdjustInput = z.object({
  date: z.string(),
  windowCode: z.enum(["早番", "遅番", "明番"]),
});

// POST /api/shift-adjustment — 「シフト調整」ボタン。指定日・指定ダイヤの不足を確認し、
// 出勤できそうな従業員に希望勤務(KIBO)登録を促すメールを送る（管理者のみ）。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "この操作は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AdjustInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const window = SHIFT_WINDOWS.find((w) => w.code === parsed.data.windowCode);
  if (!window) return NextResponse.json({ error: "不明なダイヤです" }, { status: 400 });

  const workDate = new Date(parsed.data.date);
  const status = await getShiftWindowStatus(workDate);
  const target = status.find((s) => s.code === window.code)!;
  if (target.shortage <= 0) {
    return NextResponse.json({ error: "このダイヤは既に必要人数を満たしています" }, { status: 400 });
  }

  const eligible = await findEligibleEmployeesForWindow(workDate, window);
  if (eligible.length === 0) {
    return NextResponse.json({ sentCount: 0, recipients: [], message: "送信対象の候補者が見つかりませんでした" });
  }

  const loginUrl = process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/shift-requests` : "/shift-requests";
  const dateLabel = `${workDate.getUTCFullYear()}年${workDate.getUTCMonth() + 1}月${workDate.getUTCDate()}日`;
  const windowLabel = `${window.code}（${window.startTime}〜${window.endTime}）`;

  const results = await Promise.all(
    eligible.map((e) =>
      sendShiftAdjustmentEmail({ to: e.contactEmail, employeeName: e.fullName, dateLabel, windowLabel, loginUrl }).then(
        (r) => ({ employeeId: e.id, fullName: e.fullName, ...r })
      )
    )
  );

  const sent = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  await prisma.rosterAuditLog.create({
    data: {
      tableName: "ShiftAdjustment",
      recordId: parsed.data.date,
      action: "SHIFT_ADJUSTMENT_EMAIL_SENT",
      changedBy: session.user.email ?? undefined,
      newValue: {
        windowCode: window.code,
        sentTo: sent.map((r) => r.employeeId),
        failedTo: failed.map((r) => r.employeeId),
      },
    },
  });

  return NextResponse.json({
    sentCount: sent.length,
    recipients: sent.map((r) => ({ id: r.employeeId, fullName: r.fullName })),
    failedCount: failed.length,
  });
}
