import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { z } from "zod";

// GET /api/schedule?date=2026-07-01
// 管理者: その日の全スタッフの勤務者一覧 + ポジション割り当てを返す（従来通り）。
// 従業員(EMPLOYEE): 自分自身の行だけに絞り込んで返す（他の従業員のデータは含めない）。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date パラメータが必要です" }, { status: 400 });

  const workDate = new Date(date);

  const [allRosterItems, allAssignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  if (session.user.role === "EMPLOYEE") {
    const myEmployeeId = session.user.employeeId;
    if (!myEmployeeId) {
      return NextResponse.json({ rosterItems: [], assignments: [], notLinked: true });
    }
    const rosterItems = allRosterItems.filter((r) => r.employeeId === myEmployeeId);
    const assignments = allAssignments.filter((a) => a.employeeId === myEmployeeId);
    return NextResponse.json({ rosterItems, assignments, notLinked: false });
  }

  return NextResponse.json({ rosterItems: allRosterItems, assignments: allAssignments, notLinked: false });
}

const AssignmentInput = z.object({
  employeeId: z.string(),
  workDate: z.string(),
  slotStart: z.string(),
  slotEnd: z.string(),
  cartPositionId: z.string().nullable(),
});

// POST /api/schedule — 1時間スロットにポジションを割り当て（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "日別スケジュールの編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AssignmentInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeId, workDate, slotStart, slotEnd, cartPositionId } = parsed.data;
  const date = new Date(workDate);

  const existing = await prisma.dailyAssignment.findFirst({
    where: { employeeId, workDate: date, slotStart },
  });

  if (!cartPositionId) {
    if (existing) await prisma.dailyAssignment.delete({ where: { id: existing.id } });
    return NextResponse.json({ deleted: true });
  }

  const result = existing
    ? await prisma.dailyAssignment.update({
        where: { id: existing.id },
        data: { cartPositionId, slotEnd, source: "MANUAL" },
        include: { cartPosition: true },
      })
    : await prisma.dailyAssignment.create({
        data: { employeeId, workDate: date, slotStart, slotEnd, cartPositionId, source: "MANUAL" },
        include: { cartPosition: true },
      });

  return NextResponse.json(result);
}