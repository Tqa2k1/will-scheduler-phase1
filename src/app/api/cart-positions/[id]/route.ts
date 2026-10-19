import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isSystemPositionCode } from "@/lib/systemPositions";

const TaskUpdateInput = z.object({
  code: z.string().trim().min(1, "業務コードを入力してください").max(50).optional(),
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
  if (!isManagerRole(session.user.role)) {
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
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "業務の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = TaskUpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const current = await prisma.cartPosition.findUnique({ where: { id: params.id } });
  if (!current) return NextResponse.json({ error: "業務が見つかりません" }, { status: 404 });

  // code の変更: システム（自動割当て・不足判定・画面）が直接参照するコードは変更不可。
  // それ以外は重複チェックのうえ変更可（保存済みの割当ては id で参照しているため壊れない）。
  const newCode = parsed.data.code;
  if (newCode !== undefined && newCode !== current.code) {
    if (isSystemPositionCode(current.code)) {
      return NextResponse.json(
        { error: `「${current.code}」はシステムが使用するコードのため変更できません（業務名・色などは変更できます）` },
        { status: 400 }
      );
    }
    if (isSystemPositionCode(newCode)) {
      return NextResponse.json({ error: `「${newCode}」はシステム予約のコードのため使用できません` }, { status: 409 });
    }
    const dup = await prisma.cartPosition.findUnique({ where: { code: newCode } });
    if (dup && dup.id !== params.id) {
      return NextResponse.json({ error: `コード「${newCode}」は既に使用されています` }, { status: 409 });
    }
  }

  try {
    const updated = await prisma.cartPosition.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "このコードは既に使用されています" }, { status: 409 });
    }
    throw err;
  }
}