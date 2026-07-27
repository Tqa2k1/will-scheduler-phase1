import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/cart-positions — danh sách vị trí (A/B/全/BF/休憩/移動/WHILL準備/WHILL片付け/MTG)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const positions = await prisma.cartPosition.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json(positions);
}
