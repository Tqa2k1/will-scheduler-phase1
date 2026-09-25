import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ReorderInput = z.object({
  role: z.enum(["INC", "RESPONSIBLE", "STAFF", "CONTRACT", "PARTTIME", "OJT"]),
  // 同じroleに属する従業員のID一覧。並び順（配列のindex）がそのまま優先順位になる（先頭ほど優先度が高い）。
  orderedIds: z.array(z.string()).min(1),
});

// PATCH /api/employees/reorder — 同じ役割(role)内での従業員の優先順位を一括更新（管理者のみ）
// 役割ごとの優先順位(RolePriority)は変更しない。あくまで同じrole内の並び順のみを更新する。
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "優先順位の変更は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = ReorderInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { role, orderedIds } = parsed.data;

  // 指定されたIDが本当にそのroleの従業員かを確認してから更新する（他roleの従業員を誤って
  // 巻き込まないようにするため）。
  const employees = await prisma.employee.findMany({
    where: { id: { in: orderedIds }, role },
    select: { id: true },
  });
  const validIds = new Set(employees.map((e) => e.id));

  await prisma.$transaction(
    orderedIds
      .filter((id) => validIds.has(id))
      .map((id, index) =>
        prisma.employee.update({ where: { id }, data: { priorityOrder: index } })
      )
  );

  const updated = await prisma.employee.findMany({
    where: { role },
    orderBy: [{ priorityOrder: "asc" }, { fullName: "asc" }],
  });

  return NextResponse.json(updated);
}
