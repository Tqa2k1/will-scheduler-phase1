import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { validateLinkableEmployee, syncUserNameFromEmployee } from "@/lib/userEmployeeLink";

// GET /api/users — アカウント一覧（管理者のみ）
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "アカウント設定のログインアカウント管理は管理者のみ可能です" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, name: true, role: true, employeeId: true, createdAt: true,
      employee: { select: { fullName: true, isActive: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  // 紐付け先の従業員が削除済み（isActive=false）の場合は「未紐付け」として返す。
  // （削除済み従業員の名前を「紐付け従業員」に表示しない）
  return NextResponse.json(
    users.map((u) =>
      u.employee && u.employee.isActive
        ? { ...u, employee: { fullName: u.employee.fullName } }
        : { ...u, employeeId: null, employee: null }
    ),
    { headers: { "Cache-Control": "no-store" } }
  );
}

const UserInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(), // 従業員に紐付ける場合は従業員の氏名を使うため省略可

  password: z.string().min(6),
  role: z.enum(["ADMIN", "INC", "EMPLOYEE"]).default("EMPLOYEE"),
  employeeId: z.string().optional(),
});

// POST /api/users — 新しいアカウントを作成（管理者のみ）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "アカウント作成は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UserInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!parsed.data.employeeId && !parsed.data.name) {
    return NextResponse.json({ error: "表示名を入力してください" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return NextResponse.json({ error: "このメールアドレスは既に使用されています" }, { status: 409 });

  // 紐付ける従業員は「在籍中」かつ「他のアカウントに未紐付け」のものだけ
  if (parsed.data.employeeId) {
    const check = await validateLinkableEmployee(parsed.data.employeeId, null);
    if (check) return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name ?? "",
      passwordHash,
      role: parsed.data.role,
      employeeId: parsed.data.employeeId || null,
    },
  });

  // 従業員に紐付けた場合、表示名は従業員の氏名（正のデータ）に揃える
  if (parsed.data.employeeId) await syncUserNameFromEmployee(parsed.data.employeeId);
  const saved = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });

  return NextResponse.json({ id: user.id, email: user.email, name: saved?.name ?? user.name, role: user.role }, { status: 201 });
}
