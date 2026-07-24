import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Tài khoản Admin đầu tiên ---
  // ĐỔI email/mật khẩu này trước khi chạy seed thật, hoặc đổi lại ngay sau lần đăng nhập đầu tiên.
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
  await prisma.user.upsert({
    where: { email: "admin@pacificcrew.jp" },
    update: {},
    create: {
      email: "admin@pacificcrew.jp",
      name: "Quản trị viên",
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

  // --- Vị trí công việc (Bước 1: A/B/全/BF + các trạng thái đặc biệt) ---
  const positions = [
    { code: "A", name: "A cart", category: "CART" as const },
    { code: "B", name: "B cart", category: "CART" as const },
    { code: "全", name: "Toàn bộ cart", category: "CART" as const },
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
