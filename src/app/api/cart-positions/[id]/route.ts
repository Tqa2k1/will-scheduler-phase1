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
});

// DELETE /api/cart-positions/:id — 業務を削除。既にDailyAssignmentで使用中の場合は
// データ破壊を避けるため完全削除せず、使用不可（isActive=false）に切り替える。
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務の削除は管理者のみ可能です" }, { status: 403 });
  }

  const usageCount = await prisma.dailyAssignment.count({ where: { cartPositionId: params.id } });

  if (usageCount > 0) {
    await prisma.cartPosition.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message: `この業務は過去のスケジュールで ${usageCount} 件使用されているため完全には削除できません。「使用しない」状態に変更しました。`,
    });
  }

  // 未使用の場合は関連する業務要件・稼働時間設定も含めて完全に削除
  await prisma.taskRequirement.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.cartOperatingHours.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.demandTemplate.deleteMany({ where: { cartPositionId: params.id } });
  await prisma.cartPosition.delete({ where: { id: params.id } });

  return NextResponse.json({ deleted: true, deactivated: false });
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
