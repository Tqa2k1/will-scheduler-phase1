import { prisma } from "@/lib/prisma";
import type { DutyCode } from "@/lib/dutySchedule";

// 業務A/B/全の「時間帯あたり必要人数」を業務管理の設定（有効な業務要件のみ）から求める。
// 自動割当てAPI（/api/schedule/auto-assign）と同じ算出方法。全役割対象の要件を優先し、未設定なら1名。
export async function loadDemandByCode(): Promise<Partial<Record<DutyCode, number>>> {
  const positions = await prisma.cartPosition.findMany({
    where: { code: { in: ["A", "B", "全"] } },
    include: { requirements: { where: { isActive: true } } },
  });
  const demand: Partial<Record<DutyCode, number>> = {};
  for (const p of positions) {
    const req = p.requirements.find((r) => r.appliesToAllRoles) ?? p.requirements[0];
    demand[p.code as DutyCode] = req?.requiredCount ?? 1;
  }
  return demand;
}
