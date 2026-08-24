import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMonthShiftGaps, findCandidatesForShift, ShiftGapWithCandidates } from "@/lib/monthlyShiftGap";

// GET /api/roster/shift-adjustment?month=2026-09
// 管理者が「シフト調整」を実行した際に呼ばれる。指定した月の全日×3シフトをチェックし、
// 不足しているシフトと、それぞれに対応可能な候補者一覧を返す。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "シフト調整は管理者のみ可能です" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month"); // "2026-09"
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });
  const [year, mon] = month.split("-").map(Number);

  const gaps = await getMonthShiftGaps(year, mon);

  const gapsWithCandidates: ShiftGapWithCandidates[] = [];
  for (const gap of gaps) {
    const candidates = await findCandidatesForShift(gap.date, gap.shiftTypeCode);
    gapsWithCandidates.push({ ...gap, candidates });
  }

  return NextResponse.json({ gaps: gapsWithCandidates });
}
