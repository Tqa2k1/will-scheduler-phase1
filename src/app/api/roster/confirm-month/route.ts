import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendScheduleConfirmedEmail } from "@/lib/mailer";
import { z } from "zod";

const InputSchema = z.object({ month: z.string() }); // "2026-08"

// POST /api/roster/confirm-month
// INC（管理者）が月間スケジュールを確定したときに1回だけ呼ぶ想定。
// 通常のセル編集では呼ばれない（呼ばれるのはこのエンドポイントが叩かれたときだけ）。
// メールアドレスが未登録の従業員には送信しない。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "スケジュールの確定は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [year, mon] = parsed.data.month.split("-");
  const monthLabel = `${year}年${Number(mon)}月`;

  const employees = await prisma.employee.findMany({
    where: { isActive: true, contactEmail: { not: null } },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const loginUrl = `${baseUrl}/login`;

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const emp of employees) {
    if (!emp.contactEmail) continue;
    const result = await sendScheduleConfirmedEmail({
      to: emp.contactEmail,
      employeeName: emp.fullName,
      month: monthLabel,
      loginUrl,
    });
    if (result.ok) sent++;
    else {
      failed++;
      failures.push(`${emp.fullName}: ${result.reason}`);
    }
  }

  return NextResponse.json({
    totalEligible: employees.length,
    sent,
    failed,
    failures,
  });
}
