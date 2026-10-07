import OpenAI from "openai";

// 月間勤務表の「AI追加」と日別スケジュールの「AI追加」で共通のAI呼び出し処理。
// モデル・JSON解析・エラーメッセージを1か所に集約し、2つの画面で動作が食い違わないようにする。
// AIは「変更案」を返すだけで、DBを直接変更することはない（適用は管理者が画面で押した時のみ）。

export const AI_MODEL = "gpt-4o-mini";

export const AI_NO_KEY_MESSAGE = "AI機能を使うには環境変数 OPENAI_API_KEY を設定してください。";

export type AiJsonResult = { message: string; changes: unknown[] };

export async function requestAiJson(system: string, user: string): Promise<AiJsonResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { message: AI_NO_KEY_MESSAGE, changes: [] };

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    // ```json を削除
    const raw = (completion.choices[0]?.message?.content ?? "{}").replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed: { message?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { message: raw, changes: [] };
    }
    return {
      message: typeof parsed.message === "string" ? parsed.message : "AI分析完了",
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
  } catch (err) {
    return {
      message: `AIへの問い合わせ中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
      changes: [],
    };
  }
}
