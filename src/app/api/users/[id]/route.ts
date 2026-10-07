import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { validateLinkableEmployee } from "@/lib/userEmployeeLink";

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

  if (parsed.data.employeeId) {
    const check = await validateLinkableEmployee(parsed.data.employeeId, params.id);
    if (check) return NextResponse.json({ error: check.error }, { status: check.status });
  }

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

// DELETE /api/users/:id — 既存アカウントを削除（管理者のみ）
// 削除するのは User（ログインアカウント）1件のみ。紐付いている従業員（Employee）や、
// その従業員のシフト・勤務表・申請などのデータには一切触れない
// （User側が employeeId を持つ片方向の参照のため、Userを消しても従業員データは残る）。
// 削除後はそのメールアドレスではログインできなくなる（既存セッションも auth.ts で無効化される）。
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "アカウントの削除は管理者のみ可能です" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: "アカウントが見つかりません" }, { status: 404 });

  // 自分自身の削除・最後の管理者の削除は、誰もログインできなくなるため不可
  if (target.id === session.user.id) {
    return NextResponse.json({ error: "自分自身のアカウントは削除できません" }, { status: 400 });
  }
  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "最後の管理者アカウントは削除できません" }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
