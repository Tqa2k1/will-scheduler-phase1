import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isManagerRole } from "@/lib/roles";
import { confirmMonthShiftAdjustment } from "@/lib/monthlyShiftGap";
import { getRegistrationDeadline, getShortageRecipients, monthLabel, parseMonth, needsMailSend } from "@/lib/shortageMail";
import { getMailMode, isMailAllowed, getMailAllowlist, sendShortageRequestEmail } from "@/lib/mailer";
import { writeAudit } from "@/lib/auditLog";
import { z } from "zod";

const Input = z.object({
  month: z.string(), // "2026-11"
  // true: 確定後に1回目のGmail（勤務希望登録のお願い）をバイトの従業員へ送る / false: 送らずに確定だけ行う
  notify: z.boolean().default(true),
});

const SEND_LOCK_STALE_MS = 10 * 60 * 1000;

// 「月×従業員」の送信権を、DBの一意制約と条件付き更新で1つの処理だけが取れるようにする（同時実行での二重送信を防ぐ）。
async function claimSendSlot(month: string, emp: { id: string; fullName: string }, mode: string): Promise<boolean> {
  const existing = await prisma.shortageMailLog.findUnique({ where: { month_employeeId: { month, employeeId: emp.id } } });
  if (!existing) {
    try {
      await prisma.shortageMailLog.create({ data: { month, employeeId: emp.id, employeeName: emp.fullName, status: "SENDING", attempts: 1 } });
      return true;
    } catch (e: any) {
      if (e?.code === "P2002") return false; // 別の処理が先に取得した
      throw e;
    }
  }
  if (!needsMailSend(existing, mode)) return false;
  const upd = await prisma.shortageMailLog.updateMany({
    where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
    data: { status: "SENDING", attempts: { increment: 1 }, reason: null },
  });
  return upd.count === 1;
}

// POST /api/shortage/confirm （INC/管理者のみ）
// STEP1「人員不足を確定」。不足している日付・時間帯・人数を確定（スナップショット保存）し、
// 役割が「バイト」(PARTTIME) の従業員にのみ1回目のGmailを送る。
//  - 再実行しても、送信成功済みの従業員には再送しない（未送信・送信失敗の人だけ送る）
//  - メール未登録者はスキップ。結果（成功・失敗と理由・スキップ）を返し、従業員ごとに DB へ記録する
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "人員不足の確定はINC（管理者）のみ可能です" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });
  const { month, notify } = parsed.data;

  const p = parseMonth(month);
  const deadline = getRegistrationDeadline(month);
  if (!p || !deadline) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  const actor = session.user.email ?? session.user.id ?? "unknown";

  const snapshot = await confirmMonthShiftAdjustment(p.year, p.mon, actor);
  const dateCount = Object.keys(snapshot.shortagesByDate).length;
  const totalShortage = Object.values(snapshot.shortagesByDate).reduce((sum, d) => sum + d.totalShortage, 0);
  await writeAudit(prisma, { tableName: "ShiftAdjustmentConfirmation", recordId: month, action: "SHORTAGE_CONFIRM", changedBy: actor, newValue: { dateCount, totalShortage, notify } });

  if (!notify || totalShortage === 0) {
    return NextResponse.json({
      confirmed: true,
      dateCount,
      totalShortage,
      notified: false,
      reason: totalShortage === 0 ? "人員不足がないため、メールは送信していません" : "メールは送信せずに確定しました",
    });
  }

  const recipients = await getShortageRecipients();
  const mode = getMailMode();
  const registerUrl = `${process.env.NEXTAUTH_URL ?? ""}/shift-requests/register?month=${month}`;
  const allowlistActive = !!getMailAllowlist();
  const excludedByAllowlist = recipients.withEmail.filter((e) => !isMailAllowed(e.contactEmail!)).map((e) => e.fullName);
  const targets = recipients.withEmail.filter((e) => isMailAllowed(e.contactEmail!));

  const sentNames: string[] = [];
  const alreadySentNames: string[] = [];
  const failures: { name: string; reason: string }[] = [];

  for (const emp of targets) {
    const got = await claimSendSlot(month, emp, mode);
    if (!got) {
      alreadySentNames.push(emp.fullName);
      continue;
    }
    let r: { ok: boolean; reason?: string; mode: string };
    try {
      r = await sendShortageRequestEmail({ to: emp.contactEmail!, monthLabel: monthLabel(month), deadlineLabel: deadline.label, registerUrl });
    } catch (e: any) {
      r = { ok: false, reason: String(e?.message ?? e), mode };
    }
    await prisma.shortageMailLog.update({
      where: { month_employeeId: { month, employeeId: emp.id } },
      data: r.ok
        ? { status: "SENT", mode: r.mode, reason: null, sentAt: new Date(), sentBy: actor }
        : { status: "FAILED", mode: r.mode, reason: (r.reason ?? "不明なエラー").slice(0, 300) },
    });
    if (r.ok) sentNames.push(emp.fullName);
    else failures.push({ name: emp.fullName, reason: (r.reason ?? "不明なエラー").slice(0, 300) });
  }

  const skippedNoEmail = recipients.skipped.map((e) => e.fullName);
  const result = {
    mode,
    allowlistActive,
    targetTotal: recipients.total,
    sent: sentNames.length,
    sentNames,
    alreadySent: alreadySentNames.length,
    alreadySentNames,
    failures,
    skippedNoEmail,
    excludedByAllowlist,
    at: new Date().toISOString(),
  };
  console.log(`[shortage/confirm] ${month} mode=${mode} 送信:${result.sent} 送信済みのため除外:${result.alreadySent} 失敗:${failures.length} メール未登録:${skippedNoEmail.length}`);

  const anySent = (await prisma.shortageMailLog.count({ where: { month, status: "SENT" } })) > 0;
  await prisma.shiftAdjustmentConfirmation.update({
    where: { month },
    data: { notifyResult: result as any, ...(anySent ? { notifiedAt: new Date(), notifiedBy: actor } : {}) },
  });
  await writeAudit(prisma, {
    tableName: "ShortageMailLog",
    recordId: month,
    action: "SHORTAGE_MAIL_SEND",
    changedBy: actor,
    newValue: { mode, sent: result.sent, failed: failures.length, alreadySent: result.alreadySent, skippedNoEmail: skippedNoEmail.length },
  });

  return NextResponse.json({ confirmed: true, dateCount, totalShortage, notified: true, ...result });
}
