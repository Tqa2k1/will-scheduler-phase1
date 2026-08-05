import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildAutoAssignPlan, computeShortageCount, DemandByCode } from "@/lib/autoAssign";
import { z } from "zod";

const InputSchema = z.object({ date: z.string() });

// POST /api/schedule/auto-assign — 1日分の業務を自動配置（既存の割り当ては上書き。管理者のみ）
// 制約ルール（休憩の重複禁止・2時間ブロック・必要人数の上限・A/B/全を1日1回ずつ・準備/片付けの固定など）
// は src/lib/autoAssign.ts の buildAutoAssignPlan を参照。
export async function POST(req: NextRequest) {
  try {
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

    const positions = await prisma.cartPosition.findMany({
      where: { code: { in: ["A", "B", "全", "BREAK", "WHILL_DEPARTURE_PREP", "WHILL_DEPARTURE_CLEANUP"] } },
      include: { requirements: { where: { isActive: true } } },
    });
    const positionIdByCode = new Map(positions.map((p) => [p.code, p.id]));

    // ④ 業務要件から時間帯あたりの必要人数を算出（全役割対象の要件を優先。未設定なら1名）
    const demandByCode: DemandByCode = {};
    for (const p of positions) {
      if (p.code !== "A" && p.code !== "B" && p.code !== "全") continue;
      const req = p.requirements.find((r) => r.appliesToAllRoles) ?? p.requirements[0];
      demandByCode[p.code as "A" | "B" | "全"] = req?.requiredCount ?? 1;
    }

    const plan = buildAutoAssignPlan(rosterItems, demandByCode);
    const targetEmployeeIds = rosterItems.map((r) => r.employeeId);

    const pad = (n: number) => n.toString().padStart(2, "0");
    const slotTime = (idx: number) => `${pad((4 + idx) % 24)}:00`;

    const createData = plan
      .map((entry) => {
        const cartPositionId = positionIdByCode.get(entry.code);
        if (!cartPositionId) return null;
        return {
          employeeId: entry.employeeId,
          workDate,
          slotStart: slotTime(entry.slotIndex),
          slotEnd: slotTime(entry.slotIndex + 1),
          cartPositionId,
          source: "AUTO" as const,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // 1件ずつ await するとスタッフ数が多い場合にトランザクションがタイムアウトしやすいため、
    // 削除 + 一括作成(createMany) にまとめて高速化する。
    await prisma.$transaction([
      prisma.dailyAssignment.deleteMany({ where: { workDate, employeeId: { in: targetEmployeeIds } } }),
      prisma.dailyAssignment.createMany({ data: createData }),
    ]);

    const activeSlotIndexes = new Set<number>();
    for (const r of rosterItems) {
      for (let s = r.activeStartIdx; s < r.activeEndIdx; s++) activeSlotIndexes.add(s);
    }
    const shortageCount = computeShortageCount(plan, activeSlotIndexes);

    return NextResponse.json({ success: true, shortageCount, assignedCount: createData.length });
  } catch (err) {
    console.error("[auto-assign] failed:", err);
    return NextResponse.json(
      { error: "自動割り当て中にエラーが発生しました", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// GET /api/schedule/auto-assign?month=2027-01
// 月次自動割当てを実行する前に、その月に既にDailyAssignmentデータがあるか確認するための軽量エンドポイント。
// 既存の自動割当てロジック本体（POST）は変更しない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "自動割り当ては管理者のみ可能です" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month"); // "2027-01"
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  const existingCount = await prisma.dailyAssignment.count({
    where: { workDate: { gte: rangeStart, lt: rangeEnd } },
  });

  return NextResponse.json({ existingCount });
}
