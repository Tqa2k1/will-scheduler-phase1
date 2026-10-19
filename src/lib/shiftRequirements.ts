import { prisma } from "@/lib/prisma";
import { operatingIndex } from "@/lib/timeSlots";

// ============================================================================
// シフトの必要人数（INCが /shift-settings で設定）の共通ロジック
//
//   基本必要人数 : ShiftType.requiredCount
//   時間帯別人数 : ShiftTimeBand（設定がある時間帯は基本必要人数より優先。無い時間帯は基本人数）
//
// 「人員不足を確定」(monthlyShiftGap.ts) と 自動割り当て(autoAssign) は必ずこのファイルの
// 値を使う。必要人数をコードに固定しないこと。
// ============================================================================

export type ShiftRequirementDef = {
  id: string;
  code: string;
  defaultStartTime: string;
  defaultEndTime: string;
  requiredCount: number; // 基本必要人数（未設定は0）
  timeBands: { startTime: string; endTime: string; requiredCount: number }[];
};

export type RequirementSegment = { start: number; end: number; required: number };

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// シフトの範囲（分）。終了 <= 開始 の場合は日跨ぎ（例: 22:00〜08:00 → 1320〜1920）
export function shiftWindow(startTime: string, endTime: string): { start: number; end: number } {
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end += 1440;
  return { start, end };
}

// 時間帯別設定をシフトの時間軸（分）に正規化する。シフト範囲外の部分は切り落とす。
export function normalizeBand(
  shift: { startTime: string; endTime: string },
  band: { startTime: string; endTime: string }
): { start: number; end: number } | null {
  const w = shiftWindow(shift.startTime, shift.endTime);
  let s = toMinutes(band.startTime);
  let e = toMinutes(band.endTime);
  if (w.end > 1440 && s < w.start) {
    // 日跨ぎシフトの「0時以降」側の時間帯（例: 00:00〜04:00）
    s += 1440;
    e += 1440;
  } else if (e <= s) {
    e += 1440;
  }
  s = Math.max(s, w.start);
  e = Math.min(e, w.end);
  return e > s ? { start: s, end: e } : null;
}

// 人員不足の集計対象かどうか（基本人数が1以上、または時間帯別に1以上がある）
export function isCountedShift(def: ShiftRequirementDef): boolean {
  return def.requiredCount > 0 || def.timeBands.some((b) => b.requiredCount > 0);
}

// シフトを時間帯別設定の境界で区切り、各区間の必要人数を返す（設定が無い区間は基本人数）
export function buildSegments(def: ShiftRequirementDef): RequirementSegment[] {
  const w = shiftWindow(def.defaultStartTime, def.defaultEndTime);
  const base = Math.max(0, def.requiredCount);
  const bands = def.timeBands
    .map((b) => {
      const n = normalizeBand({ startTime: def.defaultStartTime, endTime: def.defaultEndTime }, b);
      return n ? { ...n, required: Math.max(0, b.requiredCount) } : null;
    })
    .filter((b): b is { start: number; end: number; required: number } => b !== null)
    .sort((a, b) => a.start - b.start);

  const segments: RequirementSegment[] = [];
  let cursor = w.start;
  for (const b of bands) {
    const start = Math.max(b.start, cursor);
    if (b.end <= start) continue;
    if (start > cursor) segments.push({ start: cursor, end: start, required: base });
    segments.push({ start, end: b.end, required: b.required });
    cursor = b.end;
  }
  if (cursor < w.end) segments.push({ start: cursor, end: w.end, required: base });
  return segments;
}

// 勤務者1人の勤務時間（"HH:MM"〜"HH:MM"）を分に変換（日跨ぎ対応）
export function personWindow(startTime: string, endTime: string): { start: number; end: number } {
  return shiftWindow(startTime, endTime);
}

export type ShiftGapEvaluation = {
  required: number;
  current: number;
  shortage: number;
  bandDetails: string[]; // 不足している時間帯（時間帯別設定がある場合のみ）
};

// 1日・1シフトぶんの不足を計算する。
//  - 時間帯別設定なし: 基本必要人数 − 勤務人数
//  - 時間帯別設定あり: 区間ごとに（その区間の必要人数 − その区間を通して勤務している人数）を出し、
//    最も不足が大きい区間の不足人数をこのシフトの不足とする
export function evaluateShiftGap(def: ShiftRequirementDef, windows: { start: number; end: number }[]): ShiftGapEvaluation {
  const base = Math.max(0, def.requiredCount);
  if (def.timeBands.length === 0) {
    return { required: base, current: windows.length, shortage: Math.max(0, base - windows.length), bandDetails: [] };
  }

  const segments = buildSegments(def);
  let worst = { required: base, current: windows.length, shortage: 0 };
  const bandDetails: string[] = [];
  for (const seg of segments) {
    const actual = windows.filter((w) => w.start <= seg.start && w.end >= seg.end).length;
    const shortage = Math.max(0, seg.required - actual);
    if (shortage > 0) {
      bandDetails.push(`${formatMinutes(seg.start)}〜${formatMinutes(seg.end)} ${actual}/${seg.required}人`);
    }
    if (shortage > worst.shortage) worst = { required: seg.required, current: actual, shortage };
  }
  return { ...worst, bandDetails };
}

// 各「1時間スロット（営業日インデックス 0=4:00 … 23=3:00）」で必要な人数の合計。
// 自動割り当て（業務A/B/全の配置人数の上限）と日別スケジュールの不足表示で使う。
// スロット内で必要人数が変わる場合は最大値を採用する。
export function buildTotalBySlot(defs: ShiftRequirementDef[]): number[] {
  const withSegments = defs.filter(isCountedShift).map((d) => buildSegments(d));
  const totals = new Array<number>(24).fill(0);
  for (let hour = 0; hour < 24; hour++) {
    let max = 0;
    for (let m = hour * 60; m < (hour + 1) * 60; m++) {
      let total = 0;
      for (const segments of withSegments) {
        // 日跨ぎシフトは「当日側(m)」と「前日から続く側(m+1440)」の両方を見る
        const seg = segments.find((s) => (m >= s.start && m < s.end) || (m + 1440 >= s.start && m + 1440 < s.end));
        if (seg) total += seg.required;
      }
      if (total > max) max = total;
    }
    totals[operatingIndex(hour)] = max;
  }
  return totals;
}

export async function loadShiftRequirementDefs(): Promise<ShiftRequirementDef[]> {
  const rows = await prisma.shiftType.findMany({ include: { timeBands: true } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    defaultStartTime: r.defaultStartTime,
    defaultEndTime: r.defaultEndTime,
    requiredCount: r.requiredCount ?? 0,
    timeBands: r.timeBands.map((b) => ({ startTime: b.startTime, endTime: b.endTime, requiredCount: b.requiredCount })),
  }));
}

export async function getRequiredHeadcountBySlot(): Promise<number[]> {
  return buildTotalBySlot(await loadShiftRequirementDefs());
}

// 時間帯別設定の入力チェック。問題があれば日本語のエラーメッセージを返す（問題なければ null）。
//  - 開始と終了が同じでない / シフトの時間の範囲内 / 時間帯同士が重ならない
export function validateTimeBands(
  shift: { startTime: string; endTime: string },
  bands: { startTime: string; endTime: string }[]
): string | null {
  const w = shiftWindow(shift.startTime, shift.endTime);
  const ranges: { s: number; e: number; label: string }[] = [];
  for (const b of bands) {
    const label = `${b.startTime}〜${b.endTime}`;
    if (b.startTime === b.endTime) return `時間帯 ${label} は開始と終了が同じです`;
    let s = toMinutes(b.startTime);
    let e = toMinutes(b.endTime);
    if (w.end > 1440 && s < w.start) {
      s += 1440;
      e += 1440;
    } else if (e <= s) {
      e += 1440;
    }
    if (s < w.start || e > w.end) {
      return `時間帯 ${label} がシフトの時間（${shift.startTime}〜${shift.endTime}）の範囲外です`;
    }
    ranges.push({ s, e, label });
  }
  ranges.sort((a, b) => a.s - b.s);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].s < ranges[i - 1].e) return `時間帯 ${ranges[i - 1].label} と ${ranges[i].label} が重なっています`;
  }
  return null;
}
