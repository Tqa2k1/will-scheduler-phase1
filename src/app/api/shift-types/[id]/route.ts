import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { shiftWindow, validateTimeBands } from "@/lib/shiftRequirements";

const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM 形式で入力してください");

const UpdateInput = z.object({
  code: z.string().trim().min(1, "シフト名を入力してください").max(30).optional(),
  defaultStartTime: TimeString.optional(),
  defaultEndTime: TimeString.optional(),
  requiredCount: z.number().int().min(0).max(99).optional(),
  // 指定した場合は、時間帯別設定を丸ごと置き換える（空配列 = 時間帯別設定なし）
  timeBands: z
    .array(z.object({ startTime: TimeString, endTime: TimeString, requiredCount: z.number().int().min(0).max(99) }))
    .optional(),
});

// PATCH /api/shift-types/[id] — シフト名・時間・基本必要人数・時間帯別必要人数の更新（管理者のみ）
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "シフトの変更は管理者のみ可能です" }, { status: 403 });
  }

  const parsed = UpdateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が正しくありません" }, { status: 400 });
  }

  const current = await prisma.shiftType.findUnique({ where: { id: params.id }, include: { timeBands: true } });
  if (!current) return NextResponse.json({ error: "シフトが見つかりません" }, { status: 404 });

  const { code, requiredCount, timeBands } = parsed.data;
  const startTime = parsed.data.defaultStartTime ?? current.defaultStartTime;
  const endTime = parsed.data.defaultEndTime ?? current.defaultEndTime;
  if (startTime === endTime) return NextResponse.json({ error: "開始時間と終了時間が同じです" }, { status: 400 });

  const bandsToCheck = timeBands ?? current.timeBands;
  const bandError = validateTimeBands({ startTime, endTime }, bandsToCheck);
  if (bandError) return NextResponse.json({ error: bandError }, { status: 400 });

  if (code && code !== current.code) {
    const dup = await prisma.shiftType.findUnique({ where: { code } });
    if (dup) return NextResponse.json({ error: `シフト名「${code}」は既に登録されています` }, { status: 409 });
  }

  const w = shiftWindow(startTime, endTime);
  const updated = await prisma.$transaction(async (tx) => {
    if (timeBands) {
      await tx.shiftTimeBand.deleteMany({ where: { shiftTypeId: params.id } });
      if (timeBands.length > 0) {
        await tx.shiftTimeBand.createMany({ data: timeBands.map((b) => ({ ...b, shiftTypeId: params.id })) });
      }
    }
    return tx.shiftType.update({
      where: { id: params.id },
      data: {
        ...(code ? { code, name: code } : {}),
        defaultStartTime: startTime,
        defaultEndTime: endTime,
        spansMidnight: w.end > 1440,
        ...(requiredCount !== undefined ? { requiredCount } : {}),
      },
      include: { timeBands: { orderBy: { startTime: "asc" } } },
    });
  });
  return NextResponse.json(updated);
}

// DELETE /api/shift-types/[id] — シフトを削除（管理者のみ）。勤務表・希望申請・ローテーションパターンで
// 使用中のシフトは削除できない（過去データや自動生成が壊れるため）。
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "シフトの削除は管理者のみ可能です" }, { status: 403 });
  }

  const shift = await prisma.shiftType.findUnique({ where: { id: params.id } });
  if (!shift) return NextResponse.json({ error: "シフトが見つかりません" }, { status: 404 });

  const [rosterCount, claimCount, patterns] = await Promise.all([
    prisma.monthRoster.count({ where: { shiftTypeId: params.id } }),
    prisma.shiftClaimRequest.count({ where: { shiftTypeId: params.id } }),
    prisma.rotationPattern.findMany({ select: { name: true, patternDefinition: true } }),
  ]);
  if (rosterCount > 0 || claimCount > 0) {
    return NextResponse.json(
      { error: `このシフトは勤務表または希望申請で使用されているため削除できません。必要人数を0にすると人員不足の集計対象から外せます。` },
      { status: 409 }
    );
  }
  const usedByPattern = patterns.find((p) => JSON.stringify(p.patternDefinition).includes(`"${shift.code}"`));
  if (usedByPattern) {
    return NextResponse.json(
      { error: `このシフトはローテーションパターン「${usedByPattern.name}」で使用されているため削除できません。` },
      { status: 409 }
    );
  }

  await prisma.shiftType.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
