import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// POST /api/roster/ai-assist
// 「AI追加」機能の土台となるエンドポイント。現時点では実際のAI提案ロジックは未実装で、
// 準備中メッセージを返すのみ。将来、不足人員の提案・シフト最適化案などをここに実装していく。
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

  // TODO: ここに実際のAI提案ロジックを実装する（不足人員の提案、シフト最適化案の生成など）
  return NextResponse.json({
    message: "AI機能は現在準備中です。今後のアップデートで、不足人員の自動提案などに対応予定です。",
  });
}
