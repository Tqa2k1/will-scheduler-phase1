import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { shiftWindow, validateTimeBands } from "@/lib/shiftRequirements";

// GET /api/shift-types — シフト一覧（基本必要人数・時間帯別必要人数つき）
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const shiftTypes = await prisma.shiftType.findMany({
    orderBy: { code: "asc" },
    include: { timeBands: { orderBy: { startTime: "asc" } } },
  });
  return NextResponse.json(shiftTypes);
}

const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM 形式で入力してください");
const TimeBandInput = z.object({
  startTime: TimeString,
  endTime: TimeString,
  requiredCount: z.number().int().min(0).max(99),
});

const CreateInput = z.object({
  code: z.string().trim().min(1, "シフト名を入力してください").max(30),
  defaultStartTime: TimeString,
  defaultEndTime: TimeString,
  requiredCount: z.number().int().min(0).max(99),
  timeBands: z.array(TimeBandInput).default([]),
});

// POST /api/shift-types — シフトを追加（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "シフトの追加は管理者のみ可能です" }, { status: 403 });
  }

  const parsed = CreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が正しくありません" }, { status: 400 });
  }
  const { code, defaultStartTime, defaultEndTime, requiredCount, timeBands } = parsed.data;
  if (defaultStartTime === defaultEndTime) {
    return NextResponse.json({ error: "開始時間と終了時間が同じです" }, { status: 400 });
  }
  const bandError = validateTimeBands({ startTime: defaultStartTime, endTime: defaultEndTime }, timeBands);
  if (bandError) return NextResponse.json({ error: bandError }, { status: 400 });

  const exists = await prisma.shiftType.findUnique({ where: { code } });
  if (exists) return NextResponse.json({ error: `シフト名「${code}」は既に登録されています` }, { status: 409 });

  const w = shiftWindow(defaultStartTime, defaultEndTime);
  const created = await prisma.shiftType.create({
    data: {
      code,
      name: code,
      defaultStartTime,
      defaultEndTime,
      spansMidnight: w.end > 1440,
      requiredCount,
      timeBands: { create: timeBands },
    },
    include: { timeBands: true },
  });
  return NextResponse.json(created, { status: 201 });
}
