import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncUserNameFromEmployee } from "@/lib/userEmployeeLink";

// PATCH /api/employees/:id — chỉ ADMIN được sửa
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "従業員情報の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const before = await prisma.employee.findUnique({ where: { id: params.id } });
  const updated = await prisma.employee.update({ where: { id: params.id }, data: body });
  // 氏名を変更した場合は、紐付いているログインアカウントの表示名も同期する（正のデータは従業員の氏名）
  if (typeof body?.fullName === "string" && before && body.fullName !== before.fullName) {
    await syncUserNameFromEmployee(params.id);
  }

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
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "従業員の削除は管理者のみ可能です" }, { status: 403 });
  }

  const updated = await prisma.employee.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  // 削除した従業員にアカウントが紐付いたままだと、アカウント管理の「紐付け従業員」に
  // 削除済みの従業員が残ってしまうため、紐付けを解除する（アカウント自体は残る）。
  await prisma.user.updateMany({ where: { employeeId: params.id }, data: { employeeId: null } });

  return NextResponse.json(updated);
}
