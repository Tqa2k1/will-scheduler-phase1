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
