import { prisma } from "@/lib/prisma";

// その日に必要な合計人数（業務要件 TaskRequirement の requiredCount を合算）と、
// 実際に出勤予定の人数（MonthRoster status=WORK の人数）を比較し、不足人数を算出する。
// 例: Aカート4名 + Bカート4名 + 全カート4名 → 1日の必要人数12名。
// 業務要件が未設定の場合は、A/B/全それぞれ4名を暫定デフォルトとして扱う。
export async function getDailyStaffingStatus(date: Date): Promise<{
  requiredTotal: number;
  scheduledTotal: number;
  shortage: number;
}> {
  const requirements = await prisma.taskRequirement.findMany({
    where: { isActive: true, cartPosition: { category: "CART", isActive: true } },
    include: { cartPosition: true },
  });

  let requiredTotal: number;
  if (requirements.length > 0) {
    requiredTotal = requirements.reduce((sum, r) => sum + r.requiredCount, 0);
  } else {
    // 業務要件が未設定の場合の暫定デフォルト（A/B/全 各4名 = 合計12名）
    const cartPositions = await prisma.cartPosition.findMany({ where: { category: "CART", isActive: true } });
    requiredTotal = cartPositions.length * 4;
  }

  const scheduledTotal = await prisma.monthRoster.count({
    where: { workDate: date, status: "WORK" },
  });

  return {
    requiredTotal,
    scheduledTotal,
    shortage: Math.max(0, requiredTotal - scheduledTotal),
  };
}
