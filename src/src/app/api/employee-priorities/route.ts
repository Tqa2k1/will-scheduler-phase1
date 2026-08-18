import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/employee-priorities
// 「役割優先順位」画面の補足機能: 各従業員（正社員/契約社員/バイト等）の中での優先順位一覧を返す。
// 既存の RolePriority（役割単位）とは別物。担当業務(A/B/全/WHILL等)には使わない。
// 人員不足時に「同じ役割の中でどの従業員を優先的に選ぶか」だけに使う。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const [employees, priorities] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true } }),
    prisma.employeePriority.findMany(),
  ]);

  const priorityByEmployee = new Map(priorities.map((p) => [p.employeeId, p.priorityOrder]));

  const result = employees
    .map((e) => ({
      employeeId: e.id,
      fullName: e.fullName,
      role: e.role,
      // 未設定の従業員は一律で最後尾に並ぶよう大きな値を仮に割り当てる（保存時は連番で振り直される）
      priorityOrder: priorityByEmployee.get(e.id) ?? 999999,
    }))
    .sort((a, b) => a.priorityOrder - b.priorityOrder);

  return NextResponse.json(result);
}

const UpdateInput = z.object({
  items: z.array(z.object({ employeeId: z.string(), priorityOrder: z.number().int() })),
});

// PATCH /api/employee-priorities — 従業員個人の優先順位を一括更新（管理者のみ）。
// priorityOrder はロール(役割)グループ内での連番として画面側から送られてくる想定だが、
// このAPI自体はグループを意識せず、渡された値をそのまま保存する（グループ分けは表示上の都合）。
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "優先順位の変更は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UpdateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  for (const item of parsed.data.items) {
    await prisma.employeePriority.upsert({
      where: { employeeId: item.employeeId },
      update: { priorityOrder: item.priorityOrder },
      create: { employeeId: item.employeeId, priorityOrder: item.priorityOrder },
    });
  }

  const priorities = await prisma.employeePriority.findMany();
  return NextResponse.json(priorities);
}
