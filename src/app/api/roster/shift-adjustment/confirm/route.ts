import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { confirmMonthShiftAdjustment, getConfirmedMonthShortages } from "@/lib/monthlyShiftGap";
import { z } from "zod";

// GET /api/roster/shift-adjustment/confirm?month=2026-09
// 社員・管理者どちらも参照可能。指定月について、INCが最後に確定した人員不足スナップショットを返す。
// まだ一度も確定されていない場合は confirmed:false を返す（＝月間勤務表には何も表示しない）。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "monthは必須です" }, { status: 400 });

  const snapshot = await getConfirmedMonthShortages(month);
  if (!snapshot) return NextResponse.json({ confirmed: false, shortagesByDate: {} });

  return NextResponse.json({ confirmed: true, confirmedAt: snapshot.confirmedAt, shortagesByDate: snapshot.shortagesByDate });
}

const ConfirmInput = z.object({ month: z.string() }); // "2026-09"

// POST /api/roster/shift-adjustment/confirm
// INC（管理者）が「シフト調整完了」を確定したときに呼ぶ。現在確定しているシフト(MonthRoster)を
// 基準に不足人数・不足勤務帯を再計算し、その結果でスナップショットを上書き保存する。
// INCが再度シフトを変更した場合は、このAPIをもう一度叩くまで社員側の表示は更新されない。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "シフト調整完了の確定は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = ConfirmInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [year, mon] = parsed.data.month.split("-").map(Number);
  const snapshot = await confirmMonthShiftAdjustment(year, mon, session.user.email ?? undefined);

  const dateCount = Object.keys(snapshot.shortagesByDate).length;
  const totalShortage = Object.values(snapshot.shortagesByDate).reduce((sum, d) => sum + d.totalShortage, 0);

  return NextResponse.json({ ...snapshot, dateCount, totalShortage });
}
