import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requestAiJson, AI_NO_KEY_MESSAGE } from "@/lib/aiAssist";

const InputSchema = z.object({
  month: z.string(),
  prompt: z.string().max(1000, "依頼内容は1000文字以内で入力してください").optional(),
});

const VALID_STATUS = ["WORK", "OFF", "PAID_LEAVE", "ADJUST_LEAVE"] as const;

// POST /api/roster/ai-assist — 月間勤務表のAI変更案（管理者のみ）。DBは変更しない（提案のみ）。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) {
    return NextResponse.json({ error: "AI機能は管理者のみ利用できます" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { month, prompt } = parsed.data;

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ message: AI_NO_KEY_MESSAGE });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  // 在籍中（削除済みでない）の従業員だけを対象にする。月間勤務表の画面・Excel出力と同じ条件。
  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
    prisma.monthRoster.findMany({ where: { workDate: { gte: rangeStart, lt: rangeEnd } } }),
  ]);

  const summary = new Map<string, { work: number; off: number }>();
  for (const e of employees) summary.set(e.id, { work: 0, off: 0 });
  for (const e of entries) {
    const s = summary.get(e.employeeId);
    if (!s) continue; // 削除済み従業員のデータは集計に含めない
    if (e.status === "WORK") s.work++;
    else s.off++;
  }

  const contextLines = employees
    .map((emp) => {
      const s = summary.get(emp.id)!;
      return `${emp.fullName}: 出勤${s.work}日 / 休み${s.off}日`;
    })
    .join("\n");

  const system = `
あなたはWHILLシフト管理AIです。

必ずJSONのみ返してください。
説明文は禁止です。

形式:

{
 "message":"説明",
 "changes":[
  {
   "employeeName":"社員名",
   "date":"YYYY-MM-DD",
   "newStatus":"WORK|OFF|PAID_LEAVE|ADJUST_LEAVE"
  }
 ]
}


ルール:

- 実在する社員名のみ使用
- 日付は対象月内のみ
- 勝手に社員を追加しない
- データベース変更は禁止
- 変更提案だけ返す
`;

  const user = `
対象月:
${month}


現在の勤務状況:

${contextLines || "データなし"}


管理者からの依頼:

${prompt || "勤務状況を分析して改善案を提案してください"}
`;

  const result = await requestAiJson(system, user, { query: prompt, scope: month, by: session.user.email });

  // AIの提案を検証する（存在しない従業員・範囲外の日付・不正なステータスは除外）。
  // 従業員は氏名ではなくIDで確実に特定できるよう employeeId を付けて返す。
  const idByName = new Map(employees.map((e) => [e.fullName, e.id]));
  const changes = (result.changes as any[])
    .filter((c) => c && typeof c.employeeName === "string" && typeof c.date === "string" && typeof c.newStatus === "string")
    .filter((c) => idByName.has(c.employeeName))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.date.startsWith(month))
    .filter((c) => (VALID_STATUS as readonly string[]).includes(c.newStatus))
    .map((c) => ({ employeeId: idByName.get(c.employeeName)!, employeeName: c.employeeName, date: c.date, newStatus: c.newStatus }));

  return NextResponse.json({ message: result.message, changes });
}
