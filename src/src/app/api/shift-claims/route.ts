import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDailyStaffingStatus } from "@/lib/dailyStaffing";
import { isWithinKiboWindow } from "@/lib/kiboWindow";
import { z } from "zod";

const LOOKAHEAD_DAYS = 30;

// GET /api/shift-claims
// 管理者: 承認待ちの申請一覧(pending)に加え、KIBO時間帯付きの申請も含む全件一覧(all)を返す。
// 従業員: 今後30日以内で、業務要件（1日の必要人数の合計）に対して出勤予定人数が
//         足りていない日のうち、自分がまだ出勤予定でなく、まだ申請していない日の一覧
//         （不足人数つき）+ 自分の申請履歴 + KIBO登録の受付可否(kiboWindow)を返す。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  if (session.user.role === "ADMIN") {
    const [pending, all] = await Promise.all([
      prisma.shiftClaimRequest.findMany({
        where: { status: "PENDING" },
        include: { employee: true },
        orderBy: { requestedAt: "asc" },
      }),
      prisma.shiftClaimRequest.findMany({
        include: { employee: true },
        orderBy: { workDate: "desc" },
        take: 200,
      }),
    ]);
    return NextResponse.json({ pending, all });
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

  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const kiboWindow = {
    targetMonth: `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`,
    isOpen: now.getUTCDate() <= 10,
    deadlineDay: 10,
  };

  return NextResponse.json({ availableDates, myRequests, notLinked: false, kiboWindow });
}

// desiredStartTime/desiredEndTime を両方指定した場合のみ「希望勤務(KIBO)」として扱い、
// 対象月・締切のバリデーションを行う。省略した場合は既存の「人員不足日への申請」のまま
// （この分岐がない旧仕様の挙動を変えないため）。
const ClaimInput = z.object({
  workDate: z.string(),
  desiredStartTime: z.string().optional(),
  desiredEndTime: z.string().optional(),
});

// POST /api/shift-claims — 従業員が「申請」する。
// - desiredStartTime/desiredEndTime なし: 従来通り、人員不足の日への申請（締切なし）。
// - desiredStartTime/desiredEndTime あり: 希望勤務(KIBO)登録。翌月分のみ・当月10日までの受付。
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
  const isKibo = !!(parsed.data.desiredStartTime && parsed.data.desiredEndTime);

  if (isKibo) {
    const check = isWithinKiboWindow(workDate);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const claim = await prisma.shiftClaimRequest.upsert({
    where: { employeeId_workDate: { employeeId, workDate } },
    update: {
      status: "PENDING",
      requestedAt: new Date(),
      decidedAt: null,
      decidedBy: null,
      desiredStartTime: parsed.data.desiredStartTime ?? null,
      desiredEndTime: parsed.data.desiredEndTime ?? null,
    },
    create: {
      employeeId,
      workDate,
      status: "PENDING",
      desiredStartTime: parsed.data.desiredStartTime ?? null,
      desiredEndTime: parsed.data.desiredEndTime ?? null,
    },
  });

  return NextResponse.json(claim, { status: 201 });
}
