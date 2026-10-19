import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendScheduleConfirmedEmail, getMailMode } from "@/lib/mailer";
import { buildScheduleConfirmedMail } from "@/lib/mailTemplates";
import { finishDelivery, getMonthStatusInfo, listRecipients, startDelivery } from "@/lib/monthStatus";
import { isValidMonth, type DeliveryFailure, type DeliverySkipped } from "@/lib/monthStatusShared";
import { z } from "zod";

const InputSchema = z.object({
  month: z.string(), // "2026-08"
  // 送信対象を絞る場合のみ指定（省略時はメール登録済みの全従業員）
  employeeIds: z.array(z.string()).optional(),
  // true: 前回送信済みの人にも送り直す（false: 同じシフト内容で前回成功した人は飛ばす＝二重送信防止）
  resendAll: z.boolean().optional().default(false),
});

function labelOf(month: string) {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}
function loginUrl() {
  return `${process.env.NEXTAUTH_URL ?? ""}/login`;
}

// GET /api/roster/confirm-month?month=2026-10 — 配信前の確認用（管理者・INCのみ）
// 月の状態 / 配信対象者と送信状況 / メール文面のプレビュー / 送信モード を返す。メールは送信しない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "この操作は管理者のみ可能です" }, { status: 403 });
  const month = req.nextUrl.searchParams.get("month");
  if (!isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const [monthStatus, recipients] = await Promise.all([getMonthStatusInfo(month, true), listRecipients(month)]);
  const sample = recipients.find((r) => r.email) ?? null;
  const preview = buildScheduleConfirmedMail({
    employeeName: sample?.fullName ?? "（従業員名）",
    monthLabel: labelOf(month),
    loginUrl: loginUrl(),
  });
  return NextResponse.json({ monthStatus, recipients, preview, mailMode: getMailMode() });
}

// POST /api/roster/confirm-month — 「メール配信」。
// 全員への送信が正常に完了したときだけ、その月を「確定」にする。1通でも失敗したら確定にしない（調整中のまま）。
// 確定済みの月でも、再配信が必要な（調整中に戻った）月は同じ手順で再度「確定」にする。
// メールアドレスが未登録の従業員には送信しない。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "スケジュールの確定は管理者のみ可能です" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { month, employeeIds, resendAll } = parsed.data;
  if (!isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const actor = session.user.email ?? null;
  const all = await prisma.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } });
  const withEmail = all.filter((e) => !!e.contactEmail);
  const skippedNoEmail: DeliverySkipped[] = all.filter((e) => !e.contactEmail).map((e) => ({ employeeId: e.id, employeeName: e.fullName }));

  const start = await startDelivery(month, resendAll);
  const selected = employeeIds ? new Set(employeeIds) : null;
  const toSend = withEmail.filter((e) => (!selected || selected.has(e.id)) && !start.alreadySentIds.has(e.id));

  const monthLabel = labelOf(month);
  const sentNow: string[] = [];
  const failures: DeliveryFailure[] = [];
  let mode: string | null = null;
  for (const emp of toSend) {
    const result = await sendScheduleConfirmedEmail({ to: emp.contactEmail!, employeeName: emp.fullName, month: monthLabel, loginUrl: loginUrl() });
    mode = result.mode;
    if (result.ok) sentNow.push(emp.id);
    else {
      console.log("MAIL ERROR:", result.reason);
      failures.push({ employeeId: emp.id, employeeName: emp.fullName, reason: result.reason ?? "送信に失敗しました" });
    }
  }
  if (!mode) mode = getMailMode();

  // 前回までに送信済み（同じシフト内容）の人も「送信済み」に含める。ただし今回の送信対象から外れた人は含めない理由はない。
  const sentEmployeeIds = [...new Set([...start.alreadySentIds].filter((id) => withEmail.some((e) => e.id === id)).concat(sentNow))];
  const outcome = await finishDelivery({
    month,
    by: actor,
    startRevision: start.revision,
    mode,
    sentEmployeeIds,
    failures,
    skippedNoEmail,
    targetCount: withEmail.length,
  });

  return NextResponse.json({
    confirmed: outcome.confirmed,
    status: outcome.status,
    reason: outcome.reason,
    mode,
    totalEligible: withEmail.length,
    sent: sentNow.length,
    alreadySent: start.alreadySentIds.size,
    failed: failures.length,
    skippedNoEmail: skippedNoEmail.length,
    failures,
    monthStatus: await getMonthStatusInfo(month, true),
    recipients: await listRecipients(month),
  });
}
