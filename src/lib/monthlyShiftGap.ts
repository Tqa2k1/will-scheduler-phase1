import { prisma } from "@/lib/prisma";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";

// 月次シフト調整で対象とするシフト（既存のShiftTypeをそのまま使う。新規作成しない）。
// 08:00-17:00=早番、13:00-22:00=遅番、22:00-08:00=明番。各シフト1日4名が必要（合計12名/日）。
// 追加: 08:00-14:00=午前番、16:00-22:00=超遅。どちらも不足時は1名必要。
export const MONTHLY_SHIFT_CODES = ["早番", "遅番", "明番", "午前番", "超遅"] as const;
export const REQUIRED_PER_SHIFT = 4; // 既定値（上記マップに無いコード用のフォールバック）
export const REQUIRED_PER_SHIFT_BY_CODE: Record<string, number> = {
  早番: 4,
  遅番: 4,
  明番: 4,
  午前番: 1,
  超遅: 1,
};

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
  candidates: { employeeId: string; employeeName: string; hasEmail: boolean }[];
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
      // shiftTypeが未設定の場合、基本勤務時間の開始・終了時刻から推定する
      // （08時開始は早番/午前番の2つがあるため、終了時刻も見て区別する）
      const startHour = Number((e.overrideStartTime ?? e.employee.baseStartTime ?? "").split(":")[0]);
      const endHour = Number((e.overrideEndTime ?? e.employee.baseEndTime ?? "").split(":")[0]);
      if (startHour === 8 && endHour === 14) code = "午前番";
      else if (startHour === 8) code = "早番";
      else if (startHour === 13) code = "遅番";
      else if (startHour === 16) code = "超遅";
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
      const required = REQUIRED_PER_SHIFT_BY_CODE[code] ?? REQUIRED_PER_SHIFT;
      const shortage = Math.max(0, required - current);
      if (shortage > 0) {
        gaps.push({
          date: dateKey,
          shiftTypeId: shiftType.id,
          shiftTypeCode: code,
          shiftLabel: `${shiftType.defaultStartTime}〜${shiftType.defaultEndTime}`,
          required,
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
//       バイトの場合はこのシフトを追加しても週20時間を超えない、
//       その日について既に依頼を送っていない（返答待ち/承認済み/却下済みのいずれでもない）。
// 表示順: ①役割ごとの優先順位(RolePriority, 既存の仕組み) ②同じ役割内での従業員ごとの優先順位
//        (Employee.priorityOrder, 今回追加)。どちらも数値が小さいほど優先度が高い。
export async function findCandidatesForShift(date: string, shiftTypeCode: string): Promise<{ employeeId: string; employeeName: string; hasEmail: boolean }[]> {
  const workDate = new Date(date + "T00:00:00Z");
  const shiftType = await prisma.shiftType.findUnique({ where: { code: shiftTypeCode } });
  if (!shiftType) return [];

  const [employees, existingWorkEntries, existingClaims, rolePriorities] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true } }),
    prisma.monthRoster.findMany({ where: { workDate, status: "WORK" } }),
    // その日について、状態（返答待ち/承認済み/却下済み）を問わず、既に依頼済みの従業員を除外するため取得する。
    prisma.shiftClaimRequest.findMany({ where: { workDate }, select: { employeeId: true } }),
    prisma.rolePriority.findMany(),
  ]);
  const alreadyWorkingIds = new Set(existingWorkEntries.map((e) => e.employeeId));
  const alreadyRequestedIds = new Set(existingClaims.map((c) => c.employeeId));
  const rolePriorityOf = new Map(rolePriorities.map((p): [string, number] => [p.role, p.priorityOrder]));

  // シフトの時間から勤務時間数を算出（週20時間チェック用）
  const [sh, sm] = shiftType.defaultStartTime.split(":").map(Number);
  const [eh, em] = shiftType.defaultEndTime.split(":").map(Number);
  let shiftHours = eh * 60 + em - (sh * 60 + sm);
  if (shiftHours < 0) shiftHours += 24 * 60;
  shiftHours /= 60;

  const candidates: {
    employeeId: string;
    employeeName: string;
    hasEmail: boolean;
    rolePriority: number;
    employeePriority: number;
  }[] = [];
  for (const emp of employees) {
    if (alreadyWorkingIds.has(emp.id)) continue; // その日すでに出勤予定がある
    if (alreadyRequestedIds.has(emp.id)) continue; // その日について既に依頼済み（重複依頼防止）
    const withinLimit = await isWithinPartTimeWeeklyLimit(emp.id, emp.role, workDate, shiftHours);
    if (!withinLimit) continue; // バイトの週20時間上限を超える
    candidates.push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      hasEmail: !!emp.contactEmail,
      rolePriority: rolePriorityOf.get(emp.role) ?? 999,
      employeePriority: emp.priorityOrder,
    });
  }

  candidates.sort((a, b) => a.rolePriority - b.rolePriority || a.employeePriority - b.employeePriority);

  return candidates.map(({ employeeId, employeeName, hasEmail }) => ({ employeeId, employeeName, hasEmail }));
}

// ============================================================
// 「シフト調整完了」スナップショット（ShiftAdjustmentConfirmation）
//
// 人員不足は常に自動表示するのではなく、INCが「シフト調整完了」を確定した
// タイミングでのみ再計算し、その結果を月ごとに1件のJSONスナップショットとして保存する。
// 社員の月間勤務表には、次にINCが再確定するまでこのスナップショットの内容がそのまま表示される。
// ============================================================

export type ShiftGapBand = {
  shiftTypeId: string;
  shiftTypeCode: string;
  shiftLabel: string;
  shortage: number;
};

export type MonthShortageSnapshot = {
  month: string; // "2026-09"
  confirmedAt: string; // ISO日時
  shortagesByDate: Record<string, { totalShortage: number; bands: ShiftGapBand[] }>;
};

// INCが「シフト調整完了」を確定したときに呼ぶ。現在の確定済みシフト(MonthRoster)を基に
// 不足を再計算し、その時点の内容でスナップショットを上書き保存する。
export async function confirmMonthShiftAdjustment(year: number, month: number, confirmedBy?: string): Promise<MonthShortageSnapshot> {
  const gaps = await getMonthShiftGaps(year, month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const shortagesByDate: MonthShortageSnapshot["shortagesByDate"] = {};
  for (const g of gaps) {
    if (!shortagesByDate[g.date]) shortagesByDate[g.date] = { totalShortage: 0, bands: [] };
    shortagesByDate[g.date].totalShortage += g.shortage;
    shortagesByDate[g.date].bands.push({
      shiftTypeId: g.shiftTypeId,
      shiftTypeCode: g.shiftTypeCode,
      shiftLabel: g.shiftLabel,
      shortage: g.shortage,
    });
  }

  const saved = await prisma.shiftAdjustmentConfirmation.upsert({
    where: { month: monthKey },
    update: { shortagesByDate: shortagesByDate as any, confirmedAt: new Date(), confirmedBy },
    create: { month: monthKey, shortagesByDate: shortagesByDate as any, confirmedBy },
  });

  return {
    month: monthKey,
    confirmedAt: saved.confirmedAt.toISOString(),
    shortagesByDate,
  };
}

// 指定した月について、最後にINCが確定したスナップショットを返す（未確定ならnull）。
// ライブ再計算は行わない仕様のため、ここでは保存済みのJsonをそのまま返す。
export async function getConfirmedMonthShortages(month: string): Promise<MonthShortageSnapshot | null> {
  const record = await prisma.shiftAdjustmentConfirmation.findUnique({ where: { month } });
  if (!record) return null;
  return {
    month: record.month,
    confirmedAt: record.confirmedAt.toISOString(),
    shortagesByDate: record.shortagesByDate as any,
  };
}
