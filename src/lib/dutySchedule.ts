import { operatingIndex, minutesSinceOperatingStart } from "@/lib/timeSlots";

// ============================================================================
// 業務A/B/全・WHILL関連業務の「稼働時間・必要人数」定義（単一の情報源）
// ============================================================================
//
// このファイルは Prisma（DBアクセス）に依存しない純粋な定数・関数のみを含む。
// そのため src/lib/autoAssign.ts（サーバー）だけでなく、
// src/app/schedule/[date]/page.tsx のようなクライアントコンポーネントからも
// 安全にimportできる（Prismaをブラウザ側バンドルに含めないため）。
//
// 「配置状況（不足表示）」の計算（画面側）と「自動アサイン」の計算（サーバー側）が
// 別々に稼働時間・必要人数の値を持っていると、片方だけ修正したときに表示と実際の
// 割当てがズレるバグの原因になる。そのため両方から必ずこのファイルを参照すること。

export type DutyCode = "A" | "B" | "全";
export type WhillCode =
  | "WHILL_ARRIVAL_PREP"
  | "WHILL_ARRIVAL_CLEANUP"
  | "WHILL_DEPARTURE_PREP"
  | "WHILL_DEPARTURE_CLEANUP";

export const DUTY_PRIORITY: DutyCode[] = ["A", "B", "全"];
export const PRODUCTIVE_CODES = DUTY_PRIORITY;

// 実時刻から営業日インデックスの範囲（開始・終了は排他境界）を求める
// 例: windowFromClock(5, 26) は 5:00〜26:00(=翌2:00) を表す
export function windowFromClock(startHour: number, endHourExclusive: number): { startIdx: number; endIdx: number } {
  const startIdx = operatingIndex(startHour % 24);
  const duration = endHourExclusive - startHour;
  return { startIdx, endIdx: startIdx + duration };
}

// 業務A/B/全の稼働時間（営業日インデックス。endIdxは排他境界）
export const DUTY_WINDOW: Record<DutyCode, { startIdx: number; endIdx: number }> = {
  A: windowFromClock(5, 26), // 05:00-26:00
  B: windowFromClock(6, 24), // 06:00-24:00
  全: windowFromClock(5, 25), // 05:00-25:00
};

// WHILL関連業務（固定時刻・固定必要人数の4イベント）
export const WHILL_EVENTS: { code: WhillCode; slotIndex: number; requiredCount: number; label: string }[] = [
  { code: "WHILL_ARRIVAL_CLEANUP", slotIndex: operatingIndex(10), requiredCount: 1, label: "WHILL（到）片づけ" }, // 10:00-11:00
  { code: "WHILL_DEPARTURE_PREP", slotIndex: operatingIndex(11), requiredCount: 2, label: "WHILL（出）準備" }, // 11:00-12:00
  { code: "WHILL_DEPARTURE_CLEANUP", slotIndex: operatingIndex(18), requiredCount: 2, label: "WHILL（出）片づけ" }, // 18:00-19:00
  { code: "WHILL_ARRIVAL_PREP", slotIndex: operatingIndex(19), requiredCount: 1, label: "WHILL（到）準備" }, // 19:00-20:00
];

// 指定スロットで、指定コードが「稼働時間内」かどうか（不足計算で使う）
export function isDutyActiveAtSlot(code: DutyCode, slot: number): boolean {
  const w = DUTY_WINDOW[code];
  return slot >= w.startIdx && slot < w.endIdx;
}

// 指定スロットで必要な人数を返す（A/B/全は呼び出し元が渡すdemandByCodeを優先、
// 未指定時は1名。WHILLはこのファイルの固定値。稼働時間外は0）
//
// totalBySlot（任意）: INCが /shift-settings で設定したシフトの必要人数（時間帯別設定を含む）から
// 求めた「そのスロットで必要な人数の合計」（src/lib/shiftRequirements.ts の buildTotalBySlot）。
// 指定があり、そのスロットの値が1以上の場合、A/B/全に配置する人数の合計がこの値を超えないよう、
// A→B→全 の優先順位で demandByCode（業務ごとの上限）の範囲内で人数を割り当てる。
// 値が0または未指定のスロットは従来どおり demandByCode のみで決まる。
export function requiredCountAtSlot(
  code: DutyCode | WhillCode,
  slot: number,
  demandByCode: Partial<Record<DutyCode, number>> = {},
  totalBySlot?: number[]
): number {
  if ((DUTY_PRIORITY as string[]).includes(code)) {
    const duty = code as DutyCode;
    if (!isDutyActiveAtSlot(duty, slot)) return 0;
    const cap = demandByCode[duty] ?? 1;
    const total = totalBySlot?.[slot] ?? 0;
    if (total <= 0) return cap;
    let remaining = total;
    for (const d of DUTY_PRIORITY) {
      if (!isDutyActiveAtSlot(d, slot)) continue;
      const share = Math.min(demandByCode[d] ?? 1, remaining);
      if (d === duty) return share;
      remaining -= share;
    }
    return 0;
  }
  const event = WHILL_EVENTS.find((e) => e.code === code && e.slotIndex === slot);
  return event?.requiredCount ?? 0;
}

// ============================================================================
// 60分単位の業務（30分に分割しない）とバッテリー交換
// ============================================================================
// 業務コード（CartPosition.code）。システムのロジックが直接参照するため、業務管理画面では
// これらのコードの変更を禁止している（src/lib/systemPositions.ts）。
export const BATTERY_CODE = "BATTERY_EXCHANGE";

// 60分単位で扱う業務。日別スケジュール画面で30分に分割せず、別業務へ変更する場合も
// その1時間全体を新しい業務に置き換える。
export const SIXTY_MINUTE_CODES: readonly string[] = [
  "WHILL_ARRIVAL_CLEANUP",
  "WHILL_ARRIVAL_PREP",
  "WHILL_DEPARTURE_CLEANUP",
  "WHILL_DEPARTURE_PREP",
  BATTERY_CODE,
];
export function isSixtyMinuteCode(code: string | null | undefined): boolean {
  return !!code && SIXTY_MINUTE_CODES.includes(code);
}

// ============================================================================
// 人員不足の計算（画面表示と自動割当て完了メッセージで共通利用する単一の実装）
// ============================================================================
// assignments: 実際に保存されている割当て（DailyAssignment）。1時間コマ(0-23)ごとに、
// 稼働中の業務A/B/全とWHILL固定イベントについて「必要人数 > 実配置人数」のものだけを返す。
// 30分割当て・60分割当てのどちらも「そのコマの開始時刻を含む割当て」として1回だけ数える。
export type ShortageCell = { hourIdx: number; code: DutyCode | WhillCode; required: number; actual: number };

export function computeShortageCells(
  assignments: { code: string; slotStart: string; slotEnd: string }[],
  demandByCode: Partial<Record<DutyCode, number>> = {},
  totalBySlot?: number[]
): ShortageCell[] {
  const ranges = assignments.map((a) => {
    const start = minutesSinceOperatingStart(a.slotStart);
    let end = minutesSinceOperatingStart(a.slotEnd);
    if (end <= start) end += 24 * 60;
    return { code: a.code, start, end };
  });
  const cells: ShortageCell[] = [];
  for (let hourIdx = 0; hourIdx < 24; hourIdx++) {
    const hourStartMinutes = hourIdx * 60;
    const countByCode = new Map<string, number>();
    for (const r of ranges) {
      if (r.start <= hourStartMinutes && hourStartMinutes < r.end) {
        countByCode.set(r.code, (countByCode.get(r.code) ?? 0) + 1);
      }
    }
    for (const duty of DUTY_PRIORITY) {
      if (!isDutyActiveAtSlot(duty, hourIdx)) continue;
      const required = requiredCountAtSlot(duty, hourIdx, demandByCode, totalBySlot);
      const actual = countByCode.get(duty) ?? 0;
      if (actual < required) cells.push({ hourIdx, code: duty, required, actual });
    }
    for (const event of WHILL_EVENTS) {
      if (event.slotIndex !== hourIdx) continue;
      const required = requiredCountAtSlot(event.code, hourIdx, demandByCode);
      const actual = countByCode.get(event.code) ?? 0;
      if (actual < required) cells.push({ hourIdx, code: event.code, required, actual });
    }
  }
  return cells;
}
