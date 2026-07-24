import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/shift-types — danh sách loại ca (明番/早番/中番/遅番/超早/超遅)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const shiftTypes = await prisma.shiftType.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json(shiftTypes);
}
