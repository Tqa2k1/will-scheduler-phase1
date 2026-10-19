import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRequiredHeadcountBySlot } from "@/lib/shiftRequirements";

// GET /api/schedule/required-headcount
// INCが /shift-settings で設定したシフトの必要人数（時間帯別設定を含む）から、
// 1時間スロットごとの必要人数の合計（営業日インデックス 0=4:00 … 23=3:00）を返す。
// 日別スケジュールの「配置状況」表示が、自動割り当てと同じ設定を使うために使用する。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const totalBySlot = await getRequiredHeadcountBySlot();
  return NextResponse.json({ totalBySlot });
}
