import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const TaskUpdateInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  operatingStartTime: z.string().nullable().optional(),
  operatingEndTime: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  color: z.string().nullable().optional(),
});

// DELETE /api/cart-positions/:id — 業務を完全に削除
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務の削除は管理者のみ可能です" }, { status: 403 });
  }

  await prisma.dailyAssignment.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.taskRequirement.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.cartOperatingHours.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.demandTemplate.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.cartPosition.delete({ where: { id: params.id } });

  return NextResponse.json({ deleted: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = TaskUpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await prisma.cartPosition.update({
    where: { id: params.id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}