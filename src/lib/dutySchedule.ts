import { operatingIndex } from "@/lib/timeSlots";

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
export function requiredCountAtSlot(
  code: DutyCode | WhillCode,
  slot: number,
  demandByCode: Partial<Record<DutyCode, number>> = {}
): number {
  if ((DUTY_PRIORITY as string[]).includes(code)) {
    const duty = code as DutyCode;
    if (!isDutyActiveAtSlot(duty, slot)) return 0;
    return demandByCode[duty] ?? 1;
  }
  const event = WHILL_EVENTS.find((e) => e.code === code && e.slotIndex === slot);
  return event?.requiredCount ?? 0;
}
