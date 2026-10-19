// 実行: npx tsx tests/ai.test.ts
// AI機能（知識の検索・整理済みメモ・APIキーの保護・権限）を、OpenAIをモックして確認する。実際のOpenAIには接続しない。
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { fake, session, type Sess } from "./helpers/setup";
import { NextRequest } from "next/server";
import { retrieveKnowledge, buildKnowledgeBlock, tokenize } from "../src/lib/aiKnowledge";
import { KNOWLEDGE } from "../src/lib/aiKnowledge.generated";
import { maskSecrets, friendlyAiError, requestAiJson, __setAiClientForTest } from "../src/lib/aiAssist";
import { makeNote, loadMemory, saveMemory, MAX_NOTES } from "../src/lib/aiMemory";
import * as rosterAi from "../src/app/api/roster/ai-assist/route";
import * as scheduleAi from "../src/app/api/schedule/ai-assist/route";

let n = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try {
    const T = (fake as any).__tables;
    for (const k of Object.keys(T)) T[k].length = 0;
    __setAiClientForTest(null);
    await fn(); n++; console.log("ok -", name);
  } catch (e) { failed++; console.error("NG -", name, "\n", e); }
}

type Call = { messages: { role: string; content: string }[] };
function mockClient(reply: unknown, calls: Call[] = []) {
  return {
    chat: { completions: { create: async (args: Call) => { calls.push(args); if (reply instanceof Error) throw reply; return { choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] }; } } },
  } as any;
}
const SESS = {
  emp: { user: { email: "emp@example.com", role: "EMPLOYEE", employeeId: "e1" } },
  inc: { user: { email: "inc@example.com", role: "INC", employeeId: null } },
} as const;
async function post(h: (r: NextRequest) => Promise<Response>, url: string, as: keyof typeof SESS | null, body: unknown) {
  session.current = as ? (SESS[as] as Sess) : null;
  const res = await h(new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  await t("知識ファイルは docs・コードと同期している（古ければ npm run ai:knowledge）", async () => {
    execSync("npx tsx scripts/buildAiKnowledge.ts --check", { stdio: "pipe" });
    assert.ok(KNOWLEDGE.length > 50);
  });
  await t("検索: 質問に関連する資料が上位に出る（権限／DB／人員不足）", async () => {
    const perm = retrieveKnowledge("従業員の権限は？ ADMINとINCの違い").map((c) => c.source + c.title).join("|");
    assert.ok(/PERMISSIONS|権限/.test(perm), perm);
    const db = retrieveKnowledge("ShiftClaimRequest テーブルのフィールド").map((c) => c.text).join("|");
    assert.ok(db.includes("ShiftClaimRequest"));
    const sh = retrieveKnowledge("人員不足を確定してメールを送る").map((c) => c.title + c.text).join("|");
    assert.ok(/人員不足/.test(sh));
    assert.deepEqual(retrieveKnowledge("   "), []);
    assert.ok(tokenize("勤務希望 abc").includes("勤務") && tokenize("勤務希望 abc").includes("abc"));
  });
  await t("検索: 文字数の上限を守る（プロンプト肥大化の防止）", async () => {
    const hits = retrieveKnowledge("勤務 シフト 人員 権限 確定", { limit: 10, maxChars: 1800 });
    const total = hits.reduce((a, h) => a + h.text.length, 0);
    assert.ok(total <= 1800 + (hits[0]?.text.length ?? 0));
    assert.ok(buildKnowledgeBlock("勤務表").includes("Assignの基本"));
  });
  await t("APIキーの保護: エラー文のキー・Bearerを伏せ、401等は定型文にする", async () => {
    assert.ok(!maskSecrets("bad key sk-abcDEF1234567890xyz and Bearer abc.def-123").includes("abcDEF"));
    assert.ok(!maskSecrets("Bearer abc.def-123").includes("abc.def"));
    assert.ok(friendlyAiError({ status: 401, message: "Incorrect API key sk-live1234567890" }).includes("OPENAI_API_KEY"));
    assert.ok(!friendlyAiError({ status: 401, message: "sk-live1234567890" }).includes("sk-live"));
    assert.ok(friendlyAiError({ status: 429 }).includes("上限"));
    assert.ok(!friendlyAiError(new Error("fail sk-secretsecret123")).includes("secretsecret"));
  });
  await t("メモ: 要点のみ保存・重複/短すぎる依頼は保存しない・最新のみ再利用・上限で削除", async () => {
    assert.equal(makeNote("ab", "x"), null);
    assert.ok(makeNote("来週の田中さんを公休にして".repeat(20), "回答".repeat(100))!.length <= 160);
    await saveMemory("2026-11", "田中さんを5日公休にして", "提案しました", "inc@example.com");
    await saveMemory("2026-11", "田中さんを5日公休にして", "提案しました", "inc@example.com");
    await saveMemory("2026-11", "", "x");
    assert.equal((fake as any).__tables.aiMemory.length, 1);
    for (let i = 0; i < MAX_NOTES + 5; i++) await saveMemory("2026-11", `依頼その${i}番目です`, "ok");
    assert.ok((fake as any).__tables.aiMemory.length <= MAX_NOTES);
    assert.equal((await loadMemory("2026-12")).length, 0, "他の月のメモは使わない");
    assert.ok((await loadMemory("2026-11")).length <= 5);
  });
  await t("requestAiJson: キー未設定は案内文／知識とメモがプロンプトに入り、結果を返す・メモを保存する", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r0 = await requestAiJson("sys", "usr");
    assert.ok(r0.message.includes("OPENAI_API_KEY"));
    process.env.OPENAI_API_KEY = "sk-test-not-real-0000";
    const calls: Call[] = [];
    __setAiClientForTest(mockClient({ message: "提案です", changes: [{ a: 1 }] }, calls));
    await saveMemory("2026-11", "前回の依頼メモです", "前回結果");
    const r = await requestAiJson("勤務表のAIです", "データ", { query: "人員不足の権限について", scope: "2026-11", by: "inc@example.com" });
    assert.equal(r.message, "提案です"); assert.equal(r.changes.length, 1);
    const sys = calls[0].messages[0].content, usr = calls[0].messages[1].content;
    assert.ok(sys.includes("Assignの基本") && sys.includes("関連する資料"));
    assert.ok(usr.includes("過去の依頼メモ") && usr.includes("前回の依頼メモです"));
    assert.ok(!sys.includes("sk-test") && !usr.includes("sk-test"), "キーはプロンプトに入れない");
    assert.equal((fake as any).__tables.aiMemory.length, 2);
    // 不正なJSON／例外でも落ちない
    __setAiClientForTest(mockClient("これはJSONではない"));
    assert.equal((await requestAiJson("s", "u")).changes.length, 0);
    __setAiClientForTest(mockClient(Object.assign(new Error("x sk-leakleakleak123"), { status: 401 })));
    const e = await requestAiJson("s", "u");
    assert.ok(!e.message.includes("leakleak"));
    if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
  });
  await t("権限: 未ログイン401・従業員403（roster/schedule の両AI）／INCは通る／依頼文の長さ上限", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real-0000";
    __setAiClientForTest(mockClient({ message: "ok", changes: [] }));
    for (const [h, url, body] of [[rosterAi.POST, "/api/roster/ai-assist", { month: "2026-11", prompt: "x" }], [scheduleAi.POST, "/api/schedule/ai-assist", { date: "2026-11-05", prompt: "x" }]] as const) {
      assert.equal((await post(h, url, null, body)).status, 401);
      assert.equal((await post(h, url, "emp", body)).status, 403);
      const ok = await post(h, url, "inc", body);
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      const long = await post(h, url, "inc", { ...body, prompt: "あ".repeat(1001) });
      assert.equal(long.status, 400);
    }
  });
  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
