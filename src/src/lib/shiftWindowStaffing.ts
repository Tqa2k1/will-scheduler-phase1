import { prisma } from "@/lib/prisma";
import { resolveWorkTime } from "@/lib/workTime";

// ============================================================================
// 「1日12人 = 4人×3ダイヤ（早番/遅番/明番）」の人員充足チェック（2026-08 新規機能）
// ============================================================================
//
// これは既存の業務A/B/全/WHILL（1時間単位・src/lib/dutySchedule.ts）とは**別の指標**である。
// - dutySchedule.ts の指標: 「その時間、誰がどの業務を担当するか」（1時間粒度、担当業務の充足）
// - このファイルの指標: 「その日、各勤務ダイヤに何人出勤する予定か」（ダイヤ単位の頭数充足）
// 両者は独立しており、このファイルの追加によって既存のA/B/全/WHILL計算・自動アサインは
// 一切変更していない。
//
// 3つのダイヤは、既存の ShiftType マスタと完全に一致する:
//   早番 08:00-17:00 / 遅番 13:00-22:00 / 明番 22:00-08:00（日をまたぐ）
// 必要人数は要件により固定値（4人×3ダイヤ）としている（管理画面での変更は現時点では不可。
// 変更したい場合は SHIFT_WINDOWS を編集するか、将来的にDB設定に拡張する）。
//
// 明番（22:00〜翌8:00）は「1つの連続勤務」として扱う。MonthRoster は
// employeeId+workDate で一意（1人1日1レコード）なので、22:00開始のシフトは
// 「開始日（workDate）」に対して1レコードのみ存在し、翌日側に重複カウントされることはない
// （docs/ARCHITECTURE.md の「時間の扱い方」を参照。dailyRoster.ts の仕組みと同じ前提）。

export const SHIFT_WINDOWS = [
  { code: "早番", startTime: "08:00", endTime: "17:00", requiredCount: 4 },
  { code: "遅番", startTime: "13:00", endTime: "22:00", requiredCount: 4 },
  { code: "明番", startTime: "22:00", endTime: "08:00", requiredCount: 4 },
] as const;

export type ShiftWindowCode = (typeof SHIFT_WINDOWS)[number]["code"];

export type ShiftWindowStatus = {
  code: ShiftWindowCode;
  startTime: string;
  endTime: string;
  requiredCount: number;
  actualCount: number;
  shortage: number; // max(0, requiredCount - actualCount)
  employeeIds: string[]; // その日・そのダイヤで出勤予定の従業員ID一覧
};

// 指定日の3ダイヤそれぞれについて、必要人数・実際の出勤予定人数・不足人数を計算する。
// 「実際にそのダイヤの時間帯で勤務する人」は、MonthRoster(status=WORK)の解決後の勤務時間
// （resolveWorkTime: 例外時間 > ShiftType > 基本勤務時間の優先順位。既存ロジックをそのまま使用）
// が、各ダイヤの開始・終了時刻と完全一致する人を数える。ShiftTypeを選ばず個別に08:00-17:00等の
// 例外時間を設定している人も正しくカウントされる。
export async function getShiftWindowStatus(workDate: Date): Promise<ShiftWindowStatus[]> {
  const entries = await prisma.monthRoster.findMany({
    where: { workDate, status: "WORK", employee: { isActive: true } },
    include: { employee: true, shiftType: true },
  });

  const byWindow = new Map<ShiftWindowCode, string[]>();
  for (const w of SHIFT_WINDOWS) byWindow.set(w.code, []);

  for (const entry of entries) {
    const resolved = resolveWorkTime({
      overrideStartTime: entry.overrideStartTime,
      overrideEndTime: entry.overrideEndTime,
      shiftType: entry.shiftType,
      baseStartTime: entry.employee.baseStartTime,
      baseEndTime: entry.employee.baseEndTime,
    });
    if (!resolved) continue;
    const match = SHIFT_WINDOWS.find((w) => w.startTime === resolved.start && w.endTime === resolved.end);
    if (match) byWindow.get(match.code)!.push(entry.employeeId);
  }

  return SHIFT_WINDOWS.map((w) => {
    const employeeIds = byWindow.get(w.code) ?? [];
    return {
      code: w.code,
      startTime: w.startTime,
      endTime: w.endTime,
      requiredCount: w.requiredCount,
      actualCount: employeeIds.length,
      shortage: Math.max(0, w.requiredCount - employeeIds.length),
      employeeIds,
    };
  });
}

// 指定日・指定ダイヤについて「その時間に出勤可能そうな」従業員候補を返す
// （シフト調整メールの送信先候補の絞り込みに使う）。
//
// 条件:
// - isActive な従業員
// - contactEmail が設定されている（メールを送れる）
// - その日、まだ出勤予定(WORK)になっていない（既にそのダイヤ以外で出勤予定の人も除外する。
//   1日に2つのダイヤを掛け持ちさせる想定はないため）
// - その日、PersonalConstraint に NG 設定がある場合は除外（既存のNG/OKルールをそのまま尊重）
// - その日、既に同じダイヤでKIBO登録済み（PENDING/APPROVED）の場合は除外（二重送信防止）
function minutesOfWindow(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// 2つの時間範囲（日をまたぐ場合も考慮）が重なっているかどうか
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const toSpan = (s: string, e: string) => {
    const start = minutesOfWindow(s);
    let end = minutesOfWindow(e);
    if (end <= start) end += 24 * 60; // 日をまたぐ場合（例: 22:00-08:00）
    return { start, end };
  };
  const a = toSpan(aStart, aEnd);
  const b = toSpan(bStart, bEnd);
  // 24時間分ずらした範囲とも比較し、日をまたいだ重なりも検出する
  for (const offset of [-24 * 60, 0, 24 * 60]) {
    if (a.start < b.end + offset && b.start + offset < a.end) return true;
  }
  return false;
}

export async function findEligibleEmployeesForWindow(
  workDate: Date,
  window: (typeof SHIFT_WINDOWS)[number]
): Promise<{ id: string; fullName: string; contactEmail: string }[]> {
  const [candidates, alreadyWorking, ngConstraints, existingClaims, rolePriorities, employeePriorities] =
    await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true, contactEmail: { not: null } },
      }),
      prisma.monthRoster.findMany({ where: { workDate, status: "WORK" }, select: { employeeId: true } }),
      prisma.personalConstraint.findMany({ where: { workDate, constraintType: "NG" } }),
      prisma.shiftClaimRequest.findMany({
        where: { workDate, status: { in: ["PENDING", "APPROVED"] }, desiredStartTime: window.startTime },
        select: { employeeId: true },
      }),
      prisma.rolePriority.findMany(),
      prisma.employeePriority.findMany(),
    ]);

  // NG制約は、時間範囲が指定されていなければ「その日終日NG」として扱う。時間範囲が
  // 指定されている場合は、対象ダイヤの時間帯と重なっている場合のみ除外する
  // （例: 09:00-12:00のNGは、早番08:00-17:00とは重なるので除外されるが、
  //   このNGだけを理由に遅番13:00-22:00の対象から外れることはない）。
  const ngEmployeeIds = new Set(
    ngConstraints
      .filter((c) => !c.rangeStart || !c.rangeEnd || rangesOverlap(c.rangeStart, c.rangeEnd, window.startTime, window.endTime))
      .map((c) => c.employeeId)
  );

  const excluded = new Set<string>([
    ...alreadyWorking.map((e) => e.employeeId),
    ...ngEmployeeIds,
    ...existingClaims.map((c) => c.employeeId),
  ]);

  // 優先順位（役割優先順位 → 従業員個人優先順位）で並べる。ここでの並び順は「不足時に誰を優先して
  // 選ぶか」を反映するためのもので、送信対象自体は変えない（全員に送る）— メール一覧・admin画面での
  // 表示順として、対応時に誰から検討すべきかが分かるようにする。
  const rolePriorityOf = new Map(rolePriorities.map((p) => [p.role, p.priorityOrder]));
  const employeePriorityOf = new Map(employeePriorities.map((p) => [p.employeeId, p.priorityOrder]));

  return candidates
    .filter((e) => !excluded.has(e.id) && !!e.contactEmail)
    .sort((a, b) => {
      const ra = rolePriorityOf.get(a.role) ?? 999;
      const rb = rolePriorityOf.get(b.role) ?? 999;
      if (ra !== rb) return ra - rb;
      const ea = employeePriorityOf.get(a.id) ?? 999999;
      const eb = employeePriorityOf.get(b.id) ?? 999999;
      return ea - eb;
    })
    .map((e) => ({ id: e.id, fullName: e.fullName, contactEmail: e.contactEmail as string }));
}
