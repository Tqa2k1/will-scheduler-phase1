import { prisma } from "@/lib/prisma";
import { PRODUCTIVE_CODES } from "@/lib/autoAssign";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";

export type BackfillResult = {
  removedAssignments: number;
  backfilledSlots: number;
  unfilledSlots: number;
};

// 従業員が特定の日に「出勤しない」状態（公休/有休/調整休）に変更された際に呼び出す。
// 1) その日のその従業員の割り当てをすべて削除する
// 2) 削除した中で車A/車B/全（人員が必要な業務）だった枠は、優先順位に従って他の出勤者から
//    代わりの人を自動的に探して割り当てる（見つからなければ空欄のまま＝既存の不足ハイライトで表示される）
export async function attemptBackfillOnRosterChange(employeeId: string, workDate: Date): Promise<BackfillResult> {
  const removedEntries = await prisma.dailyAssignment.findMany({
    where: { employeeId, workDate },
    include: { cartPosition: true },
  });

  if (removedEntries.length === 0) {
    return { removedAssignments: 0, backfilledSlots: 0, unfilledSlots: 0 };
  }

  await prisma.dailyAssignment.deleteMany({ where: { employeeId, workDate } });

  const vacatedProductiveSlots = removedEntries.filter((e) =>
    (PRODUCTIVE_CODES as readonly string[]).includes(e.cartPosition.code)
  );

  if (vacatedProductiveSlots.length === 0) {
    return { removedAssignments: removedEntries.length, backfilledSlots: 0, unfilledSlots: 0 };
  }

  // その日出勤中の他の従業員（本人を除く）
  const workingToday = await prisma.monthRoster.findMany({
    where: { workDate, status: "WORK", employeeId: { not: employeeId } },
    include: { employee: true },
  });

  // 各候補が既に埋まっているスロット（別業務含む）を把握し、二重登録を避ける
  const existingAssignmentsToday = await prisma.dailyAssignment.findMany({ where: { workDate } });
  const occupiedSlotByEmployee = new Set(existingAssignmentsToday.map((a) => `${a.employeeId}-${a.slotStart}`));

  const rolePriorities = await prisma.rolePriority.findMany();
  const priorityByRole = new Map<string, number>(rolePriorities.map((p): [string, number] => [p.role, p.priorityOrder]));
  const priorityOf = (role: string): number => priorityByRole.get(role) ?? 999;

  const candidates = [...workingToday].sort(
    (a, b) => priorityOf(a.employee.role) - priorityOf(b.employee.role)
  );

  let backfilledSlots = 0;
  let unfilledSlots = 0;

  for (const slot of vacatedProductiveSlots) {
    let filled = false;

    for (const candidate of candidates) {
      const key = `${candidate.employeeId}-${slot.slotStart}`;
      if (occupiedSlotByEmployee.has(key)) continue; // 既にその時間に別の業務が入っている

      const withinLimit = await isWithinPartTimeWeeklyLimit(candidate.employeeId, candidate.employee.role, workDate, 0);
      if (!withinLimit) continue; // アルバイトの週20時間上限を超える場合は対象外

      await prisma.dailyAssignment.create({
        data: {
          employeeId: candidate.employeeId,
          workDate,
          slotStart: slot.slotStart,
          slotEnd: slot.slotEnd,
          cartPositionId: slot.cartPositionId,
          source: "AUTO",
        },
      });
      occupiedSlotByEmployee.add(key);
      backfilledSlots++;
      filled = true;
      break;
    }

    if (!filled) unfilledSlots++;
  }

  return { removedAssignments: removedEntries.length, backfilledSlots, unfilledSlots };
}
