import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const RequirementUpdateInput = z.object({
  appliesToAllRoles: z.boolean().optional(),
  targetRoles: z.array(z.enum(["INC", "STAFF", "CONTRACT", "PARTTIME", "OJT"])).optional(),
  requiredCount: z.number().int().min(1).optional(),
  note: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/task-requirements/:id
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務要件の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RequirementUpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.taskRequirement.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json(updated);
}

// DELETE /api/task-requirements/:id
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務要件の削除は管理者のみ可能です" }, { status: 403 });
  }

  await prisma.taskRequirement.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
