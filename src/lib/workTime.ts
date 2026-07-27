// 勤務時間の解決ロジック（優先順位）:
// 1) その日の例外時間（overrideStartTime/overrideEndTime）があれば最優先
// 2) なければ、その日に選択されているShiftTypeの時間
// 3) それもなければ、従業員の基本勤務時間（baseStartTime/baseEndTime）
// いずれも無ければ null（時間未設定＝表示は空欄）

export type ResolvedTime = { start: string; end: string } | null;

export function resolveWorkTime(input: {
  overrideStartTime?: string | null;
  overrideEndTime?: string | null;
  shiftType?: { defaultStartTime: string; defaultEndTime: string } | null;
  baseStartTime?: string | null;
  baseEndTime?: string | null;
}): ResolvedTime {
  if (input.overrideStartTime && input.overrideEndTime) {
    return { start: input.overrideStartTime, end: input.overrideEndTime };
  }
  if (input.shiftType) {
    return { start: input.shiftType.defaultStartTime, end: input.shiftType.defaultEndTime };
  }
  if (input.baseStartTime && input.baseEndTime) {
    return { start: input.baseStartTime, end: input.baseEndTime };
  }
  return null;
}

// 表示用フォーマット: "08:00"〜"17:00" -> "8-17"（勤務表の慣習表記に合わせる）
export function formatTimeRange(t: ResolvedTime): string {
  if (!t) return "";
  const short = (time: string) => {
    const [h, m] = time.split(":");
    const hNum = Number(h);
    return m === "00" ? `${hNum}` : `${hNum}:${m}`;
  };
  return `${short(t.start)}-${short(t.end)}`;
}

export const STATUS_LABEL: Record<string, string> = {
  WORK: "出勤",
  OFF: "公休",
  PAID_LEAVE: "有休",
  ADJUST_LEAVE: "調整休",
};
