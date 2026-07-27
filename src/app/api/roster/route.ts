import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/roster?month=2026-07
// 月間勤務表のデータを取得
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { error: "ログインが必要です" },
      { status: 401 }
    );
  }

  const month = req.nextUrl.searchParams.get("month");

  if (!month) {
    return NextResponse.json(
      { error: "月の指定が必要です" },
      { status: 400 }
    );
  }

  const [year, mon] = month.split("-").map(Number);

  if (!year || !mon || mon < 1 || mon > 12) {
    return NextResponse.json(
      { error: "月の形式が正しくありません" },
      { status: 400 }
    );
  }

  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        fullName: "asc",
      },
      select: {
        id: true,
        fullName: true,
        role: true,

        // 基本勤務時間
        baseStartTime: true,
        baseEndTime: true,
      },
    }),

    prisma.monthRoster.findMany({
      where: {
        workDate: {
          gte: rangeStart,
          lt: rangeEnd,
        },
      },
      include: {
        shiftType: true,
      },
      orderBy: {
        workDate: "asc",
      },
    }),
  ]);

  return NextResponse.json({
    employees,
    entries,
  });
}

const RosterInput = z.object({
  employeeId: z.string(),
  workDate: z.string(),

  shiftTypeId: z.string().nullable().optional(),

  status: z
    .enum([
      "WORK",
      "OFF",
      "PAID_LEAVE",
      "ADJUST_LEAVE",
    ])
    .default("WORK"),

  // 特定日の勤務時間
  overrideStartTime: z.string().nullable().optional(),
  overrideEndTime: z.string().nullable().optional(),
});

// POST /api/roster
// 1人の1日分の勤務情報を登録・更新
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { error: "ログインが必要です" },
      { status: 401 }
    );
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "管理者のみ勤務表を編集できます" },
      { status: 403 }
    );
  }

  const body = await req.json();

  const parsed = RosterInput.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const {
    employeeId,
    workDate,
    shiftTypeId,
    status,
    overrideStartTime,
    overrideEndTime,
  } = parsed.data;

  const entry = await prisma.monthRoster.upsert({
    where: {
      employeeId_workDate: {
        employeeId,
        workDate: new Date(workDate),
      },
    },

    update: {
      shiftTypeId: shiftTypeId ?? null,
      status,

      overrideStartTime:
        overrideStartTime !== undefined
          ? overrideStartTime
          : undefined,

      overrideEndTime:
        overrideEndTime !== undefined
          ? overrideEndTime
          : undefined,

      updatedBy: session.user.email ?? undefined,
    },

    create: {
      employeeId,
      workDate: new Date(workDate),

      shiftTypeId: shiftTypeId ?? null,
      status,

      overrideStartTime: overrideStartTime ?? null,
      overrideEndTime: overrideEndTime ?? null,

      createdBy: session.user.email ?? undefined,
    },

    include: {
      shiftType: true,
    },
  });

  return NextResponse.json(entry);
}