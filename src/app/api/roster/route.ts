import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/roster?month=2026-07 — toàn bộ Master Roster của tháng đó, kèm danh sách nhân viên
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month"); // "2026-07"
  if (!month) return NextResponse.json({ error: "Thiếu tham số month" }, { status: 400 });

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

const RosterInput = z.object({
  employeeId: z.string(),
  workDate: z.string(), // "2026-07-01"
  shiftTypeId: z.string().nullable().optional(),
  status: z.enum(["WORK", "PAID_LEAVE", "ADJUST_LEAVE"]).default("WORK"),
});

// POST /api/roster — tạo/cập nhật ca của 1 nhân viên trong 1 ngày (upsert). Chỉ Admin.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Chỉ Admin được sửa lịch tháng" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RosterInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeId, workDate, shiftTypeId, status } = parsed.data;

  const entry = await prisma.monthRoster.upsert({
    where: { employeeId_workDate: { employeeId, workDate: new Date(workDate) } },
    update: { shiftTypeId: shiftTypeId ?? null, status, updatedBy: session.user.email ?? undefined },
    create: {
      employeeId,
      workDate: new Date(workDate),
      shiftTypeId: shiftTypeId ?? null,
      status,
      createdBy: session.user.email ?? undefined,
    },
    include: { shiftType: true },
  });

  return NextResponse.json(entry);
}
