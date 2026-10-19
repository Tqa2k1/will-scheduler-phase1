import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isManagerRole } from "@/lib/roles";
import { getMonthStatusInfo } from "@/lib/monthStatus";
import { isValidMonth } from "@/lib/monthStatusShared";

// GET /api/roster/month-status?month=2026-10 — 月の状態（調整中／確定）。
// 全ログインユーザーが取得できる（従業員には配信結果などの内部情報は含めない）。シフトの中身は返さない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month");
  if (!isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  return NextResponse.json(await getMonthStatusInfo(month, isManagerRole(session.user.role)));
}
