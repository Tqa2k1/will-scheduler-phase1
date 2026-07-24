import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/schedule?date=2026-07-01
// Trả về: nhân viên có ca trong ngày đó (theo Master Roster) + toàn bộ Daily Assignment đã có
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date"); // "2026-07-01"
  if (!date) return NextResponse.json({ error: "Thiếu tham số date" }, { status: 400 });

  const workDate = new Date(date);

  const [rosterEntries, assignments] = await Promise.all([
    prisma.monthRoster.findMany({
      where: { workDate, status: "WORK" },
      include: { employee: true, shiftType: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { workDate },
      include: { cartPosition: true },
    }),
  ]);

  return NextResponse.json({ rosterEntries, assignments });
}

const AssignmentInput = z.object({
  employeeId: z.string(),
  workDate: z.string(),
  slotStart: z.string(),
  slotEnd: z.string(),
  cartPositionId: z.string().nullable(), // null = xoá gán (để trống ô)
});

// POST /api/schedule — gán vị trí cho 1 nhân viên tại 1 slot 30 phút (upsert hoặc xoá)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Chỉ Admin được sửa lịch ngày" }, { status: 403 });
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
