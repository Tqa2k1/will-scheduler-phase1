import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { attemptBackfillOnRosterChange } from "@/lib/autoBackfill";
import { z } from "zod";

// GET /api/roster?month=2026-07 — 月間勤務表データ + 従業員一覧
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month"); // "2026-07"
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
    prisma.monthRoster.findMany({
      where: { workDate: { gte: rangeStart, lt: rangeEnd } },
      include: { shiftType: true },
    }),
  ]);

  return NextResponse.json({ employees, entries });
}

// 部分更新に対応: 送られてきたフィールドだけ更新し、未指定のフィールドは既存値を維持する
const RosterPartialInput = z.object({
  employeeId: z.string(),
  workDate: z.string(), // "2026-07-01"
  shiftTypeId: z.string().nullable().optional(),
  status: z.enum(["WORK", "OFF", "PAID_LEAVE", "ADJUST_LEAVE"]).optional(),
  overrideStartTime: z.string().nullable().optional(),
  overrideEndTime: z.string().nullable().optional(),
});

// POST /api/roster — 1日分のシフト/ステータス/例外時間を作成・更新（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "月間勤務表の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RosterPartialInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeId, workDate, ...fields } = parsed.data;
  const date = new Date(workDate);

  const entry = await prisma.monthRoster.upsert({
    where: { employeeId_workDate: { employeeId, workDate: date } },
    update: { ...fields, updatedBy: session.user.email ?? undefined },
    create: {
      employeeId,
      workDate: date,
      status: fields.status ?? "WORK",
      shiftTypeId: fields.shiftTypeId ?? null,
      overrideStartTime: fields.overrideStartTime ?? null,
      overrideEndTime: fields.overrideEndTime ?? null,
      createdBy: session.user.email ?? undefined,
    },
    include: { shiftType: true },
  });

  // 出勤しない状態に変更された場合、その日に既に割り当てられていた業務（車A/車B/全等）が
  // 欠員にならないよう、優先順位に従って自動的に代わりの人を探す（見つからなければ不足のまま）。
  let backfill: { removedAssignments: number; backfilledSlots: number; unfilledSlots: number } | null = null;
  if (entry.status !== "WORK") {
    backfill = await attemptBackfillOnRosterChange(employeeId, date);
  }

  return NextResponse.json({ ...entry, backfill });
}
