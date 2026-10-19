import { BATTERY_CODE } from "@/lib/dutySchedule";

// Prismaに依存しない純粋な定義（クライアントコンポーネントからも利用できる）
// システム（自動割当て・不足判定・画面）が code 文字列を直接参照している業務コード。
// 業務管理画面ではこれらの code の変更を禁止する（名称・色・説明・稼働状態は変更可能）。
export const SYSTEM_POSITION_CODES: readonly string[] = [
  "A",
  "B",
  "全",
  "BREAK",
  "OFFICE",
  "WHILL_ARRIVAL_PREP",
  "WHILL_ARRIVAL_CLEANUP",
  "WHILL_DEPARTURE_PREP",
  "WHILL_DEPARTURE_CLEANUP",
  BATTERY_CODE,
];
export function isSystemPositionCode(code: string): boolean {
  return SYSTEM_POSITION_CODES.includes(code);
}
