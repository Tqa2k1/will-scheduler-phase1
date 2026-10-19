import OpenAI from "openai";
import { buildKnowledgeBlock } from "@/lib/aiKnowledge";
import { loadMemory, saveMemory, memoryBlock } from "@/lib/aiMemory";

// 月間勤務表の「AI追加」と日別スケジュールの「AI追加」で共通のAI呼び出し処理。
// モデル・JSON解析・エラーメッセージを1か所に集約し、2つの画面で動作が食い違わないようにする。
// AIは「変更案」を返すだけで、DBを直接変更することはない（適用は管理者が画面で押した時のみ）。
//
// 改善点（v20）:
//  - プロジェクト知識（docs・DBスキーマ・API権限・コード地図）から、依頼内容に関連する部分だけを検索してプロンプトに加える（aiKnowledge.ts）。
//  - 過去の依頼は全文ではなく整理済みメモとして月ごとに少数だけ再利用する（aiMemory.ts）。
//  - クライアントを使い回し、タイムアウト・再試行・低い temperature で速度と安定性を改善。
//  - APIキーはサーバー側の環境変数のみ。エラー文に含まれるキー断片はマスクし、内部エラーの詳細は画面に出さない。

export const AI_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 40_000;

export const AI_NO_KEY_MESSAGE = "AI機能を使うには環境変数 OPENAI_API_KEY を設定してください。";

export type AiJsonResult = { message: string; changes: unknown[] };

// 文字列中のAPIキー（sk-...）を伏せる
export function maskSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_\-]{6,}/g, "sk-****").replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ****");
}

// OpenAIのエラーを、画面に出して安全な日本語に変換する（キーや内部情報を含めない）
export function friendlyAiError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  const name = (err as { name?: string } | null)?.name ?? "";
  if (status === 401) return "AIの認証に失敗しました。OPENAI_API_KEY を確認してください。";
  if (status === 429) return "AIの利用上限に達したか、混雑しています。しばらくしてから再度お試しください。";
  if (status && status >= 500) return "AIサービス側で一時的なエラーが発生しました。しばらくしてから再度お試しください。";
  if (/timeout|abort/i.test(name) || /timed? ?out/i.test((err as Error | null)?.message ?? "")) return "AIの応答がタイムアウトしました。依頼内容を短くして再度お試しください。";
  return `AIへの問い合わせ中にエラーが発生しました: ${maskSecrets(err instanceof Error ? err.message : String(err))}`.slice(0, 300);
}

// クライアントは使い回す（キーが変わった時だけ作り直す）。テストでは差し替えられる。
let cached: { key: string; client: OpenAI } | null = null;
let override: Pick<OpenAI, "chat"> | null = null;
export function __setAiClientForTest(c: Pick<OpenAI, "chat"> | null) { override = c; }
function getClient(apiKey: string): Pick<OpenAI, "chat"> {
  if (override) return override;
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) };
  return cached.client;
}

export type AiOptions = {
  /** 依頼内容。関連する知識の検索と、整理済みメモの保存に使う */
  query?: string;
  /** メモの単位（対象月 "2026-11"）。指定がなければメモは使わない */
  scope?: string;
  /** 操作者（メモの記録用） */
  by?: string | null;
};

export async function requestAiJson(system: string, user: string, opts: AiOptions = {}): Promise<AiJsonResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !override) return { message: AI_NO_KEY_MESSAGE, changes: [] };

  try {
    const notes = opts.scope ? await loadMemory(opts.scope) : [];
    const fullSystem = system + buildKnowledgeBlock(`${opts.query ?? ""} ${system.slice(0, 200)}`);
    const fullUser = user + memoryBlock(notes);

    const completion = await getClient(apiKey ?? "").chat.completions.create({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: fullSystem },
        { role: "user", content: fullUser },
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
    const result = {
      message: typeof parsed.message === "string" ? parsed.message : "AI分析完了",
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
    if (opts.scope && opts.query) await saveMemory(opts.scope, opts.query, result.message, opts.by);
    return result;
  } catch (err) {
    return { message: friendlyAiError(err), changes: [] };
  }
}

// ---- Function Calling（Tool Calling） ----
// AIが「道具（関数）」を呼び、その結果を見て答える。道具の中身（実際の業務処理）はサーバー側のコードで、
// 権限チェック済みの呼び出し元が渡した関数だけが実行される。AIが自分でDBやAPIに触ることはない。
export type AiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run: (args: any) => Promise<unknown>;
};
export type AiToolResult = { message: string; error?: string; calls: { name: string; args: unknown }[] };

export async function runAiTools(system: string, user: string, tools: AiTool[], opts: { maxSteps?: number } = {}): Promise<AiToolResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !override) return { message: AI_NO_KEY_MESSAGE, error: AI_NO_KEY_MESSAGE, calls: [] };
  const calls: AiToolResult["calls"] = [];
  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  try {
    const client = getClient(apiKey ?? "");
    for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
      const completion = await client.chat.completions.create({
        model: AI_MODEL,
        temperature: 0.1,
        max_tokens: 1200,
        messages,
        tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: "auto",
      } as any);
      const msg: any = completion.choices[0]?.message ?? {};
      if (!msg.tool_calls?.length) return { message: (msg.content ?? "").trim() || "処理が完了しました。", calls };
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const tool = tools.find((t) => t.name === tc.function?.name);
        let out: unknown;
        let args: unknown = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
          calls.push({ name: tc.function?.name, args });
          out = tool ? await tool.run(args) : { error: `不明な関数です: ${tc.function?.name}` };
        } catch (e) {
          out = { error: e instanceof Error ? e.message : "関数の実行に失敗しました" };
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) });
      }
    }
    return { message: "", error: "AIの処理が規定回数内に完了しませんでした。依頼内容を具体的にして再度お試しください。", calls };
  } catch (err) {
    const m = friendlyAiError(err);
    return { message: m, error: m, calls };
  }
}
