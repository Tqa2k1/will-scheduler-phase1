import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRosterVisibility } from "@/lib/rosterAccess";
import { getMonthStatusInfo, markMonthsRevised } from "@/lib/monthStatus";
import { isValidMonth, monthKeyOfDate } from "@/lib/monthStatusShared";
import { attemptBackfillOnRosterChange } from "@/lib/autoBackfill";
import { z } from "zod";

// GET /api/roster?month=2026-07 — 月間勤務表データ + 従業員一覧
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month"); // "2026-07"
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });
  if (!isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  const isAdmin = isManagerRole(session.user.role);
  const monthStatus = await getMonthStatusInfo(month, isAdmin);

  // 閲覧範囲: 管理者・INCは常に全員分。一般従業員は、月が「確定」（メール配信完了）のときだけ全員分のシフト情報。
  // 「調整中」の月は、シフトデータも従業員一覧も返さない（画面側の制御だけでなく、ここで返すデータ自体を絞る）。
  const vis = await getRosterVisibility(session.user, month);
  if (!vis.fullAccess) {
    return NextResponse.json({
      employees: [],
      entries: [],
      monthStatus,
      rosterConfirmed: false,
      restrictedToSelf: false,
      selfEmployeeId: session.user.employeeId ?? null,
    });
  }

  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      // 一般従業員には表示に必要な項目だけを返す（メールアドレス・電話番号・備考などは返さない）
      ...(isAdmin ? {} : { select: { id: true, fullName: true, role: true, isActive: true, baseStartTime: true, baseEndTime: true } }),
    }),
    prisma.monthRoster.findMany({
      where: { workDate: { gte: rangeStart, lt: rangeEnd } },
      include: { shiftType: true },
    }),
  ]);

  const safeEntries = isAdmin ? entries : entries.map(({ createdBy, updatedBy, ...rest }) => rest);
  return NextResponse.json({
    employees,
    entries: safeEntries,
    monthStatus,
    rosterConfirmed: vis.confirmed,
    restrictedToSelf: false,
    selfEmployeeId: session.user.employeeId ?? null,
  });
}

// 部分更新に対応: 送られてきたフィールドだけ更新し、未指定のフィールドは既存値を維持する
const RosterPartialInput = z.object({
  employeeId: z.string(),
  workDate: z.string(), // "2026-07-01"
  shiftTypeId: z.string().nullable().optional(),
  status: z.enum(["WORK", "OFF", "PAID_LEAVE", "ADJUST_LEAVE"]).optional(),
  overrideStartTime: z.string().nullable().optional(),
  overrideEndTime: z.string().nullable().optional(),
});

// POST /api/roster — 1日分のシフト/ステータス/例外時間を作成・更新（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "勤務表の編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = RosterPartialInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeId, workDate, ...fields } = parsed.data;
  const date = new Date(workDate);
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "workDate が不正です" }, { status: 400 });

  const entry = await prisma.monthRoster.upsert({
    where: { employeeId_workDate: { employeeId, workDate: date } },
    update: { ...fields, updatedBy: session.user.email ?? undefined },
    create: {
      employeeId,
      workDate: date,
      status: fields.status ?? "WORK",
      shiftTypeId: fields.shiftTypeId ?? null,
      overrideStartTime: fields.overrideStartTime ?? null,
      overrideEndTime: fields.overrideEndTime ?? null,
      createdBy: session.user.email ?? undefined,
    },
    include: { shiftType: true },
  });

  // 確定後の修正なら、その月を「調整中」に戻す（再度メール配信が完了するまで従業員にはシフトを見せない）
  const reverted = await markMonthsRevised([monthKeyOfDate(date)], session.user.email);

  // 出勤しない状態に変更された場合、その日に既に割り当てられていた業務（車A/車B/全等）が
  // 欠員にならないよう、優先順位に従って自動的に代わりの人を探す（見つからなければ不足のまま）。
  let backfill: { removedAssignments: number; backfilledSlots: number; unfilledSlots: number } | null = null;
  if (entry.status !== "WORK") {
    backfill = await attemptBackfillOnRosterChange(employeeId, date);
  }

  return NextResponse.json({ ...entry, backfill, revertedMonths: reverted });
}
