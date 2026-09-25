import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/rotation-patterns
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const patterns = await prisma.rotationPattern.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(patterns);
}
