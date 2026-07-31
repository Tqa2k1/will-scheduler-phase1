import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const UserUpdateInput = z.object({
  employeeId: z.string().nullable().optional(), // 従業員情報の紐付け（既存アカウントも後から変更できるようにする）
  name: z.string().min(1).optional(),
});

// PATCH /api/users/:id — 既存アカウントの紐付け従業員・表示名を変更（管理者のみ）
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "アカウントの編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UserUpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: {
      employeeId: parsed.data.employeeId === undefined ? undefined : parsed.data.employeeId,
      name: parsed.data.name,
    },
    select: { id: true, email: true, name: true, role: true, employeeId: true, employee: { select: { fullName: true } } },
  });

  return NextResponse.json(updated);
}
