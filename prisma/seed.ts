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
  // --- 業務 WHILL 旧データの削除（新しい5業務に置き換えるため） ---
  // 関連するDailyAssignment/業務要件等も含めて安全に削除してから、新しい業務を作成する。
  const oldWhillCodes = ["WHILL_PREP", "WHILL_CLEANUP"];
  const oldWhillPositions = await prisma.cartPosition.findMany({ where: { code: { in: oldWhillCodes } } });
  const oldWhillIds = oldWhillPositions.map((p) => p.id);
  if (oldWhillIds.length > 0) {
    await prisma.dailyAssignment.deleteMany({ where: { cartPositionId: { in: oldWhillIds } } });
    await prisma.taskRequirement.deleteMany({ where: { cartPositionId: { in: oldWhillIds } } });
    await prisma.cartOperatingHours.deleteMany({ where: { cartPositionId: { in: oldWhillIds } } });
    await prisma.demandTemplate.deleteMany({ where: { cartPositionId: { in: oldWhillIds } } });
    await prisma.cartPosition.deleteMany({ where: { id: { in: oldWhillIds } } });
  }

  const positions = [
    { code: "A", name: "Aカート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00", color: "#3b82f6" },
    { code: "B", name: "Bカート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00", color: "#a855f7" },
    { code: "全", name: "全カート", category: "CART" as const, operatingStartTime: "05:00", operatingEndTime: "23:00", color: "#22c55e" },
    { code: "BF", name: "BF", category: "SPECIAL" as const, color: "#f97316" },
    { code: "BREAK", name: "休憩 (Nghỉ giải lao)", category: "SPECIAL" as const, color: "#94a3b8" },
    { code: "MOVE", name: "移動 (Di chuyển)", category: "SPECIAL" as const, color: "#eab308" },
    { code: "WHILL_ARRIVAL_PREP", name: "WHILL到着準備", category: "SPECIAL" as const, color: "#06b6d4" },
    { code: "WHILL_ARRIVAL_CLEANUP", name: "WHILL到着片づけ", category: "SPECIAL" as const, color: "#0891b2" },
    { code: "WHILL_DEPARTURE_PREP", name: "WHILL出発準備", category: "SPECIAL" as const, color: "#14b8a6" },
    { code: "WHILL_DEPARTURE_CLEANUP", name: "WHILL出発片づけ", category: "SPECIAL" as const, color: "#0d9488" },
    { code: "OFFICE", name: "事務時間", category: "SPECIAL" as const, color: "#64748b" },
    { code: "MTG", name: "Họp", category: "SPECIAL" as const, color: "#ef4444" },
  ];
  for (const p of positions) {
    // update: {} — 既存レコードの color 等はここで上書きしない（管理画面で設定した値をデプロイのたびに消さないため）
    await prisma.cartPosition.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  // --- 優先順位（自動アサイン時の初期値。管理者が後からUIで変更可能） ---
  // INCは業務アサイン対象外（監督役割）のため優先順位の対象に含めない
  const rolePriorities: { role: "INC" | "STAFF" | "CONTRACT" | "PARTTIME" | "OJT"; priorityOrder: number }[] = [
    { role: "INC", priorityOrder: 1 },
    { role: "STAFF", priorityOrder: 2 },
    { role: "CONTRACT", priorityOrder: 3 },
    { role: "PARTTIME", priorityOrder: 4 },
    { role: "OJT", priorityOrder: 5 },
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

  // --- 正社員・契約社員用: 4日8-17 → 2休 → 4日13-22 → 2休 → 繰り返し ---
  // どちらのシフトから開始するか選べるよう、2つのバリエーションを用意する（開始日はanchorDateで指定）。
  // 早番=08:00-17:00, 遅番=13:00-22:00（既存のShiftTypeをそのまま使用）
  const regularPatterns = [
    {
      code: "REGULAR_START_EARLY",
      name: "正社員・契約社員（8-17開始）",
      patternDefinition: {
        cycleDays: 12,
        pattern: ["WORK", "WORK", "WORK", "WORK", "OFF", "OFF", "WORK", "WORK", "WORK", "WORK", "OFF", "OFF"],
        shiftCodes: ["早番", "早番", "早番", "早番", null, null, "遅番", "遅番", "遅番", "遅番", null, null],
      },
    },
    {
      code: "REGULAR_START_LATE",
      name: "正社員・契約社員（13-22開始）",
      patternDefinition: {
        cycleDays: 12,
        pattern: ["WORK", "WORK", "WORK", "WORK", "OFF", "OFF", "WORK", "WORK", "WORK", "WORK", "OFF", "OFF"],
        shiftCodes: ["遅番", "遅番", "遅番", "遅番", null, null, "早番", "早番", "早番", "早番", null, null],
      },
    },
  ];
  for (const rp of regularPatterns) {
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
