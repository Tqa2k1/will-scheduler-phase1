import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/role-priorities
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const priorities = await prisma.rolePriority.findMany({ orderBy: { priorityOrder: "asc" } });
  return NextResponse.json(priorities);
}

const UpdateInput = z.object({
  items: z.array(z.object({ role: z.enum(["STAFF", "CONTRACT", "PARTTIME", "OJT"]), priorityOrder: z.number().int() })),
});

// PATCH /api/role-priorities — 優先順位を一括更新（管理者のみ）
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "優先順位の変更は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  for (const item of parsed.data.items) {
    await prisma.rolePriority.upsert({
      where: { role: item.role },
      update: { priorityOrder: item.priorityOrder },
      create: { role: item.role, priorityOrder: item.priorityOrder },
    });
  }

  const priorities = await prisma.rolePriority.findMany({ orderBy: { priorityOrder: "asc" } });
  return NextResponse.json(priorities);
}
