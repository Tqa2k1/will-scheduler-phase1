import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildAutoAssignPlan, computeShortageCount } from "@/lib/autoAssign";
import { z } from "zod";

const InputSchema = z.object({ date: z.string() });

// POST /api/schedule/auto-assign — 1日分の業務を自動配置（既存の割り当ては上書き。管理者のみ）
// 制約ルール（休憩の重複禁止・2時間ブロック・A/B/全を1日1回ずつ・準備/片付けの固定など）は
// src/lib/autoAssign.ts の buildAutoAssignPlan を参照。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "自動割り当ては管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const workDate = new Date(parsed.data.date);
  const rosterItems = await buildDailyRosterView(workDate);
  const plan = buildAutoAssignPlan(rosterItems);

  const positions = await prisma.cartPosition.findMany({
    where: { code: { in: ["A", "B", "全", "BREAK", "WHILL_PREP", "WHILL_CLEANUP"] } },
  });
  const positionIdByCode = new Map(positions.map((p) => [p.code, p.id]));

  // INCを含む全スタッフが自動割り当ての対象（優先順位にINCが含まれるようになったため）
  const targetEmployeeIds = rosterItems.map((r) => r.employeeId);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const slotTime = (idx: number) => {
    const h = (4 + idx) % 24;
    return `${pad(h)}:00`;
  };

  await prisma.$transaction(async (tx) => {
    await tx.dailyAssignment.deleteMany({ where: { workDate, employeeId: { in: targetEmployeeIds } } });

    for (const entry of plan) {
      const cartPositionId = positionIdByCode.get(entry.code);
      if (!cartPositionId) continue;
      await tx.dailyAssignment.create({
        data: {
          employeeId: entry.employeeId,
          workDate,
          slotStart: slotTime(entry.slotIndex),
          slotEnd: slotTime(entry.slotIndex + 1),
          cartPositionId,
          source: "AUTO",
        },
      });
    }
  });

  const activeSlotIndexes = new Set<number>();
  for (const r of rosterItems) {
    for (let s = r.activeStartIdx; s < r.activeEndIdx; s++) activeSlotIndexes.add(s);
  }
  const shortageCount = computeShortageCount(plan, activeSlotIndexes);

  return NextResponse.json({ success: true, shortageCount });
}
