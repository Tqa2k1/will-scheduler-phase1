// 実行: npx tsx tests/claims.test.ts
// 勤務希望のキャンセル（確定前=即時／確定後=INC承認）・月別の登録停止/再開・人数集計を、
// インメモリDBと本物のAPIルート関数で通しで確認する（メールは送らない）。
import assert from "node:assert/strict";
import { fake, session, type Sess } from "./helpers/setup";
import { NextRequest } from "next/server";
import * as claimsRoute from "../src/app/api/shift-claims/route";
import * as cancelRoute from "../src/app/api/shift-claims/[id]/cancel/route";
import * as claimIdRoute from "../src/app/api/shift-claims/[id]/route";
import * as holdRoute from "../src/app/api/shift-claims/registration-hold/route";
import * as myMonthRoute from "../src/app/api/shift-claims/my-month/route";
import * as previewRoute from "../src/app/api/shortage/preview/route";

const MONTH = "2026-12";
const DAY = "2026-12-07";
const SESS = {
  e1: { user: { email: "emp1@example.com", role: "EMPLOYEE", employeeId: "e1" } },
  e2: { user: { email: "emp2@example.com", role: "EMPLOYEE", employeeId: "e2" } },
  inc: { user: { email: "inc@example.com", role: "INC", employeeId: null } },
  admin: { user: { email: "admin@example.com", role: "ADMIN", employeeId: null } },
} as const;
type Who = keyof typeof SESS;

async function call(handler: (r: NextRequest, c: any) => Promise<Response>, url: string, as: Who | null, init?: { method?: string; body?: unknown }, params: any = {}) {
  session.current = as ? (SESS[as] as Sess) : null;
  const r = new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const res = await handler(r, { params });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json };
}
const post = (who: Who | null, body: unknown) => call(claimsRoute.POST, "/api/shift-claims", who, { method: "POST", body });
const hold = (who: Who | null, stopped: boolean, month = MONTH) => call(holdRoute.POST, "/api/shift-claims/registration-hold", who, { method: "POST", body: { month, stopped } });

async function seed() {
  const T = (fake as any).__tables;
  for (const k of Object.keys(T)) T[k].length = 0;
  await fake.shiftType.create({ data: { id: "s1", code: "S1", name: "第1シフト", defaultStartTime: "08:00", defaultEndTime: "17:00", spansMidnight: false, requiredCount: 2 } });
  await fake.shiftType.create({ data: { id: "s2", code: "S2", name: "第2シフト", defaultStartTime: "13:00", defaultEndTime: "22:00", spansMidnight: false, requiredCount: 2 } });
  await fake.employee.create({ data: { id: "e1", fullName: "佐藤 花子", contactEmail: "emp1@example.com", role: "PARTTIME" } });
  await fake.employee.create({ data: { id: "e2", fullName: "鈴木 一郎", contactEmail: "emp2@example.com", role: "PARTTIME" } });
}
const claimsOf = async () => (fake as any).__tables.shiftClaimRequest as any[];

let failed = 0, n = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await seed(); await fn(); n++; console.log("ok -", name); } catch (e) { failed++; console.error("NG -", name, "\n", e); }
}

async function main() {
  await t("確定前: 従業員は登録→即時キャンセルでき、INC一覧・集計から消える（履歴は残る）", async () => {
    const r = await post("e1", { workDate: DAY, shiftTypeId: "s2", requestedStartTime: "16:00", requestedEndTime: "22:00" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const id = (await claimsOf())[0].id;
    let list = await call(claimsRoute.GET, `/api/shift-claims?month=${MONTH}`, "inc");
    assert.equal(list.json.claims.length, 1);
    assert.equal(list.json.slots.find((s: any) => s.date === DAY && s.shiftTypeId === "s2").requested, 1);

    const c = await call(cancelRoute.POST, `/api/shift-claims/${id}/cancel`, "e1", { method: "POST" }, { id });
    assert.equal(c.json.status, "CANCELED"); // INC承認なしで即時
    list = await call(claimsRoute.GET, `/api/shift-claims?month=${MONTH}`, "inc");
    assert.equal(list.json.claims.length, 0, "INC画面に表示しない");
    assert.equal(list.json.slots.find((s: any) => s.date === DAY && s.shiftTypeId === "s2").requested, 0, "希望人数に数えない");
    const row = (await claimsOf())[0];
    assert.equal(row.status, "CANCELED");
    assert.ok(row.decidedAt && row.decidedBy === "emp1@example.com", "キャンセル日時と操作者を記録");
    const pv = await call(previewRoute.GET, `/api/shortage/preview?month=${MONTH}`, "inc");
    assert.equal(pv.json.gaps.find((g: any) => g.date === DAY && g.shiftLabel.includes("13:00"))?.requested ?? 0, 0);
  });

  await t("他人の勤務希望はキャンセルできない（404）", async () => {
    await post("e1", { workDate: DAY, shiftTypeId: "s1" });
    const id = (await claimsOf())[0].id;
    assert.equal((await call(cancelRoute.POST, `x`, "e2", { method: "POST" }, { id })).status, 404);
    assert.equal((await call(cancelRoute.POST, `x`, "inc", { method: "POST" }, { id })).status, 403);
  });

  await t("確定後: 即時キャンセル不可。取消申請→INC承認までは確定のまま（人数不変）→承認で取消", async () => {
    await post("e1", { workDate: DAY, shiftTypeId: "s1" });
    const id = (await claimsOf())[0].id;
    const ap = await call(claimIdRoute.PATCH, `/api/shift-claims/${id}`, "inc", { method: "PATCH", body: { decision: "APPROVED" } }, { id });
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    assert.equal((await fake.monthRoster.count({ where: { employeeId: "e1", status: "WORK" } })), 1);

    const c = await call(cancelRoute.POST, `x`, "e1", { method: "POST" }, { id });
    assert.equal(c.json.status, "CANCEL_REQUESTED", "即時キャンセルにはならない");
    assert.equal((await claimsOf())[0].status, "CANCEL_REQUESTED");
    assert.equal((await fake.monthRoster.count({ where: { employeeId: "e1", status: "WORK" } })), 1, "承認まで勤務確定のまま");
    // 取消申請中のものはINC画面に残る（承認操作が必要）
    const list = await call(claimsRoute.GET, `/api/shift-claims?month=${MONTH}`, "inc");
    assert.equal(list.json.claims.length, 1);
    // 従業員は承認できない
    assert.equal((await call(claimIdRoute.PATCH, `x`, "e1", { method: "PATCH", body: { decision: "CANCEL_APPROVED" } }, { id })).status, 403);

    const ok = await call(claimIdRoute.PATCH, `x`, "inc", { method: "PATCH", body: { decision: "CANCEL_APPROVED" } }, { id });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await claimsOf())[0].status, "CANCELED");
    assert.equal((await fake.monthRoster.count({ where: { employeeId: "e1", status: "WORK" } })), 0);
  });

  await t("登録停止/再開: INC・ADMINのみ操作可（従業員・未ログインは拒否）", async () => {
    assert.equal((await hold("e1", true)).status, 403);
    assert.equal((await hold(null, true)).status, 401);
    assert.equal((await call(holdRoute.POST, "x", "inc", { method: "POST", body: { month: "bad", stopped: true } })).status, 400);
    assert.equal((await hold("inc", true)).status, 200);
    assert.equal((await call(holdRoute.GET, `/api/shift-claims/registration-hold?month=${MONTH}`, "e1")).json.isStopped, true);
    assert.equal((await call(holdRoute.GET, `/api/shift-claims/registration-hold?month=2027-01`, "e1")).json.isStopped, false, "月ごとに独立");
    assert.equal((await hold("admin", false)).status, 200);
    assert.equal((await call(holdRoute.GET, `/api/shift-claims/registration-hold?month=${MONTH}`, "e1")).json.isStopped, false);
  });

  await t("停止中: 新規登録・変更はAPIで拒否、既存データは残り、未確定のキャンセルは可能、再開で登録可", async () => {
    await post("e1", { workDate: DAY, shiftTypeId: "s1" });
    const id = (await claimsOf())[0].id;
    await hold("inc", true);
    const nw = await post("e2", { workDate: DAY, shiftTypeId: "s1" });
    assert.equal(nw.status, 403);
    assert.equal(nw.json.registrationStopped, true);
    const chg = await post("e1", { workDate: DAY, shiftTypeId: "s1", requestedStartTime: "09:00", requestedEndTime: "12:00" });
    assert.equal(chg.status, 403, "変更も不可");
    assert.equal((await claimsOf()).length, 1, "既存データは削除されない");
    assert.equal((await claimsOf())[0].requestedStartTime ?? null, null);
    const mm = await call(myMonthRoute.GET, `/api/shift-claims/my-month?month=${MONTH}`, "e1");
    assert.equal(mm.json.registrationStopped, true);
    // 他の月は影響なし（停止は2026-12のみ）
    assert.equal((await call(myMonthRoute.GET, `/api/shift-claims/my-month?month=2027-01`, "e1")).json.registrationStopped, false);
    // 未確定のキャンセルは停止中でも可能
    assert.equal((await call(cancelRoute.POST, `x`, "e1", { method: "POST" }, { id })).json.status, "CANCELED");
    await hold("inc", false);
    assert.equal((await post("e2", { workDate: DAY, shiftTypeId: "s1" })).status, 201);
  });

  await t("人数: 選択シフト基準で数え、時間の一部でも1人。時間はシフト外だと拒否。確定と希望は別", async () => {
    // 第2シフト(13:00-22:00)を選び16:00-22:00 → 第2シフトに1人
    assert.equal((await post("e1", { workDate: DAY, shiftTypeId: "s2", requestedStartTime: "16:00", requestedEndTime: "22:00" })).status, 201);
    // 第1シフト(08:00-17:00)を選び 13:00-17:00 → 時間から逆算せず第1シフトで数える
    assert.equal((await post("e2", { workDate: DAY, shiftTypeId: "s1", requestedStartTime: "13:00", requestedEndTime: "17:00" })).status, 201);
    // シフト外の時間は拒否
    assert.equal((await post("e2", { workDate: "2026-12-08", shiftTypeId: "s1", requestedStartTime: "07:00", requestedEndTime: "12:00" })).status, 400);
    const list = await call(claimsRoute.GET, `/api/shift-claims?month=${MONTH}`, "inc");
    const s1 = list.json.slots.find((s: any) => s.date === DAY && s.shiftTypeId === "s1");
    const s2 = list.json.slots.find((s: any) => s.date === DAY && s.shiftTypeId === "s2");
    assert.equal(s1.requested, 1); assert.equal(s2.requested, 1);
    assert.equal(s1.current, 0, "希望は確定人数に含めない"); assert.equal(s1.shortage, 2);
    // 同じ従業員・同日の再登録は重複せず1件のまま（変更扱い）
    await post("e1", { workDate: DAY, shiftTypeId: "s2", requestedStartTime: "14:00", requestedEndTime: "22:00" });
    assert.equal((await claimsOf()).filter((c) => c.employeeId === "e1").length, 1);
    // INCが承認すると確定人数に移る
    const id = (await claimsOf()).find((c) => c.employeeId === "e2").id;
    await call(claimIdRoute.PATCH, `x`, "inc", { method: "PATCH", body: { decision: "APPROVED" } }, { id });
    const l2 = await call(claimsRoute.GET, `/api/shift-claims?month=${MONTH}`, "inc");
    const s1b = l2.json.slots.find((s: any) => s.date === DAY && s.shiftTypeId === "s1");
    assert.equal(s1b.current, 1); assert.equal(s1b.requested, 0); assert.equal(s1b.shortage, 1);
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
