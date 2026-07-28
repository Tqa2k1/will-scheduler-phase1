import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Tài khoản Admin đầu tiên ---
  // ĐỔI email/mật khẩu này trước khi chạy seed thật, hoặc đổi lại ngay sau lần đăng nhập đầu tiên.
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
  await prisma.user.upsert({
    where: { email: "admin@pacificcrew.jp" },
    update: { name: "システム管理者" },
    create: {
      email: "admin@pacificcrew.jp",
      name: "システム管理者",
      passwordHash,
      role: "ADMIN",
    },
  });

  // --- Loại ca (Bước 1: 明番/早番/中番/遅番/超早/超遅) ---
  const shiftTypes = [
    { code: "明番", name: "Ca bàn giao sau đêm", defaultStartTime: "22:00", defaultEndTime: "08:00", spansMidnight: true },
    { code: "早番", name: "Ca sớm", defaultStartTime: "08:00", defaultEndTime: "17:00", spansMidnight: false },
    { code: "中番", name: "Ca giữa", defaultStartTime: "11:00", defaultEndTime: "20:00", spansMidnight: false },
    { code: "遅番", name: "Ca muộn", defaultStartTime: "13:00", defaultEndTime: "22:00", spansMidnight: false },
    { code: "超早", name: "Ca siêu sớm", defaultStartTime: "05:00", defaultEndTime: "14:00", spansMidnight: false },
    { code: "超遅", name: "Ca siêu muộn", defaultStartTime: "16:00", defaultEndTime: "22:00", spansMidnight: false },
  ];
  for (const s of shiftTypes) {
    await prisma.shiftType.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  // --- 業務 (Bước 1: A/B/全/BF + các trạng thái đặc biệt) ---
  const positions = [
    { code: "A", name: "Aカート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00" },
    { code: "B", name: "Bカート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00" },
    { code: "全", name: "全カート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00" },
    { code: "BF", name: "BF", category: "SPECIAL" as const },
    { code: "BREAK", name: "休憩 (Nghỉ giải lao)", category: "SPECIAL" as const },
    { code: "MOVE", name: "移動 (Di chuyển)", category: "SPECIAL" as const },
    { code: "WHILL_PREP", name: "WHILL準備 (Chuẩn bị xe)", category: "SPECIAL" as const },
    { code: "WHILL_CLEANUP", name: "WHILL片付け (Thu dọn xe)", category: "SPECIAL" as const },
    { code: "MTG", name: "Họp", category: "SPECIAL" as const },
  ];
  for (const p of positions) {
    await prisma.cartPosition.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  // --- 優先順位（自動アサイン時の初期値。管理者が後からUIで変更可能） ---
  // INCは業務アサイン対象外（監督役割）のため優先順位の対象に含めない
  const rolePriorities: { role: "STAFF" | "CONTRACT" | "PARTTIME" | "OJT"; priorityOrder: number }[] = [
    { role: "STAFF", priorityOrder: 1 },
    { role: "CONTRACT", priorityOrder: 2 },
    { role: "PARTTIME", priorityOrder: 3 },
    { role: "OJT", priorityOrder: 4 },
  ];
  for (const rp of rolePriorities) {
    await prisma.rolePriority.upsert({
      where: { role: rp.role },
      update: {},
      create: rp,
    });
  }

  // --- Rotation Pattern (4勤2休・3勤2休・5勤2休) ---
  // pattern配列は「出勤(WORK)/公休(OFF)」のサイクルのみを表す。勤務時間・シフトは別途、
  // 従業員の基本勤務時間 or ShiftType で決まる（resolveWorkTime を参照）。
  const rotationPatterns = [
    {
      code: "4KIN2KYU",
      name: "4勤2休",
      patternDefinition: { cycleDays: 6, pattern: ["WORK", "WORK", "WORK", "WORK", "OFF", "OFF"] },
    },
    {
      code: "3KIN2KYU",
      name: "3勤2休",
      patternDefinition: { cycleDays: 5, pattern: ["WORK", "WORK", "WORK", "OFF", "OFF"] },
    },
    {
      code: "5KIN2KYU",
      name: "5勤2休",
      patternDefinition: { cycleDays: 7, pattern: ["WORK", "WORK", "WORK", "WORK", "WORK", "OFF", "OFF"] },
    },
  ];
  for (const rp of rotationPatterns) {
    await prisma.rotationPattern.upsert({ where: { code: rp.code }, update: {}, create: rp });
  }

  console.log("Seed xong. Đăng nhập bằng admin@pacificcrew.jp / ChangeMe123! rồi đổi mật khẩu ngay.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
