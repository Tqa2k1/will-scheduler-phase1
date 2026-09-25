import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDailyStaffingStatus } from "@/lib/dailyStaffing";
import { getConfirmedMonthShortages } from "@/lib/monthlyShiftGap";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";
import { z } from "zod";

const LOOKAHEAD_DAYS = 30;

// GET /api/shift-claims
// 管理者: 承認待ちの申請一覧を返す。
// 従業員: 今後30日以内で、業務要件（1日の必要人数の合計）に対して出勤予定人数が
//         足りていない日のうち、自分がまだ出勤予定でなく、まだ申請していない日の一覧
//         （不足人数つき）+ 自分の申請履歴を返す。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  if (session.user.role === "ADMIN") {
    const pending = await prisma.shiftClaimRequest.findMany({
      where: { status: "PENDING" },
      include: { employee: true, shiftType: true },
      orderBy: { requestedAt: "asc" },
    });
    return NextResponse.json({ pending });
  }

  // EMPLOYEE
  const employeeId = session.user.employeeId;
  if (!employeeId) {
    return NextResponse.json({ availableDates: [], myRequests: [], notLinked: true });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [myRequests, myRosterEntries] = await Promise.all([
    prisma.shiftClaimRequest.findMany({ where: { employeeId }, orderBy: { workDate: "asc" } }),
    prisma.monthRoster.findMany({
      where: { employeeId, workDate: { gte: today }, status: "WORK" },
    }),
  ]);
  const alreadyWorkingDates = new Set(myRosterEntries.map((e) => e.workDate.toISOString().slice(0, 10)));
  const alreadyRequestedDates = new Set(myRequests.map((r) => r.workDate.toISOString().slice(0, 10)));

  const availableDates: { date: string; shortageCount: number }[] = [];
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const dateKey = d.toISOString().slice(0, 10);
    if (alreadyWorkingDates.has(dateKey) || alreadyRequestedDates.has(dateKey)) continue;

    const { shortage } = await getDailyStaffingStatus(d);
    if (shortage > 0) availableDates.push({ date: dateKey, shortageCount: shortage });
  }

  const myEmployee = await prisma.employee.findUnique({ where: { id: employeeId } });

  // 希望勤務(KIBO)の選択肢は、INCが「シフト調整完了」を確定したスナップショットからのみ作る
  // （ライブ再計算はしない。まだ確定されていない月は選択肢に出さない）。
  // 「申請済み」の日付はここでも除外する（1日1件のKIBOのため、既存の@@unique制約と一致させる）。
  const kiboOptions: { date: string; shiftTypeId: string; shiftTypeCode: string; shiftLabel: string; shortage: number }[] = [];
  const monthsToCheck = new Set([`${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`]);
  const nextMonth = new Date(today);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  monthsToCheck.add(`${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`);

  for (const monthKey of monthsToCheck) {
    const snapshot = await getConfirmedMonthShortages(monthKey);
    if (!snapshot) continue; // その月はまだINCがシフト調整完了を確定していない
    for (const [date, dayInfo] of Object.entries(snapshot.shortagesByDate)) {
      if (alreadyWorkingDates.has(date) || alreadyRequestedDates.has(date)) continue;
      const gapDate = new Date(date + "T00:00:00Z");
      if (gapDate < today) continue;

      for (const band of dayInfo.bands) {
        if (band.shortage <= 0) continue;
        if (myEmployee && myEmployee.role === "PARTTIME") {
          const shiftType = await prisma.shiftType.findUnique({ where: { id: band.shiftTypeId } });
          if (shiftType) {
            const [sh, sm] = shiftType.defaultStartTime.split(":").map(Number);
            const [eh, em] = shiftType.defaultEndTime.split(":").map(Number);
            let hours = eh * 60 + em - (sh * 60 + sm);
            if (hours < 0) hours += 24 * 60;
            hours /= 60;
            const withinLimit = await isWithinPartTimeWeeklyLimit(employeeId, "PARTTIME", gapDate, hours);
            if (!withinLimit) continue; // 週20時間を超えるため、この従業員には表示しない
          }
        }
        kiboOptions.push({ date, shiftTypeId: band.shiftTypeId, shiftTypeCode: band.shiftTypeCode, shiftLabel: band.shiftLabel, shortage: band.shortage });
      }
    }
  }

  return NextResponse.json({ availableDates, kiboOptions, myRequests, notLinked: false });
}

const ClaimInput = z.object({
  workDate: z.string(),
  shiftTypeId: z.string().optional(),
  requestedStartTime: z.string().optional(),
  requestedEndTime: z.string().optional(),
});

// POST /api/shift-claims — 従業員が人員不足の日に「申請」する
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "EMPLOYEE") {
    return NextResponse.json({ error: "この操作は従業員アカウントのみ可能です" }, { status: 403 });
  }
  const employeeId = session.user.employeeId;
  if (!employeeId) {
    return NextResponse.json({ error: "アカウントに従業員情報が紐付けられていません" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = ClaimInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const workDate = new Date(parsed.data.workDate);
  const shiftTypeId = parsed.data.shiftTypeId ?? null;
  const requestedStartTime = parsed.data.requestedStartTime ?? null;
  const requestedEndTime = parsed.data.requestedEndTime ?? null;

  const claim = await prisma.shiftClaimRequest.upsert({
    where: { employeeId_workDate: { employeeId, workDate } },
    update: { status: "PENDING", shiftTypeId, requestedStartTime, requestedEndTime, requestedAt: new Date(), decidedAt: null, decidedBy: null },
    create: { employeeId, workDate, shiftTypeId, requestedStartTime, requestedEndTime, status: "PENDING" },
  });

  return NextResponse.json(claim, { status: 201 });
}
