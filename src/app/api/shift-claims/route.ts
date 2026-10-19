import { isRegistrationStopped, stoppedMessage } from "@/lib/claimHold";
import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDailyStaffingStatus } from "@/lib/dailyStaffing";
import { getConfirmedMonthShortages } from "@/lib/monthlyShiftGap";
import { isWithinPartTimeWeeklyLimit } from "@/lib/weeklyHours";
import { buildAdminClaimList } from "@/lib/claimAdmin";
import { getMonthShiftGaps } from "@/lib/monthlyShiftGap";
import { requestInsideSlot, windowMinutes } from "@/lib/claimRules";
import { writeAudit } from "@/lib/auditLog";
import { todayJst } from "@/lib/jst";
import { z } from "zod";

const LOOKAHEAD_DAYS = 30;

// GET /api/shift-claims
// 管理者: 承認待ちの申請一覧を返す。
// 従業員: 今後30日以内で、業務要件（1日の必要人数の合計）に対して出勤予定人数が
//         足りていない日のうち、自分がまだ出勤予定でなく、まだ申請していない日の一覧
//         （不足人数つき）+ 自分の申請履歴を返す。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  if (isManagerRole(session.user.role)) {
    // ?month=YYYY-MM … その月の全勤務希望（全ステータス）と募集枠の状況（INC画面用）
    const month = req.nextUrl.searchParams.get("month");
    if (month) {
      const list = await buildAdminClaimList(month);
      if (!list) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
      return NextResponse.json(list);
    }
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
    // シフトの内容（どのシフトへの招待・申請か）を社員側にも正しく表示するため shiftType を含める。
    prisma.shiftClaimRequest.findMany({ where: { employeeId }, include: { shiftType: true }, orderBy: { workDate: "asc" } }),
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

const ClaimInput = z
  .object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形式が正しくありません"),
    shiftTypeId: z.string().min(1, "勤務帯（シフト）を選択してください"),
    requestedStartTime: z.string().optional(),
    requestedEndTime: z.string().optional(),
  })
  .refine((v) => !!v.requestedStartTime === !!v.requestedEndTime, { message: "開始と終了の時間を両方指定してください" });

// 登録・変更できる（まだINCが確定していない／終了した）状態。確定済み(APPROVED)・取消申請中は変更不可。
const REGISTERABLE = ["INVITED", "PENDING", "REJECTED", "CANCELED", "NOT_SELECTED"] as const;

// POST /api/shift-claims — 従業員が人員不足の枠に勤務希望を登録する（PENDINGの再登録は「変更」）。
// サーバー側で検証: 本人のみ / 1日1枠 / 実際に人員不足の枠か / 希望時間が枠内か / 既に出勤予定でないか / バイトの週20時間 / 過去日でないか。
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

  const body = await req.json().catch(() => null);
  const parsed = ClaimInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が正しくありません" }, { status: 400 });
  }
  const { workDate: dateStr, shiftTypeId } = parsed.data;
  const requestedStartTime = parsed.data.requestedStartTime ?? null;
  const requestedEndTime = parsed.data.requestedEndTime ?? null;
  const workDate = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(workDate.getTime())) return NextResponse.json({ error: "日付が正しくありません" }, { status: 400 });
  if (dateStr < todayJst()) return NextResponse.json({ error: "過去の日付には登録できません" }, { status: 400 });

  // INCが対象月の登録を停止している間は、新規登録・変更を受け付けない（画面だけでなくAPIでも拒否する）
  if (await isRegistrationStopped(dateStr.slice(0, 7))) {
    return NextResponse.json({ error: `${stoppedMessage(dateStr.slice(0, 7))}。再開されるまで登録・変更できません`, registrationStopped: true }, { status: 403 });
  }

  const [employee, shiftType] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.shiftType.findUnique({ where: { id: shiftTypeId } }),
  ]);
  if (!employee || !employee.isActive) return NextResponse.json({ error: "従業員情報が見つかりません" }, { status: 400 });
  if (!shiftType) return NextResponse.json({ error: "選択した勤務帯が見つかりません" }, { status: 400 });

  const slot = { start: shiftType.defaultStartTime, end: shiftType.defaultEndTime };
  if (!requestInsideSlot(slot, { start: requestedStartTime, end: requestedEndTime })) {
    return NextResponse.json({ error: `希望時間は募集枠（${slot.start}〜${slot.end}）の範囲内で入力してください` }, { status: 400 });
  }

  // 実際に人員不足の枠か（INC側の月間勤務表と同じ判定ロジック）
  const [y, m] = dateStr.split("-").map(Number);
  const gaps = await getMonthShiftGaps(y, m);
  if (!gaps.some((g) => g.date === dateStr && g.shiftTypeId === shiftTypeId && g.shortage > 0)) {
    return NextResponse.json({ error: "この日・この勤務帯は現在、人員不足ではないため登録できません" }, { status: 409 });
  }

  const working = await prisma.monthRoster.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
  if (working?.status === "WORK") {
    return NextResponse.json({ error: "この日は既に勤務予定が入っているため登録できません" }, { status: 409 });
  }

  const hours = windowMinutes(requestedStartTime ?? slot.start, requestedEndTime ?? slot.end) / 60;
  if (!(await isWithinPartTimeWeeklyLimit(employeeId, employee.role, workDate, hours))) {
    return NextResponse.json({ error: "週20時間の上限を超えるため登録できません" }, { status: 409 });
  }

  const existing = await prisma.shiftClaimRequest.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
  if (existing && !(REGISTERABLE as readonly string[]).includes(existing.status)) {
    return NextResponse.json(
      { error: "この日は既に確定済み（または取消申請中）です。変更する場合は、先に取消を申請してください" },
      { status: 409 }
    );
  }

  const data = { status: "PENDING" as const, shiftTypeId, requestedStartTime, requestedEndTime, requestedAt: new Date(), decidedAt: null, decidedBy: null, cancelRequestedAt: null };
  let id: string;
  if (existing) {
    // 状態が変わっていない場合だけ更新（確定済みを申請中へ戻す事故を防ぐ）
    const upd = await prisma.shiftClaimRequest.updateMany({ where: { id: existing.id, status: { in: [...REGISTERABLE] } }, data });
    if (upd.count !== 1) return NextResponse.json({ error: "申請の状態が変わりました。画面を更新してください" }, { status: 409 });
    id = existing.id;
  } else {
    try {
      const created = await prisma.shiftClaimRequest.create({ data: { employeeId, workDate, ...data } });
      id = created.id;
    } catch (e: any) {
      if (e?.code === "P2002") return NextResponse.json({ error: "この日は既に申請があります。画面を更新してください" }, { status: 409 });
      throw e;
    }
  }

  await writeAudit(prisma, {
    recordId: id,
    action: existing?.status === "PENDING" ? "CLAIM_CHANGE" : "CLAIM_REGISTER",
    changedBy: session.user.email,
    oldValue: existing ? { status: existing.status, shiftTypeId: existing.shiftTypeId, start: existing.requestedStartTime, end: existing.requestedEndTime } : undefined,
    newValue: { status: "PENDING", date: dateStr, shiftTypeId, start: requestedStartTime, end: requestedEndTime },
  });

  const claim = await prisma.shiftClaimRequest.findUnique({ where: { id } });
  return NextResponse.json(claim, { status: existing ? 200 : 201 });
}
