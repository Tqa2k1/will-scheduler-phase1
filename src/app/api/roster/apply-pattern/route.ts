import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ApplyInput = z.object({
  employeeIds: z.array(z.string()).min(1),
  rotationPatternId: z.string(),
  anchorDate: z.string(), // サイクルの1日目に対応する日付 "2026-07-01"
  rangeStart: z.string(), // 適用開始日
  rangeEnd: z.string(),   // 適用終了日（含む）
});

// POST /api/roster/apply-pattern
// ローテーションパターン（出勤/公休のサイクル）を対象期間に適用する。
// すでに「有休」「調整休」が入っている日は上書きしない（申請済みの休暇を保護するため）。
// 勤務時間・ShiftTypeはここでは設定しない（基本勤務時間 or 日別スケジュールで別途決める）。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "パターン適用は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = ApplyInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeIds, rotationPatternId, anchorDate, rangeStart, rangeEnd } = parsed.data;

  const pattern = await prisma.rotationPattern.findUnique({ where: { id: rotationPatternId } });
  if (!pattern) return NextResponse.json({ error: "パターンが見つかりません" }, { status: 404 });

  const def = pattern.patternDefinition as { cycleDays: number; pattern: ("WORK" | "OFF")[] };
  const anchor = new Date(anchorDate + "T00:00:00Z");
  const start = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T00:00:00Z");

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const employeeId of employeeIds) {
    // 対象期間の既存データを取得し、有休/調整休はスキップ対象として保護
    const existingEntries = await prisma.monthRoster.findMany({
      where: { employeeId, workDate: { gte: start, lte: end } },
    });
    const protectedDates = new Set(
      existingEntries
        .filter((e) => e.status === "PAID_LEAVE" || e.status === "ADJUST_LEAVE")
        .map((e) => e.workDate.toISOString().slice(0, 10))
    );

    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      const current = new Date(t);
      const dateKey = current.toISOString().slice(0, 10);
      if (protectedDates.has(dateKey)) {
        skippedCount++;
        continue;
      }

      const dayOffset = Math.floor((current.getTime() - anchor.getTime()) / MS_PER_DAY);
      const cycleIndex = ((dayOffset % def.cycleDays) + def.cycleDays) % def.cycleDays;
      const dayStatus = def.pattern[cycleIndex]; // "WORK" | "OFF"

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

    // このパターンを従業員の「現在適用中パターン」として記録（履歴は残す）
    await prisma.employeeRotationPattern.updateMany({
      where: { employeeId, isCurrent: true },
      data: { isCurrent: false },
    });
    await prisma.employeeRotationPattern.create({
      data: { employeeId, rotationPatternId, anchorDate: anchor, isCurrent: true },
    });
  }

  return NextResponse.json({ updatedCount, skippedCount });
}
