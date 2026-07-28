import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/task-requirements?cartPositionId=xxx（省略時は全件）
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const cartPositionId = req.nextUrl.searchParams.get("cartPositionId");

  const requirements = await prisma.taskRequirement.findMany({
    where: cartPositionId ? { cartPositionId } : undefined,
    include: { cartPosition: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(requirements);
}

const RequirementInput = z.object({
  cartPositionId: z.string(),
  appliesToAllRoles: z.boolean().default(true),
  targetRoles: z.array(z.enum(["INC", "STAFF", "CONTRACT", "PARTTIME", "OJT"])).default([]),
  requiredCount: z.number().int().min(1).default(1),
  note: z.string().optional(),
});

// POST /api/task-requirements — 業務要件を作成（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "業務要件の作成は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RequirementInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const requirement = await prisma.taskRequirement.create({ data: parsed.data });
  return NextResponse.json(requirement, { status: 201 });
}
