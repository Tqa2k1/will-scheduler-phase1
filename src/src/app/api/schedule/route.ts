import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { z } from "zod";

// GET /api/schedule?date=2026-07-01
// 管理者・従業員(EMPLOYEE)ともに、その日の全スタッフの勤務者一覧 + ポジション割り当てを返す。
// 閲覧内容は同じ（誰が・どの業務を・何時から何時まで）。書き込み(POST)は管理者のみに制限されている。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date パラメータが必要です" }, { status: 400 });

  const workDate = new Date(date);

  const [rosterItems, assignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  return NextResponse.json({ rosterItems, assignments });
}

const AssignmentInput = z.object({
  employeeId: z.string(),
  workDate: z.string(),
  slotStart: z.string(),
  slotEnd: z.string(),
  cartPositionId: z.string().nullable(),
});

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// slotStart〜slotEnd（30分刻み）の間に含まれる、開始点となりうる30分チェックポイントを列挙する
// 例: 10:00-11:00 -> ["10:00","10:30"] / 10:00-10:30 -> ["10:00"]
function halfHourCheckpoints(slotStart: string, durationMinutes: number): string[] {
  const points: string[] = [];
  const startMinutes = minutesOf(slotStart);
  for (let offset = 0; offset < durationMinutes; offset += 30) {
    const total = (startMinutes + offset) % (24 * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    points.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return points;
}

// POST /api/schedule — 30分単位で開始・終了を指定してポジションを割り当て（管理者のみ）。
// 業務ごとの時間単位（CartPosition.slotUnitMinutes、既定60分）を尊重する:
//   - 60分単位の業務（通常の全業務）は、必ずちょうど60分の枠でのみ設定できる
//   - 30分単位が許可された業務は、30分または60分どちらの枠でも設定できる
// 既存の実装（1時間固定）からの後方互換: slotStart/slotEndに60分差を渡す限り、挙動は変わらない。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "日別スケジュールの編集は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AssignmentInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { employeeId, workDate, slotStart, slotEnd, cartPositionId } = parsed.data;
  const date = new Date(workDate);
  const durationMinutes = ((minutesOf(slotEnd) - minutesOf(slotStart) + 24 * 60) % (24 * 60)) || 24 * 60;

  // このスロットが上書きする範囲に既に存在する断片（30分/60分どちらの粒度で入っていても）を
  // すべて削除する。これにより、例えば「30分の業務」の上に「60分の業務」を設定し直した場合でも
  // 重複レコードが残らない。
  const checkpoints = halfHourCheckpoints(slotStart, durationMinutes);
  await prisma.dailyAssignment.deleteMany({
    where: { employeeId, workDate: date, slotStart: { in: checkpoints } },
  });

  if (!cartPositionId) {
    return NextResponse.json({ deleted: true });
  }

  const position = await prisma.cartPosition.findUnique({ where: { id: cartPositionId } });
  if (!position) return NextResponse.json({ error: "指定された業務が見つかりません" }, { status: 404 });

  if (position.slotUnitMinutes === 60 && durationMinutes !== 60) {
    return NextResponse.json(
      { error: `「${position.name}」は1時間単位でのみ設定できます（30分単位は許可されていません）` },
      { status: 400 }
    );
  }
  if (position.slotUnitMinutes === 30 && durationMinutes !== 30 && durationMinutes !== 60) {
    return NextResponse.json({ error: "30分または1時間の単位で設定してください" }, { status: 400 });
  }

  const result = await prisma.dailyAssignment.create({
    data: { employeeId, workDate: date, slotStart, slotEnd, cartPositionId, source: "MANUAL" },
    include: { cartPosition: true },
  });

  return NextResponse.json(result);
}