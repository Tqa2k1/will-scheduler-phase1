import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { getRosterVisibility } from "@/lib/rosterAccess";
import { monthKeyOfDate } from "@/lib/monthStatusShared";
import { z } from "zod";

// GET /api/schedule?date=2026-07-01
// 管理者・従業員(EMPLOYEE)ともに、その日の全スタッフの勤務者一覧 + ポジション割り当てを返す。
// 閲覧内容は同じ（誰が・どの業務を・何時から何時まで）。書き込み(POST)は管理者のみに制限されている。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date パラメータが必要です" }, { status: 400 });

  const workDate = new Date(date);
  if (Number.isNaN(workDate.getTime())) return NextResponse.json({ error: "date が不正です" }, { status: 400 });

  // 一般従業員は、月が「確定」（メール配信完了）になるまで、その月のシフト内容（誰がいつ勤務か）を取得できない
  if (!isManagerRole(session.user.role)) {
    const vis = await getRosterVisibility(session.user, monthKeyOfDate(workDate));
    if (!vis.fullAccess) return NextResponse.json({ rosterItems: [], assignments: [], monthStatus: "ADJUSTING" });
  }

  const [rosterItems, assignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  return NextResponse.json({ rosterItems, assignments });
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
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "アサイン表の編集は管理者のみ可能です" }, { status: 403 });
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