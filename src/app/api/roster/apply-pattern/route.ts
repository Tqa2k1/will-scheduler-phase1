import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ApplyInput = z.object({
  employeeIds: z.array(z.string()).min(1),
  rotationPatternId: z.string(),
  anchorDate: z.string(), // サイクルの1日目に対応する日付 "2026-07-01"
  rangeStart: z.string(), // 適用開始日（＝最初に作成する月の範囲）
  rangeEnd: z.string(),   // 適用終了日（含む）
  continueToYearEnd: z.boolean().optional().default(false), // rangeStartと同じ年の12月末まで自動継続
  overwriteExisting: z.boolean().optional().default(false), // 自動継続分で既存データがある月も上書きするか
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7); // "YYYY-MM"

// POST /api/roster/apply-pattern
// ローテーションパターン（出勤/公休のサイクル）を対象期間に適用する。
// すでに「有休」「調整休」が入っている日は上書きしない（申請済みの休暇を保護するため）。
// 勤務時間・ShiftTypeはここでは設定しない（基本勤務時間 or 日別スケジュールで別途決める）。
//
// continueToYearEnd = true の場合、rangeStart〜rangeEnd（最初に選んだ月）を適用した後、
// 同じ anchorDate・同じサイクル計算のまま rangeStart と同じ年の12月末まで自動的に続けて生成する
// （サイクルはanchorDateからの日数で計算されるため、月をまたいでも自然に継続する＝再スタートしない）。
// 自動継続で対象になる「元のrangeEndより後の月」は、既にWORK/OFFデータが存在する月は
// overwriteExisting=true でない限りスキップし、上書きしない（要件5）。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "パターン適用は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = ApplyInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeIds, rotationPatternId, anchorDate, rangeStart, rangeEnd, continueToYearEnd, overwriteExisting } = parsed.data;

  const pattern = await prisma.rotationPattern.findUnique({ where: { id: rotationPatternId } });
  if (!pattern) return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });

  const def = pattern.patternDefinition as { cycleDays: number; pattern: ("WORK" | "OFF")[] };
  const anchor = new Date(anchorDate + "T00:00:00Z");
  const start = new Date(rangeStart + "T00:00:00Z");
  const originalEnd = new Date(rangeEnd + "T00:00:00Z");

  // 自動継続時の最終日＝rangeStartと同じ年の12月31日（元のrangeEndがそれより後ならそちらを優先）
  const yearEnd = new Date(Date.UTC(start.getUTCFullYear(), 11, 31));
  const effectiveEnd = continueToYearEnd && yearEnd.getTime() > originalEnd.getTime() ? yearEnd : originalEnd;

  let updatedCount = 0;
  let skippedLeaveCount = 0; // 有休/調整休により保護されてスキップした日数
  let skippedExistingMonthCount = 0; // 自動継続分で既存データがあったためスキップした日数
  const skippedMonthsByEmployee: { employeeId: string; employeeName: string; months: string[] }[] = [];

  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } } });
  const employeeNameById = new Map<string, string>(employees.map((e): [string, string] => [e.id, e.fullName]));

  for (const employeeId of employeeIds) {
    // 対象期間全体の既存データを取得
    const existingEntries = await prisma.monthRoster.findMany({
      where: { employeeId, workDate: { gte: start, lte: effectiveEnd } },
    });

    // 有休/調整休の日付は常に保護（元々の挙動と同じ）
    const protectedLeaveDates = new Set(
      existingEntries
        .filter((e) => e.status === "PAID_LEAVE" || e.status === "ADJUST_LEAVE")
        .map((e) => dateKey(e.workDate))
    );

    // 自動継続で新たに対象になる「元のrangeEndより後」の月ごとに、既存のWORK/OFFデータがあるか確認
    const skipMonths = new Set<string>();
    if (continueToYearEnd && !overwriteExisting) {
      const extendedExistingMonths = new Set<string>(
        existingEntries
          .filter((e) => e.workDate.getTime() > originalEnd.getTime() && (e.status === "WORK" || e.status === "OFF"))
          .map((e): string => monthKey(e.workDate))
      );
      for (const m of extendedExistingMonths) skipMonths.add(m);
    }
    if (skipMonths.size > 0) {
      skippedMonthsByEmployee.push({
        employeeId,
        employeeName: employeeNameById.get(employeeId) ?? employeeId,
        months: [...skipMonths].sort(),
      });
    }

    for (let t = start.getTime(); t <= effectiveEnd.getTime(); t += MS_PER_DAY) {
      const current = new Date(t);
      const key = dateKey(current);

      if (protectedLeaveDates.has(key)) {
        skippedLeaveCount++;
        continue;
      }
      if (skipMonths.has(monthKey(current))) {
        skippedExistingMonthCount++;
        continue;
      }

      // サイクル計算はanchorDateからの経過日数のみに依存するため、月をまたいでも自然に継続する
      const dayOffset = Math.floor((current.getTime() - anchor.getTime()) / MS_PER_DAY);
      const cycleIndex = ((dayOffset % def.cycleDays) + def.cycleDays) % def.cycleDays;
      const dayStatus = def.pattern[cycleIndex];

      await prisma.monthRoster.upsert({
        where: { employeeId_workDate: { employeeId, workDate: current } },
        update: {
          status: dayStatus === "WORK" ? "WORK" : "OFF",
          updatedBy: session.user.email ?? undefined,
        },
        create: {
          employeeId,
          workDate: current,
          status: dayStatus === "WORK" ? "WORK" : "OFF",
          createdBy: session.user.email ?? undefined,
        },
      });
      updatedCount++;
    }

    await prisma.employeeRotationPattern.updateMany({
      where: { employeeId, isCurrent: true },
      data: { isCurrent: false },
    });
    await prisma.employeeRotationPattern.create({
      data: { employeeId, rotationPatternId, anchorDate: anchor, isCurrent: true },
    });
  }

  return NextResponse.json({
    updatedCount,
    skippedCount: skippedLeaveCount, // 既存レスポンス形式との互換性を維持
    skippedLeaveCount,
    skippedExistingMonthCount,
    skippedMonthsByEmployee,
  });
}
