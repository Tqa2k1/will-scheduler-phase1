import { prisma } from "@/lib/prisma";
import { resolveWorkTime } from "@/lib/workTime";
import { shiftWindow, toMinutes } from "@/lib/shiftRequirements";

// 月間の「確定済み実労働時間」（休憩を差し引いた時間）の計算。
//
// 休憩の求め方（優先順）:
//  1) その従業員・その勤務日に日別スケジュールの割り当て(DailyAssignment)が1件でもあれば、
//     業務コード BREAK の割り当ての合計時間を休憩とする（実際に配置された休憩）。日跨ぎ勤務は翌日の明け側も含める。
//  2) 日別スケジュール未作成なら、自動割当てと同じルールで見積もる:
//     勤務7時間以上 → 日勤1時間 / 22時開始（明番）2時間、7時間未満 → 0。
// ※ Break テーブル（旧設計）はどこからも書き込まれていないため使用しない。
export const MANDATORY_BREAK_MIN_SHIFT_HOURS = 7;

export function grossMinutesOf(start: string, end: string): number {
  const w = shiftWindow(start, end);
  return w.end - w.start;
}

export function ruleBreakMinutes(start: string, end: string, shiftCode?: string | null): number {
  const gross = grossMinutesOf(start, end);
  if (gross < MANDATORY_BREAK_MIN_SHIFT_HOURS * 60) return 0;
  const isNight = shiftCode === "明番" || Math.floor(toMinutes(start) / 60) === 22;
  return isNight ? 120 : 60;
}

export function netMinutesOf(gross: number, breakMinutes: number): number {
  return Math.max(0, gross - breakMinutes);
}

function slotMinutes(a: { slotStart: string; slotEnd: string }): number {
  let m = toMinutes(a.slotEnd) - toMinutes(a.slotStart);
  if (m <= 0) m += 1440;
  return m;
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export type MonthWorked = { days: number; minutes: number };

// 指定月の確定済み(WORK)勤務を従業員ごとに集計（日数・休憩控除後の実労働分）
export async function getMonthNetMinutes(year: number, month: number): Promise<Record<string, MonthWorked>> {
  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));
  const carryEnd = new Date(Date.UTC(year, month, 2));

  const [entries, assignments] = await Promise.all([
    prisma.monthRoster.findMany({
      where: { workDate: { gte: rangeStart, lt: rangeEnd }, status: "WORK", employee: { isActive: true } },
      include: { shiftType: true, employee: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { workDate: { gte: rangeStart, lt: carryEnd } },
      include: { cartPosition: { select: { code: true } } },
    }),
  ]);

  // employeeId|date → { any: 割り当てあり, breakMin: BREAKの合計分, breaks: [{slotStart, min}] }
  const byKey = new Map<string, { any: boolean; breaks: { slotStart: string; min: number }[] }>();
  for (const a of assignments) {
    const k = `${a.employeeId}|${dateKey(a.workDate)}`;
    const v = byKey.get(k) ?? { any: false, breaks: [] };
    v.any = true;
    if (a.cartPosition.code === "BREAK") v.breaks.push({ slotStart: a.slotStart, min: slotMinutes(a) });
    byKey.set(k, v);
  }

  const result: Record<string, MonthWorked> = {};
  for (const e of entries) {
    const t = resolveWorkTime({
      overrideStartTime: e.overrideStartTime,
      overrideEndTime: e.overrideEndTime,
      shiftType: e.shiftType,
      baseStartTime: e.employee.baseStartTime,
      baseEndTime: e.employee.baseEndTime,
    });
    if (!t) continue;
    const gross = grossMinutesOf(t.start, t.end);
    const w = shiftWindow(t.start, t.end);
    const overnight = w.end > 1440;
    const day = dateKey(e.workDate);
    const next = dateKey(new Date(e.workDate.getTime() + 86400000));

    const today = byKey.get(`${e.employeeId}|${day}`);
    const tomorrow = overnight ? byKey.get(`${e.employeeId}|${next}`) : undefined;
    let breakMin: number;
    if (today?.any || tomorrow?.any) {
      breakMin = (today?.breaks ?? []).reduce((s, b) => s + b.min, 0);
      if (overnight) {
        const endMin = w.end - 1440; // 翌日の終了時刻（分）
        breakMin += (tomorrow?.breaks ?? []).filter((b) => toMinutes(b.slotStart) < endMin).reduce((s, b) => s + b.min, 0);
      }
    } else {
      breakMin = ruleBreakMinutes(t.start, t.end, e.shiftType?.code);
    }
    const cur = result[e.employeeId] ?? { days: 0, minutes: 0 };
    cur.days += 1;
    cur.minutes += netMinutesOf(gross, breakMin);
    result[e.employeeId] = cur;
  }
  return result;
}
