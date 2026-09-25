// Trục thời gian vận hành: 04:00 hôm nay -> 03:00-04:00 hôm sau, mỗi slot 1 TIẾNG (24 slot/ngày)
// Đổi từ 30 phút -> 1 tiếng theo yêu cầu thực tế sử dụng

export type TimeSlot = { start: string; end: string };

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function buildOperatingDaySlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const startHour = 4;
  for (let i = 0; i < 24; i++) {
    const startH = (startHour + i) % 24;
    const endH = (startHour + i + 1) % 24;
    slots.push({ start: `${pad(startH)}:00`, end: `${pad(endH)}:00` });
  }
  return slots;
}

// 実時刻(0-23時)を「営業日インデックス」(0=4:00, ..., 23=3:00-4:00)に変換
export function operatingIndex(hour: number): number {
  return ((hour - 4) % 24 + 24) % 24;
}

// "08:00" 等の文字列から時（0-23）を取り出す
export function hourOf(time: string): number {
  return Number(time.split(":")[0]);
}

// 表示用（日別スケジュール画面）の30分刻みスロット。48スロット/日。
// ⚠️ buildOperatingDaySlots() / operatingIndex() は自動割当てロジック（dutySchedule.ts,
// autoAssign.ts, dailyRoster.ts）が「1時間=1インデックス」の前提で使っているため変更しない。
// この関数は表示専用の別関数として追加した（既存ロジックへの影響なし）。
export function buildDisplaySlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const startHour = 4;
  for (let i = 0; i < 48; i++) {
    const totalMinutes = startHour * 60 + i * 30;
    const startH = Math.floor(totalMinutes / 60) % 24;
    const startM = totalMinutes % 60;
    const endTotal = totalMinutes + 30;
    const endH = Math.floor(endTotal / 60) % 24;
    const endM = endTotal % 60;
    slots.push({
      start: `${pad(startH)}:${pad(startM)}`,
      end: `${pad(endH)}:${pad(endM)}`,
    });
  }
  return slots;
}

// "13:00" -> 4:00起点からの経過分数（日をまたぐ場合を考慮）。表示グリッドでの範囲比較に使用。
export function minutesSinceOperatingStart(time: string): number {
  const [h, m] = time.split(":").map(Number);
  const startHour = 4;
  let minutes = (h - startHour) * 60 + m;
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}
