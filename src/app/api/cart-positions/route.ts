import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/cart-positions — 業務一覧（全件。無効化された業務も含む。フィルタはフロント側で行う）
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const positions = await prisma.cartPosition.findMany({
    orderBy: { code: "asc" },
    include: { requirements: true },
  });
  return NextResponse.json(positions);
}

const TaskInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["CART", "SPECIAL"]).default("CART"),
  description: z.string().optional(),
  operatingStartTime: z.string().optional(),
  operatingEndTime: z.string().optional(),
});

// POST /api/cart-positions — 業務を作成（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務の作成は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = TaskInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.cartPosition.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return NextResponse.json({ error: "この業務コードは既に使用されています" }, { status: 409 });
  }

  const task = await prisma.cartPosition.create({ data: parsed.data });
  return NextResponse.json(task, { status: 201 });
}
