import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMonthShiftGaps, findCandidatesForShift, findInvitedForShift, ShiftGapWithCandidates } from "@/lib/monthlyShiftGap";

// GET /api/roster/shift-adjustment?month=2026-09
// 管理者が「シフト調整」を実行した際に呼ばれる。指定した月の全日×3シフトをチェックし、
// 不足しているシフトと、それぞれに対応可能な候補者一覧を返す。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "ASK②は管理者のみ可能です" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month"); // "2026-09"
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });
  const [year, mon] = month.split("-").map(Number);

  const gaps = await getMonthShiftGaps(year, mon);

  const gapsWithCandidates: ShiftGapWithCandidates[] = [];
  for (const gap of gaps) {
    const [candidates, invited] = await Promise.all([
      findCandidatesForShift(gap.date, gap.shiftTypeCode),
      // メール送信済み（未回答）・本人申請済み（承認待ち/承認済み/却下済み）の従業員を、
      // 実際の回答状況つきで返す。「送信した＝登録済み」にならないよう区別して表示するため。
      findInvitedForShift(gap.date, gap.shiftTypeId),
    ]);
    gapsWithCandidates.push({ ...gap, candidates, invited });
  }

  // 承認待ち（PENDING）の勤務希望は、不足にはまだ数えない（承認されるとMonthRosterに反映される）。
  // 管理者が承認を忘れないよう、その月の承認待ち件数を返す。
  const pendingCount = await prisma.shiftClaimRequest.count({
    where: { status: "PENDING", workDate: { gte: new Date(Date.UTC(year, mon - 1, 1)), lt: new Date(Date.UTC(year, mon, 1)) } },
  });

  return NextResponse.json({ gaps: gapsWithCandidates, pendingCount });
}
