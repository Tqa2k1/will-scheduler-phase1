import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// POST /api/roster/ai-assist
// 「AI追加」機能。ChatGPT(OpenAI API)に、指定した月の勤務表の概要とユーザーの依頼内容を渡し、
// 提案（不足人員の補完案、シフト調整案など）をテキストで返す。
// ※ 安全のため、AIの回答はあくまで「提案」であり、データベースへの自動反映は行わない
//   （提案を見て、管理者が既存のUI（パターン適用・手動編集等）で反映するかどうかを判断する）。
const InputSchema = z.object({ month: z.string(), prompt: z.string().optional() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "AI機能は管理者のみ利用できます" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      message: "AI機能を使うには環境変数 OPENAI_API_KEY を設定してください（未設定のため、まだご利用いただけません）。",
    });
  }

  const { month, prompt } = parsed.data;
  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));

  // 現在の勤務表の概要をAIに渡すためのコンテキストを作成（個人情報は最小限：氏名と出勤/公休の日数のみ）
  const entries = await prisma.monthRoster.findMany({
    where: { workDate: { gte: rangeStart, lt: rangeEnd } },
    include: { employee: true },
  });
  const summaryByEmployee = new Map<string, { name: string; work: number; off: number }>();
  for (const e of entries) {
    const key = e.employeeId;
    if (!summaryByEmployee.has(key)) summaryByEmployee.set(key, { name: e.employee.fullName, work: 0, off: 0 });
    const s = summaryByEmployee.get(key)!;
    if (e.status === "WORK") s.work++;
    else s.off++;
  }
  const contextLines = [...summaryByEmployee.values()]
    .map((s) => `${s.name}: 出勤${s.work}日 / 休み${s.off}日`)
    .join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "あなたはシフト管理アシスタントです。与えられた勤務表の概要をもとに、不足している可能性がある点や改善提案を、日本語で簡潔に箇条書きで答えてください。実際のデータベース変更は行わず、あくまで提案のみを行ってください。",
          },
          {
            role: "user",
            content: `${month} の勤務状況:\n${contextLines || "（データなし）"}\n\n依頼内容: ${prompt || "全体的な過不足を確認して、改善案を提案してください。"}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ message: `AIへの問い合わせに失敗しました（${res.status}）: ${text}` });
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message?.content ?? "AIから有効な回答が得られませんでした。";
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json({
      message: `AIへの問い合わせ中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
