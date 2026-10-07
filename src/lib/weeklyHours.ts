import { prisma } from "@/lib/prisma";
import { resolveWorkTime } from "@/lib/workTime";

// 週の範囲（日曜〜土曜）を計算する。dateが週の途中でもその週全体を返す。
export function getWeekRange(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const dow = d.getUTCDay(); // 0=日曜
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - dow);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return { weekStart, weekEnd };
}

// 指定した日を含む週（日〜土）に、その従業員が既に登録されている合計勤務時間を計算する。
// アルバイト（PARTTIME）の週20時間上限チェックに使用。
export async function getWeeklyScheduledHours(employeeId: string, date: Date): Promise<number> {
  const { weekStart, weekEnd } = getWeekRange(date);
  const weekEndExclusive = new Date(weekEnd);
  weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 1);

  const [employee, entries] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.monthRoster.findMany({
      where: { employeeId, status: "WORK", workDate: { gte: weekStart, lt: weekEndExclusive } },
      include: { shiftType: true },
    }),
  ]);

  let totalHours = 0;
  for (const entry of entries) {
    const resolved = resolveWorkTime({
      overrideStartTime: entry.overrideStartTime,
      overrideEndTime: entry.overrideEndTime,
      shiftType: entry.shiftType,
      baseStartTime: employee?.baseStartTime,
      baseEndTime: employee?.baseEndTime,
    });
    if (!resolved) continue;
    const [sh, sm] = resolved.start.split(":").map(Number);
    const [eh, em] = resolved.end.split(":").map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes < 0) minutes += 24 * 60; // 日をまたぐシフト
    totalHours += minutes / 60;
  }
  return totalHours;
}

export const PARTTIME_WEEKLY_HOUR_LIMIT = 20;

// アルバイトが、指定日に追加でshiftHours時間の勤務を新たに割り当てても週20時間を超えないか確認する。
// アルバイト以外は常にtrue（上限なし）。
export async function isWithinPartTimeWeeklyLimit(
  employeeId: string,
  employeeRole: string,
  date: Date,
  additionalHours: number
): Promise<boolean> {
  if (employeeRole !== "PARTTIME") return true;
  const currentHours = await getWeeklyScheduledHours(employeeId, date);
  return currentHours + additionalHours <= PARTTIME_WEEKLY_HOUR_LIMIT;
}
