import { prisma } from "@/lib/prisma";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";

// 月次シフト調整で対象とする3つのシフト（既存のShiftTypeをそのまま使う。新規作成しない）。
// 08:00-17:00=早番、13:00-22:00=遅番、22:00-08:00=明番。各シフト1日4名が必要（合計12名/日）。
export const MONTHLY_SHIFT_CODES = ["早番", "遅番", "明番"] as const;
export const REQUIRED_PER_SHIFT = 4;

export type ShiftGap = {
  date: string; // "2026-09-03"
  shiftTypeId: string;
  shiftTypeCode: string;
  shiftLabel: string; // "08:00〜17:00"
  required: number;
  current: number;
  shortage: number;
};

export type ShiftGapWithCandidates = ShiftGap & {
  candidates: { employeeId: string; employeeName: string }[];
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// 指定した月について、3シフト×全日をチェックし、不足しているシフトの一覧を返す。
// 「22:00〜08:00」は開始日1日分のシフトとして扱う（既存のMonthRosterの記録方法と同じ。
// 二重カウントしない）。
export async function getMonthShiftGaps(year: number, month: number): Promise<ShiftGap[]> {
  const shiftTypes = await prisma.shiftType.findMany({
    where: { code: { in: [...MONTHLY_SHIFT_CODES] } },
  });
  const shiftTypeByCode = new Map(shiftTypes.map((s): [string, typeof s] => [s.code, s]));

  const numDays = daysInMonth(year, month);
  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));

  // その月の出勤(WORK)予定を、対象シフトごとに（shiftTypeId優先、無ければ開始時刻から推定して）集計する
  const entries = await prisma.monthRoster.findMany({
    where: { workDate: { gte: rangeStart, lt: rangeEnd }, status: "WORK" },
    include: { shiftType: true, employee: true },
  });

  const countByDateAndCode = new Map<string, number>(); // "2026-09-03|早番" -> count
  for (const e of entries) {
    let code: string | null = e.shiftType?.code ?? null;
    if (!code || !MONTHLY_SHIFT_CODES.includes(code as any)) {
      // shiftTypeが未設定の場合、基本勤務時間の開始時刻から推定する
      const startHour = Number((e.overrideStartTime ?? e.employee.baseStartTime ?? "").split(":")[0]);
      if (startHour === 8) code = "早番";
      else if (startHour === 13) code = "遅番";
      else if (startHour === 22) code = "明番";
      else continue; // どのシフトにも該当しない場合は対象外
    }
    const key = `${e.workDate.toISOString().slice(0, 10)}|${code}`;
    countByDateAndCode.set(key, (countByDateAndCode.get(key) ?? 0) + 1);
  }

  const gaps: ShiftGap[] = [];
  for (let d = 1; d <= numDays; d++) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    for (const code of MONTHLY_SHIFT_CODES) {
      const shiftType = shiftTypeByCode.get(code);
      if (!shiftType) continue;
      const current = countByDateAndCode.get(`${dateKey}|${code}`) ?? 0;
      const shortage = Math.max(0, REQUIRED_PER_SHIFT - current);
      if (shortage > 0) {
        gaps.push({
          date: dateKey,
          shiftTypeId: shiftType.id,
          shiftTypeCode: code,
          shiftLabel: `${shiftType.defaultStartTime}〜${shiftType.defaultEndTime}`,
          required: REQUIRED_PER_SHIFT,
          current,
          shortage,
        });
      }
    }
  }
  return gaps;
}

// 指定した1つの不足シフト（date + shiftTypeCode）について、対応可能な候補者を探す。
// 条件: その日にまだ出勤予定(WORK)が入っていない（休み・未設定はOK）、
//       バイトの場合はこのシフトを追加しても週20時間を超えない。
export async function findCandidatesForShift(date: string, shiftTypeCode: string): Promise<{ employeeId: string; employeeName: string }[]> {
  const workDate = new Date(date + "T00:00:00Z");
  const shiftType = await prisma.shiftType.findUnique({ where: { code: shiftTypeCode } });
  if (!shiftType) return [];

  const [employees, existingWorkEntries] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true } }),
    prisma.monthRoster.findMany({ where: { workDate, status: "WORK" } }),
  ]);
  const alreadyWorkingIds = new Set(existingWorkEntries.map((e) => e.employeeId));

  // シフトの時間から勤務時間数を算出（週20時間チェック用）
  const [sh, sm] = shiftType.defaultStartTime.split(":").map(Number);
  const [eh, em] = shiftType.defaultEndTime.split(":").map(Number);
  let shiftHours = eh * 60 + em - (sh * 60 + sm);
  if (shiftHours < 0) shiftHours += 24 * 60;
  shiftHours /= 60;

  const candidates: { employeeId: string; employeeName: string }[] = [];
  for (const emp of employees) {
    if (alreadyWorkingIds.has(emp.id)) continue; // その日すでに出勤予定がある
    const withinLimit = await isWithinPartTimeWeeklyLimit(emp.id, emp.role, workDate, shiftHours);
    if (!withinLimit) continue; // バイトの週20時間上限を超える
    candidates.push({ employeeId: emp.id, employeeName: emp.fullName });
  }
  return candidates;
}
