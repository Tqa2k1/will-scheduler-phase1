import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/employees/:id — chỉ ADMIN được sửa
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Chỉ Admin được sửa nhân viên" }, { status: 403 });
  }

  const body = await req.json();
  const before = await prisma.employee.findUnique({ where: { id: params.id } });
  const updated = await prisma.employee.update({ where: { id: params.id }, data: body });

  await prisma.rosterAuditLog.create({
    data: {
      tableName: "Employee",
      recordId: updated.id,
      action: "UPDATE",
      changedBy: session.user.email ?? undefined,
      oldValue: before as any,
      newValue: updated as any,
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/employees/:id — chỉ ADMIN, xoá mềm (isActive = false)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Chỉ Admin được xoá nhân viên" }, { status: 403 });
  }

  const updated = await prisma.employee.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  return NextResponse.json(updated);
}
