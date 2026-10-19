import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isManagerRole } from "@/lib/roles";
import { isRegistrationStopped, setRegistrationStopped } from "@/lib/claimHold";
import { isValidMonth } from "@/lib/monthStatusShared";
import { z } from "zod";

// GET /api/shift-claims/registration-hold?month=2026-11 — その月の勤務希望登録が停止中か（ログイン済みなら誰でも）
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month");
  if (!isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  return NextResponse.json({ month, isStopped: await isRegistrationStopped(month) });
}

const Input = z.object({ month: z.string(), stopped: z.boolean() });

// POST /api/shift-claims/registration-hold — 停止／再開（INC・管理者のみ。従業員は403）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "登録の停止・再開はINC（管理者）のみ可能です" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success || !isValidMonth(parsed.data.month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  const result = await setRegistrationStopped(parsed.data.month, parsed.data.stopped, session.user.email);
  return NextResponse.json(result);
}
