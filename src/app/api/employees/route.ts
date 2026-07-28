import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const EmployeeInput = z.object({
  fullName: z.string().min(1),
  role: z.enum(["INC", "STAFF", "CONTRACT", "PARTTIME", "OJT"]).default("STAFF"),
  commuteType: z.enum(["TAXI_ONE_WAY", "OWN_CAR", "OTHER"]).optional(),
  note: z.string().optional(),
  baseStartTime: z.string().optional(), // 基本勤務時間 開始 例:"08:00"
  baseEndTime: z.string().optional(),   // 基本勤務時間 終了 例:"17:00"
});

// GET /api/employees — danh sách nhân viên (mọi user đã đăng nhập đều xem được)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const employees = await prisma.employee.findMany({
    orderBy: { fullName: "asc" },
  });
  return NextResponse.json(employees);
}

// POST /api/employees — chỉ ADMIN được tạo mới nhân viên
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "従業員の追加は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = EmployeeInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const employee = await prisma.employee.create({ data: parsed.data });

  await prisma.rosterAuditLog.create({
    data: {
      tableName: "Employee",
      recordId: employee.id,
      action: "CREATE",
      changedBy: session.user.email ?? undefined,
      newValue: employee as any,
    },
  });

  return NextResponse.json(employee, { status: 201 });
}
