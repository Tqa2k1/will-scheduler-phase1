import { isRegistrationStopped } from "@/lib/claimHold";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConfirmedMonthShortages } from "@/lib/monthlyShiftGap";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";
import { getShortageNoticeFromLabel } from "@/lib/shortageNotice";
import { getRegistrationDeadline, parseMonth } from "@/lib/shortageMail";
import { getMonthShiftGaps, } from "@/lib/monthlyShiftGap";
import { resolveWorkTime, formatTimeRange } from "@/lib/workTime";
import { todayJst } from "@/lib/jst";

// GET /api/shift-claims/my-month?month=2026-11
// STEP2「勤務希望登録」画面用。ログイン中の従業員「本人」について、対象月の
//  - 人員不足の日付・不足している勤務帯（INCが「人員不足を確定」した内容のみ）
//  - 自分の登録状況 / 既に出勤予定の日
// を返す。他の従業員の名前・勤務希望は一切返さない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const p = parseMonth(month);
  if (!p) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const employeeId = session.user.employeeId;
  if (!employeeId) return NextResponse.json({ notLinked: true });

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return NextResponse.json({ notLinked: true });

  const rangeStart = new Date(Date.UTC(p.year, p.mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(p.year, p.mon, 1));

  const [snapshot, myClaims, myWork, liveGaps] = await Promise.all([
    getConfirmedMonthShortages(month),
    prisma.shiftClaimRequest.findMany({ where: { employeeId, workDate: { gte: rangeStart, lt: rangeEnd } } }),
    prisma.monthRoster.findMany({
      where: { employeeId, status: "WORK", workDate: { gte: rangeStart, lt: rangeEnd } },
      include: { shiftType: true },
    }),
    getMonthShiftGaps(p.year, p.mon),
  ]);

  const deadline = getRegistrationDeadline(month);
  const today = todayJst();
  const registrationStopped = await isRegistrationStopped(month);
  const base = { registrationStopped, notLinked: false, employeeName: employee.fullName, month, deadline, today, pastDeadline: !!deadline && today > deadline.iso };
  if (!snapshot) {
    return NextResponse.json({ ...base, confirmed: false, days: [], myWork: [] });
  }

  // 自分の確定済み勤務（自分の分だけ。他の従業員の情報は返さない）
  const workByDate = new Map(myWork.map((w) => [w.workDate.toISOString().slice(0, 10), w]));
  const workingDates = new Set(workByDate.keys());
  const claimByDate = new Map(myClaims.map((c) => [c.workDate.toISOString().slice(0, 10), c]));
  // 人員不足は、INCが確定した日・勤務帯のうち「今も不足している」ものを、INC側の月間勤務表と同じ判定（ライブ）の人数で表示する
  const liveShortage = new Map(liveGaps.map((g) => [`${g.date}|${g.shiftTypeId}`, g.shortage]));

  const shiftTypeIds = new Set<string>();
  for (const d of Object.values(snapshot.shortagesByDate)) for (const b of d.bands) shiftTypeIds.add(b.shiftTypeId);
  for (const c of myClaims) if (c.shiftTypeId) shiftTypeIds.add(c.shiftTypeId);
  const shiftTypes = await prisma.shiftType.findMany({ where: { id: { in: [...shiftTypeIds] } } });
  const shiftTypeById = new Map(shiftTypes.map((s) => [s.id, s]));

  const dayKeys = new Set<string>([...Object.keys(snapshot.shortagesByDate), ...claimByDate.keys()]);
  const days = [];
  for (const date of [...dayKeys].sort()) {
    const info = snapshot.shortagesByDate[date];
    const gapDate = new Date(date + "T00:00:00Z");
    const bands = [];
    let totalShortage = 0;
    for (const band of info?.bands ?? []) {
      const shortage = liveShortage.get(`${date}|${band.shiftTypeId}`) ?? 0;
      if (shortage <= 0) continue;
      const st = shiftTypeById.get(band.shiftTypeId);
      let overLimit = false;
      if (st && employee.role === "PARTTIME") {
        const [sh, sm] = st.defaultStartTime.split(":").map(Number);
        const [eh, em] = st.defaultEndTime.split(":").map(Number);
        let hours = eh * 60 + em - (sh * 60 + sm);
        if (hours < 0) hours += 24 * 60;
        overLimit = !(await isWithinPartTimeWeeklyLimit(employeeId, "PARTTIME", gapDate, hours / 60));
      }
      totalShortage += shortage;
      bands.push({
        shiftTypeId: band.shiftTypeId,
        shiftLabel: band.shiftLabel,
        shortage,
        startTime: st?.defaultStartTime ?? "",
        endTime: st?.defaultEndTime ?? "",
        notice: band.notice ?? getShortageNoticeFromLabel(band.shiftLabel),
        overLimit,
      });
    }
    const claim = claimByDate.get(date);
    if (bands.length === 0 && !claim) continue;
    const claimShift = claim?.shiftTypeId ? shiftTypeById.get(claim.shiftTypeId) : undefined;
    days.push({
      date,
      totalShortage,
      working: workingDates.has(date),
      myStatus: claim?.status ?? null,
      myClaim: claim
        ? {
            id: claim.id,
            status: claim.status,
            shiftTypeId: claim.shiftTypeId,
            shiftLabel: claimShift ? `${claimShift.defaultStartTime}〜${claimShift.defaultEndTime}` : "",
            startTime: claim.requestedStartTime,
            endTime: claim.requestedEndTime,
          }
        : null,
      bands,
    });
  }

  return NextResponse.json({
    ...base,
    confirmed: true,
    confirmedAt: snapshot.confirmedAt,
    days,
    myWork: [...workByDate.entries()].map(([date, w]) => {
      const t = resolveWorkTime({
        overrideStartTime: w.overrideStartTime,
        overrideEndTime: w.overrideEndTime,
        shiftType: w.shiftType,
        baseStartTime: employee.baseStartTime,
        baseEndTime: employee.baseEndTime,
      });
      return { date, label: formatTimeRange(t) };
    }),
  });
}
