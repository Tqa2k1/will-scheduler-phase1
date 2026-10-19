import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMonthShiftGaps } from "@/lib/monthlyShiftGap";
import { getShortageRecipients, getRegistrationDeadline, parseMonth, formatDateJp, needsMailSend } from "@/lib/shortageMail";
import { countRequestedByShift, slotKey } from "@/lib/shiftHeadcount";
import { getMailMode, isMailAllowed, getMailAllowlist } from "@/lib/mailer";

// GET /api/shortage/preview?month=2026-11 （管理者のみ）
// 「人員不足を確定」の前に、不足日時・締切・1回目メールの送信対象人数・スキップ予定者を確認するためのプレビュー。
// 何も保存・送信しない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "管理者のみ可能です" }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const p = parseMonth(month);
  if (!p) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const mode = getMailMode();
  const rangeStart = new Date(Date.UTC(p.year, p.mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(p.year, p.mon, 1));
  const [gaps, recipients, record, logs, monthClaims] = await Promise.all([
    getMonthShiftGaps(p.year, p.mon),
    getShortageRecipients(),
    prisma.shiftAdjustmentConfirmation.findUnique({ where: { month } }),
    prisma.shortageMailLog.findMany({ where: { month } }),
    prisma.shiftClaimRequest.findMany({ where: { workDate: { gte: rangeStart, lt: rangeEnd } }, select: { employeeId: true, workDate: true, shiftTypeId: true, status: true, cancelRequestedAt: true } }),
  ]);
  // 勤務希望人数（申請中）は、登録時に選択したシフト基準で数える（確定人数とは別）
  const requestedBySlot = countRequestedByShift(monthClaims.map((c) => ({ employeeId: c.employeeId, date: c.workDate.toISOString().slice(0, 10), shiftTypeId: c.shiftTypeId, status: c.status, cancelRequestedAt: c.cancelRequestedAt })));
  const logById = new Map(logs.map((l) => [l.employeeId, l]));
  const allowed = recipients.withEmail.filter((e) => isMailAllowed(e.contactEmail!));
  const willSend = allowed.filter((e) => needsMailSend(logById.get(e.id), mode));
  const alreadySent = allowed.filter((e) => !needsMailSend(logById.get(e.id), mode));
  const failed = allowed.filter((e) => logById.get(e.id)?.status === "FAILED");

  return NextResponse.json({
    month,
    deadline: getRegistrationDeadline(month),
    mailMode: mode,
    gaps: gaps.map((g) => ({
      date: g.date,
      dateLabel: formatDateJp(g.date),
      shiftLabel: g.shiftLabel,
      required: g.required,
      current: g.current,
      requested: requestedBySlot.get(slotKey(g.date, g.shiftTypeId)) ?? 0,
      shortage: g.shortage,
      bandDetails: g.bandDetails ?? [],
    })),
    totalShortage: gaps.reduce((sum, g) => sum + g.shortage, 0),
    recipients: {
      total: recipients.total,
      willSend: willSend.map((e) => e.fullName),
      alreadySent: alreadySent.map((e) => e.fullName),
      previouslyFailed: failed.map((e) => ({ name: e.fullName, reason: logById.get(e.id)?.reason ?? "" })),
      excludedByAllowlist: recipients.withEmail.filter((e) => !isMailAllowed(e.contactEmail!)).map((e) => e.fullName),
      allowlistActive: !!getMailAllowlist(),
      skippedNoEmail: recipients.skipped.map((e) => e.fullName),
    },
    confirmedAt: record?.confirmedAt ?? null,
    notifiedAt: record?.notifiedAt ?? null,
    notifyResult: record?.notifyResult ?? null,
  });
}
