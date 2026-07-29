import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildAutoAssignPlan } from "@/lib/autoAssign";
import { z } from "zod";

const InputSchema = z.object({ date: z.string() });

// POST /api/schedule/auto-assign — 1日分のポジションを自動でローテーション割り当て（既存の割り当ては上書き。管理者のみ）
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

  const positions = await prisma.cartPosition.findMany({ where: { code: { in: ["A", "B", "全", "BREAK"] } } });
  const positionIdByCode = new Map(positions.map((p) => [p.code, p.id]));

  const targetEmployeeIds = rosterItems.filter((r) => r.employeeRole !== "INC").map((r) => r.employeeId);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const slotTime = (idx: number) => {
    const h = (4 + idx) % 24;
    return `${pad(h)}:00`;
  };

  await prisma.$transaction(async (tx) => {
    // 対象日・対象従業員の既存の割り当てを削除してから再生成する
    await tx.dailyAssignment.deleteMany({ where: { workDate, employeeId: { in: targetEmployeeIds } } });

    for (const slotResult of plan) {
      const slotStart = slotTime(slotResult.slotIndex);
      const slotEnd = slotTime(slotResult.slotIndex + 1);
      for (const a of slotResult.assignments) {
        const cartPositionId = positionIdByCode.get(a.code);
        if (!cartPositionId) continue;
        await tx.dailyAssignment.create({
          data: { employeeId: a.employeeId, workDate, slotStart, slotEnd, cartPositionId, source: "AUTO" },
        });
      }
    }
  });

  const shortageCount = plan.reduce((sum, s) => sum + s.shortagePositions.length, 0);
  return NextResponse.json({ success: true, shortageCount });
}
