// Trục thời gian vận hành: 04:00 hôm nay -> 03:30 hôm sau, mỗi slot 30 phút (48 slot/ngày)
// Đúng theo cấu trúc sheet-ngày trong file Excel gốc (Bước 1)

export type TimeSlot = { start: string; end: string };

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function buildOperatingDaySlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  // 4:00 -> 23:30 (40 slot), rồi 0:00 -> 3:30 hôm sau (8 slot) = 48 slot
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
