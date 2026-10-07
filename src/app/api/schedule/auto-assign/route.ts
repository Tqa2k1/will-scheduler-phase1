import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildAutoAssignPlan, DemandByCode } from "@/lib/autoAssign";
import { computeShortageCells, BATTERY_CODE } from "@/lib/dutySchedule";
import { ensureBatteryPosition } from "@/lib/systemPositions";
import { isNightCrewItem, planNightCrew } from "@/lib/nightCrewPlan";
import { getRequiredHeadcountBySlot } from "@/lib/shiftRequirements";
import { z } from "zod";

const InputSchema = z.object({ date: z.string() });

// POST /api/schedule/auto-assign — 1日分の業務を自動配置（既存の割り当ては上書き。管理者のみ）
// 優先順位（①業務A ②業務B ③業務全 ④WHILL関連業務 ⑤休憩 ⑥事務時間）とローテーション・
// 休憩ルールの詳細は docs/AUTO_ASSIGN_RULES.md および src/lib/autoAssign.ts の
// buildAutoAssignPlan を参照。
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
    await ensureBatteryPosition(); // 既存DBに「バッテリー交換」が無ければ業務マスタへ追加
    const [rosterItems, rolePriorities] = await Promise.all([
      buildDailyRosterView(workDate),
      prisma.rolePriority.findMany(),
    ]);
    // ⑦ 業務優先順位: 管理画面で設定された RolePriority を必ず反映する（ランダム配置は禁止）。
    // src/lib/autoBackfill.ts と同じ考え方・同じフォールバック（未設定=999＝最低優先）。
    const priorityByRole: Record<string, number> = Object.fromEntries(
      rolePriorities.map((p) => [p.role, p.priorityOrder])
    );

    const positions = await prisma.cartPosition.findMany({
      where: {
        code: {
          in: [
            "A",
            "B",
            "全",
            "BREAK",
            "OFFICE",
            BATTERY_CODE,
            "WHILL_ARRIVAL_PREP",
            "WHILL_ARRIVAL_CLEANUP",
            "WHILL_DEPARTURE_PREP",
            "WHILL_DEPARTURE_CLEANUP",
          ],
        },
      },
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

    // INCが /shift-settings で設定したシフト必要人数（時間帯別を含む）。日別スケジュールの
    // 「配置状況」表示と同じ設定（/api/schedule/required-headcount）を使う。
    const totalBySlot = await getRequiredHeadcountBySlot();

    const plan = buildAutoAssignPlan(rosterItems, demandByCode, priorityByRole, totalBySlot);
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

    // 人員不足は「保存後の実際の割当て」から画面(日別スケジュール)と同じ計算で数え直す。
    // 稼働時間外・必要人数を満たしているコマは数えない。
    const saved = await prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } });
    const shortageCells = computeShortageCells(
      saved.map((a) => ({ code: a.cartPosition.code, slotStart: a.slotStart, slotEnd: a.slotEnd })),
      demandByCode,
      totalBySlot
    );
    const shortageCount = shortageCells.length;

    // バッテリー交換の注意（未配置・対象外人数）
    const warnings: string[] = [];
    if (!positionIdByCode.has(BATTERY_CODE)) warnings.push("業務「バッテリー交換」が業務マスタにないため配置できませんでした。");
    const crewToday = rosterItems.filter((r) => !r.isCarryOver && isNightCrewItem(r));
    const crewCarry = rosterItems.filter((r) => r.isCarryOver && isNightCrewItem(r));
    const toCrew = (l: typeof rosterItems) => l.map((p) => ({ employeeId: p.employeeId, employeeRole: p.employeeRole }));
    if (crewToday.length > 0 && !planNightCrew(toCrew(crewToday), demandByCode, totalBySlot)) {
      warnings.push(`22時勤務が${crewToday.length}名のため（3名・4名のみ対象）、バッテリー交換と夜勤Break調整は行っていません。`);
    }
    const batteryCount = (from: number, to: number) => plan.filter((e) => e.code === BATTERY_CODE && e.slotIndex >= from && e.slotIndex <= to).length;
    if (crewToday.length > 0 && planNightCrew(toCrew(crewToday), demandByCode, totalBySlot) && batteryCount(21, 22) === 0) {
      warnings.push("1:00〜2:00のバッテリー交換を配置できる人がいませんでした（パート・アルバイト除く）。");
    }
    if (crewCarry.length > 0 && planNightCrew(toCrew(crewCarry), demandByCode, totalBySlot) && batteryCount(0, 0) === 0) {
      warnings.push("4:00のバッテリー交換を配置できる人がいませんでした（パート・アルバイト除く）。");
    }

    return NextResponse.json({
      success: true,
      shortageCount,
      shortageCells,
      warnings,
      assignedCount: createData.length,
      droppedCount: plan.length - createData.length,
    });
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
