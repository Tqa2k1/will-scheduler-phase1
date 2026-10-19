import { prisma } from "@/lib/prisma";
import { BATTERY_CODE } from "@/lib/dutySchedule";

export { SYSTEM_POSITION_CODES, isSystemPositionCode } from "@/lib/systemPositionCodes";

// 「バッテリー交換」を業務マスタに用意する（無ければ作成。既にあれば何も変更しない）。
// prisma/seed.ts は既存DBでは再実行されないことがあるため、業務一覧の取得時と
// 自動割当て時に呼び出して、既存DBにも確実に反映する。
export async function ensureBatteryPosition(): Promise<void> {
  const existing = await prisma.cartPosition.findUnique({ where: { code: BATTERY_CODE } });
  if (existing) return;
  try {
    const created = await prisma.cartPosition.create({
      data: {
        code: BATTERY_CODE,
        name: "バッテリー交換",
        category: "SPECIAL",
        description: "22時勤務のみ自動割当て（1回目 1:00または2:00 / 2回目 4:00）。60分単位。",
        color: "#f59e0b",
      },
    });
    await prisma.taskRequirement.create({
      data: { cartPositionId: created.id, appliesToAllRoles: true, requiredCount: 1, note: "60分単位" },
    });
  } catch (err) {
    // 同時実行で他方が先に作成した場合(P2002)は問題なし
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
}
