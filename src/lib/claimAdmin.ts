import { prisma } from "@/lib/prisma";
import { getMonthShiftGaps } from "@/lib/monthlyShiftGap";
import { getMonthNetMinutes } from "@/lib/workedHours";
import { requestMeetsSlot } from "@/lib/claimRules";
import { parseMonth, formatDateJp } from "@/lib/shortageMail";
import { isSelfCanceledBeforeConfirm } from "@/lib/claimStatus";
import { countRequestedByShift, slotKey } from "@/lib/shiftHeadcount";
import { isRegistrationStopped } from "@/lib/claimHold";

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

// INC用: 指定月の勤務希望すべて（全ステータス）＋募集枠（人員不足）の状況。
// 各応募者に「当月の確定済み実労働時間（休憩控除後）」「優先順位」「募集枠の条件を満たすか」を付ける（選定理由が分かるように）。
export async function buildAdminClaimList(month: string) {
  const p = parseMonth(month);
  if (!p) return null;
  const rangeStart = new Date(Date.UTC(p.year, p.mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(p.year, p.mon, 1));

  const [claims, gaps, worked, shiftTypes] = await Promise.all([
    prisma.shiftClaimRequest.findMany({
      where: { workDate: { gte: rangeStart, lt: rangeEnd } },
      include: { employee: true },
      orderBy: [{ workDate: "asc" }, { requestedAt: "asc" }],
    }),
    getMonthShiftGaps(p.year, p.mon),
    getMonthNetMinutes(p.year, p.mon),
    prisma.shiftType.findMany(),
  ]);
  const stById = new Map(shiftTypes.map((s) => [s.id, s]));

  // 勤務希望人数（申請中）は選択したシフト基準で集計し、勤務確定人数（current）とは別に表示する
  const requestedBySlot = countRequestedByShift(
    claims.map((c) => ({ employeeId: c.employeeId, date: dateKey(c.workDate), shiftTypeId: c.shiftTypeId, status: c.status, cancelRequestedAt: c.cancelRequestedAt }))
  );
  const slots = gaps.map((g) => ({
    key: `${g.date}|${g.shiftTypeId}`,
    requested: requestedBySlot.get(slotKey(g.date, g.shiftTypeId)) ?? 0,
    date: g.date,
    dateLabel: formatDateJp(g.date),
    shiftTypeId: g.shiftTypeId,
    shiftLabel: g.shiftLabel,
    required: g.required,
    current: g.current,
    shortage: g.shortage,
  }));

  // 確定前に従業員が即時キャンセルした勤務希望は、INC側の一覧・応募状況・集計には出さない（DBには履歴として残る）
  const visibleClaims = claims.filter((c) => !isSelfCanceledBeforeConfirm(c));
  const rows = visibleClaims.map((c) => {
    const st = c.shiftTypeId ? stById.get(c.shiftTypeId) : undefined;
    const meets = st
      ? requestMeetsSlot({ start: st.defaultStartTime, end: st.defaultEndTime }, { start: c.requestedStartTime, end: c.requestedEndTime })
      : { ok: false, reason: "シフトが未指定の旧形式の申請です" };
    const w = worked[c.employeeId];
    return {
      id: c.id,
      employeeId: c.employeeId,
      employeeName: c.employee.fullName,
      role: c.employee.role,
      priorityOrder: c.employee.priorityOrder,
      date: dateKey(c.workDate),
      dateLabel: formatDateJp(dateKey(c.workDate)),
      shiftTypeId: c.shiftTypeId,
      shiftLabel: st ? `${st.defaultStartTime}〜${st.defaultEndTime}` : "未指定",
      requestedStartTime: c.requestedStartTime,
      requestedEndTime: c.requestedEndTime,
      status: c.status,
      requestedAt: c.requestedAt,
      decidedAt: c.decidedAt,
      decidedBy: c.decidedBy,
      cancelRequestedAt: c.cancelRequestedAt,
      meetsSlot: meets.ok,
      meetsReason: meets.reason ?? null,
      monthNetMinutes: w?.minutes ?? 0,
      monthDays: w?.days ?? 0,
    };
  });

  return { month, claims: rows, slots, registrationStopped: await isRegistrationStopped(month) };
}
