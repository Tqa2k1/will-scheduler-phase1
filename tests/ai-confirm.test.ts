// 実行: npx tsx tests/ai-confirm.test.ts
// 「AI依頼」による勤務希望の確定。OpenAI（Function Calling）はモックし、確定処理・DB更新・権限・週20時間は本物のコードで確認する。
import assert from "node:assert/strict";
import { fake, session, type Sess } from "./helpers/setup";
import { NextRequest } from "next/server";
import { __setAiClientForTest } from "../src/lib/aiAssist";
import { resolveNames } from "../src/lib/aiConfirm";
import * as route from "../src/app/api/shift-claims/ai-confirm/route";

process.env.OPENAI_API_KEY = "sk-test-not-real-0000";
const SESS = {
  emp: { user: { email: "emp@example.com", role: "EMPLOYEE", employeeId: "e1" } },
  inc: { user: { email: "inc@example.com", role: "INC", employeeId: null } },
} as const;
async function post(as: keyof typeof SESS | null, body: unknown) {
  session.current = as ? (SESS[as] as Sess) : null;
  const res = await route.POST(new NextRequest("http://localhost/api/shift-claims/ai-confirm", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

// OpenAIの代わり: 指定した関数呼び出しを順に行い、最後に文章を返す
function scripted(steps: { name: string; args: unknown }[], finalText: string, seen: string[] = []) {
  let i = 0;
  return {
    chat: { completions: { create: async (a: any) => {
      seen.push(JSON.stringify(a.messages.at(-1)).slice(0, 400));
      if (i < steps.length) {
        const s = steps[i++];
        return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: s.name, arguments: JSON.stringify(s.args) } }] } }] };
      }
      return { choices: [{ message: { role: "assistant", content: finalText } }] };
    } } },
  } as any;
}

const T = () => (fake as any).__tables;
async function seed() {
  for (const k of Object.keys(T())) T()[k].length = 0;
  __setAiClientForTest(null);
  // 8:00〜17:00（9時間・実労働8時間）。1日1人必要
  await fake.shiftType.create({ data: { id: "s1", code: "S1", name: "第1シフト", defaultStartTime: "08:00", defaultEndTime: "17:00", spansMidnight: false, requiredCount: 1 } });
  await fake.employee.create({ data: { id: "e1", fullName: "大川原 太郎", contactEmail: "o@example.com", role: "PARTTIME", priorityOrder: 1, isActive: true } });
  await fake.employee.create({ data: { id: "e2", fullName: "佐藤 花子", contactEmail: "s@example.com", role: "PARTTIME", priorityOrder: 2, isActive: true } });
  await fake.employee.create({ data: { id: "e3", fullName: "鈴木 一郎", contactEmail: "z@example.com", role: "STAFF", priorityOrder: 3, isActive: true } });
}
const claim = (id: string, employeeId: string, workDate: string) =>
  fake.shiftClaimRequest.create({ data: { id, employeeId, workDate: new Date(workDate + "T00:00:00Z"), shiftTypeId: "s1", status: "PENDING", requestedStartTime: null, requestedEndTime: null } });
const statusOf = (id: string) => (T().shiftClaimRequest as any[]).find((c) => c.id === id)?.status;

let n = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await seed(); await fn(); n++; console.log("ok -", name); } catch (e) { failed++; console.error("NG -", name, "\n", e); }
}
const FLOW = [{ name: "list_pending_employees", args: {} }, { name: "plan_confirmation", args: {} }];

async function main() {
  await t("氏名の解決: 姓だけ・空白違いOK／存在しない・複数該当はエラー理由つき", async () => {
    const list = [{ id: "e1", name: "大川原 太郎" }, { id: "e2", name: "大川原 花子" }, { id: "e3", name: "佐藤 一郎" }];
    assert.deepEqual(resolveNames(["佐藤"], list).ids, ["e3"]);
    assert.deepEqual(resolveNames(["大川原太郎"], list).ids, ["e1"]);
    assert.ok(resolveNames(["大川原"], list).problems[0].includes("複数"));
    assert.ok(resolveNames(["田中"], list).problems[0].includes("見つかりません"));
  });

  await t("権限: 未ログイン401・従業員403（プレビューも確定も）。DBは変わらない", async () => {
    await claim("c1", "e1", "2026-12-07");
    for (const body of [{ mode: "preview", month: "2026-12", prompt: "確定して" }, { mode: "execute", month: "2026-12", signature: "x", scope: {} }]) {
      assert.equal((await post(null, body)).status, 401);
      assert.equal((await post("emp", body)).status, 403);
    }
    assert.equal(statusOf("c1"), "PENDING");
  });

  await t("プレビュー: AIが関数を呼んで確定案を作る。この時点ではDBは変わらない／定員超過は不採用案", async () => {
    await claim("c1", "e1", "2026-12-07"); // 1人枠に2人が応募
    await claim("c2", "e2", "2026-12-07");
    __setAiClientForTest(scripted(FLOW, "確定案を作成しました。"));
    const r = await post("inc", { mode: "preview", month: "2026-12", prompt: "全員分を確定して" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result.approved.length, 1);
    assert.equal(r.json.result.notSelected.length, 1);
    assert.ok(r.json.result.notSelected[0].reason.includes("不採用"));
    assert.ok(r.json.result.weekly.length >= 1);
    assert.equal(statusOf("c1"), "PENDING"); assert.equal(statusOf("c2"), "PENDING");
  });

  await t("確定: プレビューの署名で実行 → 1人だけ APPROVED・もう1人は NOT_SELECTED・勤務表に WORK が入る", async () => {
    await claim("c1", "e1", "2026-12-07");
    await claim("c2", "e2", "2026-12-07");
    __setAiClientForTest(scripted(FLOW, "ok"));
    const p = await post("inc", { mode: "preview", month: "2026-12", prompt: "" });
    const x = await post("inc", { mode: "execute", month: "2026-12", signature: p.json.result.signature, scope: p.json.scope });
    assert.equal(x.status, 200, JSON.stringify(x.json));
    assert.equal(x.json.confirmed.length, 1);
    assert.equal(x.json.notConfirmed.filter((r: any) => r.kind === "不採用").length, 1);
    const st = [statusOf("c1"), statusOf("c2")].sort();
    assert.deepEqual(st, ["APPROVED", "NOT_SELECTED"]);
    const approvedId = statusOf("c1") === "APPROVED" ? "c1" : "c2";
    const emp = approvedId === "c1" ? "e1" : "e2";
    const roster = (T().monthRoster as any[]).filter((r) => r.employeeId === emp && r.status === "WORK");
    assert.equal(roster.length, 1, "勤務表に出勤が登録される");
    // 同じ署名での再実行は二重確定されない
    const again = await post("inc", { mode: "execute", month: "2026-12", signature: p.json.result.signature, scope: p.json.scope });
    assert.notEqual(again.status, 200);
  });

  await t("週20時間: バイトは1週間に9時間枠×3日は入らない（2日=18hまで）。超える分は確定されず理由つき", async () => {
    // 同じ週(12/6〜12/12の日曜始まり)の月・火・水に応募。8:00〜17:00は9時間枠 → 2日=18h、3日目は27h>20h
    await claim("c1", "e1", "2026-12-07");
    await claim("c2", "e1", "2026-12-08");
    await claim("c3", "e1", "2026-12-09");
    __setAiClientForTest(scripted([{ name: "list_pending_employees", args: {} }, { name: "plan_confirmation", args: { employeeNames: ["大川原"] } }], "ok"));
    const p = await post("inc", { mode: "preview", month: "2026-12", prompt: "大川原さんの勤務希望を20時間を超えないように確定して" });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.result.approved.length, 2);
    assert.equal(p.json.result.held.length, 1);
    assert.ok(p.json.result.held[0].reason.includes("20時間"));
    assert.ok(p.json.result.weekly.every((w: any) => w.limit === 20 && w.totalHours <= 20));
    const x = await post("inc", { mode: "execute", month: "2026-12", signature: p.json.result.signature, scope: p.json.scope });
    assert.equal(x.status, 200, JSON.stringify(x.json));
    assert.equal(x.json.confirmed.length, 2);
    assert.equal(x.json.notConfirmed.length, 1);
    assert.equal(x.json.notConfirmed[0].kind, "保留");
    assert.deepEqual(["c1", "c2", "c3"].map(statusOf).sort(), ["APPROVED", "APPROVED", "PENDING"]);
  });

  await t("絞り込み: 大川原さんだけ指定 → 佐藤さんの申請は変わらない", async () => {
    await claim("c1", "e1", "2026-12-07");
    await claim("c2", "e2", "2026-12-14");
    __setAiClientForTest(scripted([{ name: "list_pending_employees", args: {} }, { name: "plan_confirmation", args: { employeeNames: ["大川原"] } }], "ok"));
    const p = await post("inc", { mode: "preview", month: "2026-12", prompt: "大川原さんだけ" });
    const x = await post("inc", { mode: "execute", month: "2026-12", signature: p.json.result.signature, scope: p.json.scope });
    assert.equal(x.status, 200, JSON.stringify(x.json));
    assert.equal(statusOf("c1"), "APPROVED");
    assert.equal(statusOf("c2"), "PENDING");
  });

  await t("失敗は成功と言わない: 存在しない名前／関数を呼ばない／OpenAIエラー／キー未設定／対象なし", async () => {
    await claim("c1", "e1", "2026-12-07");
    __setAiClientForTest(scripted([{ name: "plan_confirmation", args: { employeeNames: ["田中"] } }], "確認しました"));
    let r = await post("inc", { mode: "preview", month: "2026-12", prompt: "田中さんを確定" });
    assert.equal(r.status, 422); assert.ok(r.json.error.includes("確定案を作成できません"));
    __setAiClientForTest(scripted([], "調整しました。"));
    r = await post("inc", { mode: "preview", month: "2026-12", prompt: "確定して" });
    assert.equal(r.status, 422, "文章だけの返答では成功扱いにしない");
    __setAiClientForTest({ chat: { completions: { create: async () => { throw Object.assign(new Error("boom sk-leak1234567890"), { status: 401 }); } } } } as any);
    r = await post("inc", { mode: "preview", month: "2026-12", prompt: "確定して" });
    assert.equal(r.status, 422); assert.ok(!JSON.stringify(r.json).includes("sk-leak"));
    __setAiClientForTest(null);
    const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    r = await post("inc", { mode: "preview", month: "2026-12", prompt: "確定して" });
    process.env.OPENAI_API_KEY = saved;
    assert.equal(r.status, 422); assert.ok(r.json.error.includes("OPENAI_API_KEY"));
    r = await post("inc", { mode: "preview", month: "2027-03", prompt: "確定して" });
    assert.equal(r.status, 422); assert.ok(r.json.error.includes("申請中の勤務希望はありません"));
    assert.equal(statusOf("c1"), "PENDING");
  });

  await t("実行時エラー: 署名不一致（プレビュー後に内容が変わった）は何も確定しない", async () => {
    await claim("c1", "e1", "2026-12-07");
    const x = await post("inc", { mode: "execute", month: "2026-12", signature: "stale", scope: {} });
    assert.equal(x.status, 409); assert.ok(x.json.error.includes("変わりました"));
    assert.equal(statusOf("c1"), "PENDING");
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
