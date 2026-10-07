import { prisma } from "@/lib/prisma";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";
import { resolveWorkTime } from "@/lib/workTime";
import { hourOf } from "@/lib/timeSlots";
import { getShortageNotice } from "@/lib/shortageNotice";
import {
  ShiftRequirementDef,
  evaluateShiftGap,
  isCountedShift,
  personWindow,
  shiftWindow,
} from "@/lib/shiftRequirements";

// 月次シフト調整で対象とするシフトと必要人数は、INCが /shift-settings（ShiftType.requiredCount と
// ShiftTimeBand）で設定した値を使う（コード固定はしない）。基本必要人数が1以上、または時間帯別に
// 1人以上の設定があるシフトが集計対象。計算の中身は src/lib/shiftRequirements.ts。

export type ShiftGap = {
  date: string; // "2026-09-03"
  shiftTypeId: string;
  shiftTypeCode: string;
  shiftLabel: string; // "08:00〜17:00"
  required: number;
  current: number;
  shortage: number;
  bandDetails?: string[]; // 時間帯別設定があるシフトで、不足している時間帯（例: "09:00〜10:00 2/3人"）
  notice?: string[]; // アルバイト向け注意事項（不足しているシフトの勤務時間に応じて表示）
};

export type ShiftGapWithCandidates = ShiftGap & {
  candidates: { employeeId: string; employeeName: string; hasEmail: boolean; role: string }[];
  // 既に依頼・申請済み（招待メール送信済みで未回答のものを含む）の従業員と、その回答状況
  invited: { employeeId: string; employeeName: string; status: string }[];
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// 指定した月について、必要人数が設定されている全シフト×全日をチェックし、不足しているシフトの一覧を返す。
// 「22:00〜08:00」のような日跨ぎシフトは開始日1日分のシフトとして扱う（既存のMonthRosterの記録方法と
// 同じ。二重カウントしない）。
export async function getMonthShiftGaps(year: number, month: number): Promise<ShiftGap[]> {
  const shiftTypes = await prisma.shiftType.findMany({ include: { timeBands: true } });
  const counted = shiftTypes
    .map((st) => {
      const def: ShiftRequirementDef = {
        id: st.id,
        code: st.code,
        defaultStartTime: st.defaultStartTime,
        defaultEndTime: st.defaultEndTime,
        requiredCount: st.requiredCount ?? 0,
        timeBands: st.timeBands.map((b) => ({ startTime: b.startTime, endTime: b.endTime, requiredCount: b.requiredCount })),
      };
      return { st, def };
    })
    .filter((x) => isCountedShift(x.def))
    .sort((a, b) => a.def.defaultStartTime.localeCompare(b.def.defaultStartTime) || a.def.code.localeCompare(b.def.code));
  const countedById = new Map(counted.map((x) => [x.st.id, x]));

  const numDays = daysInMonth(year, month);
  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));

  // その月の出勤(WORK)予定を、対象シフトごとに（shiftTypeId優先、無ければ開始時刻から推定して）集計する
  const entries = await prisma.monthRoster.findMany({
    where: { workDate: { gte: rangeStart, lt: rangeEnd }, status: "WORK" },
    include: { shiftType: true, employee: true },
  });

  const windowsByDateAndShift = new Map<string, { start: number; end: number }[]>(); // "2026-09-03|<shiftTypeId>"
  for (const e of entries) {
    let target = e.shiftType ? countedById.get(e.shiftType.id) ?? null : null;
    if (!target) {
      // shiftTypeが未設定（または集計対象外）の場合、基本勤務時間の開始・終了時刻から推定する。
      // 同じ開始時刻のシフトが複数ある場合（例: 08:00〜17:00 と 08:00〜14:00）は、終了時刻が
      // 一致するものを優先し、なければ終了が最も遅いシフトとみなす。
      const startStr = e.overrideStartTime ?? e.employee.baseStartTime ?? "";
      const endStr = e.overrideEndTime ?? e.employee.baseEndTime ?? "";
      if (!startStr) continue;
      const sameStart = counted.filter((x) => hourOf(x.def.defaultStartTime) === hourOf(startStr));
      if (sameStart.length === 0) continue; // どのシフトにも該当しない場合は対象外
      target =
        sameStart.find((x) => endStr && hourOf(x.def.defaultEndTime) === hourOf(endStr)) ??
        [...sameStart].sort(
          (a, b) => shiftWindow(b.def.defaultStartTime, b.def.defaultEndTime).end - shiftWindow(a.def.defaultStartTime, a.def.defaultEndTime).end
        )[0];
    }

    const worked =
      resolveWorkTime({
        overrideStartTime: e.overrideStartTime,
        overrideEndTime: e.overrideEndTime,
        shiftType: e.shiftType,
        baseStartTime: e.employee.baseStartTime,
        baseEndTime: e.employee.baseEndTime,
      }) ?? { start: target.def.defaultStartTime, end: target.def.defaultEndTime };

    const key = `${e.workDate.toISOString().slice(0, 10)}|${target.st.id}`;
    const list = windowsByDateAndShift.get(key) ?? [];
    list.push(personWindow(worked.start, worked.end));
    windowsByDateAndShift.set(key, list);
  }

  const gaps: ShiftGap[] = [];
  for (let d = 1; d <= numDays; d++) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    for (const { st, def } of counted) {
      const windows = windowsByDateAndShift.get(`${dateKey}|${st.id}`) ?? [];
      const ev = evaluateShiftGap(def, windows);
      if (ev.shortage > 0) {
        gaps.push({
          date: dateKey,
          shiftTypeId: st.id,
          shiftTypeCode: st.code,
          shiftLabel: `${st.defaultStartTime}〜${st.defaultEndTime}`,
          required: ev.required,
          current: ev.current,
          shortage: ev.shortage,
          ...(ev.bandDetails.length > 0 ? { bandDetails: ev.bandDetails } : {}),
          ...(() => {
            const notice = getShortageNotice(st.defaultStartTime, st.defaultEndTime);
            return notice.length > 0 ? { notice } : {};
          })(),
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
export async function findCandidatesForShift(
  date: string,
  shiftTypeCode: string
): Promise<{ employeeId: string; employeeName: string; hasEmail: boolean; role: string }[]> {
  const workDate = new Date(date + "T00:00:00Z");
  const shiftType = await prisma.shiftType.findUnique({ where: { code: shiftTypeCode } });
  if (!shiftType) return [];

  const [employees, existingWorkEntries, existingClaims, rolePriorities] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true } }),
    prisma.monthRoster.findMany({ where: { workDate, status: "WORK" } }),
    // その日について、状態（招待済み・未回答/本人申請の承認待ち/承認済み/却下済み）を問わず、
    // 既に依頼・申請済みの従業員を除外するため取得する（重複依頼防止）。
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
    role: string;
    rolePriority: number;
    employeePriority: number;
  }[] = [];
  for (const emp of employees) {
    if (alreadyWorkingIds.has(emp.id)) continue; // その日すでに出勤予定がある
    if (alreadyRequestedIds.has(emp.id)) continue; // その日について既に依頼・申請済み（重複依頼防止）
    const withinLimit = await isWithinPartTimeWeeklyLimit(emp.id, emp.role, workDate, shiftHours);
    if (!withinLimit) continue; // バイトの週20時間上限を超える
    candidates.push({
      employeeId: emp.id,
      employeeName: emp.fullName,
      hasEmail: !!emp.contactEmail,
      role: emp.role,
      rolePriority: rolePriorityOf.get(emp.role) ?? 999,
      employeePriority: emp.priorityOrder,
    });
  }

  candidates.sort((a, b) => a.rolePriority - b.rolePriority || a.employeePriority - b.employeePriority);

  return candidates.map(({ employeeId, employeeName, hasEmail, role }) => ({ employeeId, employeeName, hasEmail, role }));
}

// 指定した1つの不足シフト（date + shiftTypeId）について、既にINCが依頼済み（招待メール送信済みまたは
// 本人が申請済み）の従業員と、その回答状況を返す。INC画面で「登録済み／未登録」を実態どおりに
// 表示するために使う（メールを送っただけの状態と、本人が実際に登録した状態を区別する）。
export async function findInvitedForShift(
  date: string,
  shiftTypeId: string
): Promise<{ employeeId: string; employeeName: string; status: string }[]> {
  const workDate = new Date(date + "T00:00:00Z");
  const claims = await prisma.shiftClaimRequest.findMany({
    where: { workDate, shiftTypeId },
    include: { employee: true },
  });
  return claims.map((c) => ({ employeeId: c.employeeId, employeeName: c.employee.fullName, status: c.status }));
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
  notice?: string[]; // 保存時点の注意事項（旧データには無い場合がある）
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
      ...(g.notice && g.notice.length > 0 ? { notice: g.notice } : {}),
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
