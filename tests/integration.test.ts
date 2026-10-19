// 実行: npx tsx tests/integration.test.ts
// 月の状態（調整中／確定）・権限・メール配信を、インメモリDBと本物のAPIルート関数で通しで確認する。
// メールは一切実送信しない（dry-run、または nodemailer をスタブ化して送信内容を記録するだけ）。
import assert from "node:assert/strict";

import { fake, session, sentMails, type Sess } from "./helpers/setup";

import { NextRequest } from "next/server";
import * as rosterRoute from "../src/app/api/roster/route";
import * as confirmRoute from "../src/app/api/roster/confirm-month/route";
import * as statusRoute from "../src/app/api/roster/month-status/route";
import * as scheduleRoute from "../src/app/api/schedule/route";
import * as rosterExcel from "../src/app/api/export/roster-excel/route";
import * as scheduleExcel from "../src/app/api/export/schedule-excel/route";
import * as aiConfirmRoute from "../src/app/api/ai-confirm/route";
import { startDelivery, finishDelivery, markMonthsRevised, getMonthStatus } from "../src/lib/monthStatus";
import { orderSelfFirst } from "../src/lib/monthStatusShared";

const MONTH = "2026-10";
const SESS = {
  employee: { user: { email: "emp1@example.com", role: "EMPLOYEE", employeeId: "e1" } },
  inc: { user: { email: "inc@example.com", role: "INC", employeeId: null } },
  admin: { user: { email: "admin@example.com", role: "ADMIN", employeeId: null } },
} as const;

async function call(handler: (r: NextRequest) => Promise<Response>, url: string, as: keyof typeof SESS | null, init?: { method?: string; body?: unknown }) {
  session.current = as ? (SESS[as] as Sess) : null;
  const r = new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const res = await handler(r);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* バイナリ(Excel)など */ }
  return { status: res.status, json, text };
}

async function seed() {
  const T = (fake as any).__tables;
  for (const k of Object.keys(T)) T[k].length = 0;
  await fake.shiftType.create({ data: { id: "st1", code: "E", name: "早番", defaultStartTime: "08:00", defaultEndTime: "17:00", spansMidnight: false } });
  await fake.employee.create({ data: { id: "e1", fullName: "佐藤 花子", contactEmail: "emp1@example.com", note: "秘密のメモ", baseStartTime: "08:00", baseEndTime: "17:00" } });
  await fake.employee.create({ data: { id: "e2", fullName: "鈴木 一郎", contactEmail: "emp2@example.com", note: "個人メモ2" } });
  await fake.employee.create({ data: { id: "e3", fullName: "高橋 三郎", contactEmail: null } });
  for (const [emp, day] of [["e1", 1], ["e2", 1], ["e3", 1], ["e1", 2], ["e2", 3]] as const) {
    await fake.monthRoster.create({ data: { employeeId: emp, workDate: new Date(Date.UTC(2026, 9, day)), status: "WORK", shiftTypeId: "st1" } });
  }
  sentMails.length = 0;
  delete process.env.MAIL_ALLOWLIST;
  process.env.MAIL_MODE = "dry-run";
}

const results: { account: string; scenario: string; ok: boolean }[] = [];
async function t(account: string, scenario: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ account, scenario, ok: true }); console.log(`ok - [${account}] ${scenario}`); }
  catch (e) { results.push({ account, scenario, ok: false }); console.error(`NG - [${account}] ${scenario}\n`, e); process.exitCode = 1; }
}

async function main() {
  // ===== (a) 配信前: 従業員には「調整中」だけ、シフト内容は一切返らない =====
  await seed();
  await t("従業員", "配信前: 勤務表APIは調整中のみ。従業員一覧・シフトとも空", async () => {
    const r = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
    assert.equal(r.status, 200);
    assert.equal(r.json.monthStatus.status, "ADJUSTING");
    assert.deepEqual(r.json.employees, []);
    assert.deepEqual(r.json.entries, []);
    assert.ok(!r.text.includes("佐藤") && !r.text.includes("鈴木") && !r.text.includes("emp2@example.com"));
    assert.equal(r.json.monthStatus.lastDelivery, undefined, "配信結果など内部情報は従業員に返さない");
  });
  await t("従業員", "配信前: 日別スケジュール(/api/schedule)・Excel出力からも取得できない", async () => {
    const s = await call(scheduleRoute.GET, `/api/schedule?date=2026-10-01`, "employee");
    assert.equal(s.status, 200);
    assert.deepEqual(s.json.rosterItems, []);
    assert.equal(s.json.monthStatus, "ADJUSTING");
    assert.equal((await call(rosterExcel.GET, `/api/export/roster-excel?month=${MONTH}`, "employee")).status, 403);
    assert.equal((await call(scheduleExcel.GET, `/api/export/schedule-excel?date=2026-10-01`, "employee")).status, 403);
  });
  await t("従業員", "月の状態API: 調整中を返す（シフトは含まない）", async () => {
    const r = await call(statusRoute.GET, `/api/roster/month-status?month=${MONTH}`, "employee");
    assert.equal(r.json.status, "ADJUSTING");
    assert.equal(r.json.needsRedelivery, false);
    assert.equal((await call(statusRoute.GET, `/api/roster/month-status?month=bad`, "employee")).status, 400);
    assert.equal((await call(statusRoute.GET, `/api/roster/month-status?month=${MONTH}`, null)).status, 401);
  });
  for (const who of ["inc", "admin"] as const) {
    await t(who === "inc" ? "INC" : "管理者", "配信前: 全員分のシフトと状態(調整中)を取得できる", async () => {
      const r = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, who);
      assert.equal(r.json.employees.length, 3);
      assert.equal(r.json.entries.length, 5);
      assert.equal(r.json.monthStatus.status, "ADJUSTING");
      assert.ok(r.json.employees.some((e: any) => e.contactEmail === "emp1@example.com"), "管理者側は従来どおり詳細を取得できる");
    });
  }

  // ===== (d) 従業員は編集できない（API） =====
  await t("従業員", "編集不可: シフト更新・メール配信・配信プレビュー・AI確定がすべて403", async () => {
    const before = JSON.stringify((fake as any).__tables.monthRoster);
    const w = await call(rosterRoute.POST, `/api/roster`, "employee", { method: "POST", body: { employeeId: "e2", workDate: "2026-10-01", status: "OFF" } });
    assert.equal(w.status, 403);
    const own = await call(rosterRoute.POST, `/api/roster`, "employee", { method: "POST", body: { employeeId: "e1", workDate: "2026-10-01", status: "OFF" } });
    assert.equal(own.status, 403, "自分の分も編集不可");
    assert.equal((await call(confirmRoute.POST, `/api/roster/confirm-month`, "employee", { method: "POST", body: { month: MONTH } })).status, 403);
    assert.equal((await call(confirmRoute.GET, `/api/roster/confirm-month?month=${MONTH}`, "employee")).status, 403);
    assert.equal((await call(aiConfirmRoute.POST, `/api/ai-confirm`, "employee", { method: "POST", body: { employeeName: "鈴木 一郎", date: "2026-10-01", newStatus: "OFF" } })).status, 403);
    assert.equal(JSON.stringify((fake as any).__tables.monthRoster), before, "DBは変更されていない");
    assert.equal(await getMonthStatus(MONTH), "ADJUSTING");
    assert.equal((await call(rosterRoute.POST, `/api/roster`, null, { method: "POST", body: { employeeId: "e1", workDate: "2026-10-01", status: "OFF" } })).status, 401);
  });

  // ===== ASK②: 配信対象とプレビュー（メールは送らない） =====
  await t("INC", "ASK②: 配信前の確認(GET)でプレビューと宛先一覧を取得。メールは送信されない", async () => {
    const r = await call(confirmRoute.GET, `/api/roster/confirm-month?month=${MONTH}`, "inc");
    assert.equal(r.status, 200);
    assert.equal(r.json.monthStatus.status, "ADJUSTING");
    assert.equal(r.json.recipients.length, 3);
    assert.deepEqual(r.json.recipients.map((x: any) => x.status).sort(), ["NO_EMAIL", "UNSENT", "UNSENT"]);
    assert.match(r.json.preview.subject, /2026年10月 の勤務シフトが確定しました/);
    assert.equal(sentMails.length, 0);
  });

  // ===== メール失敗 → 確定にしない / 一部失敗の再送 =====
  await t("INC", "メール送信が失敗したら確定にしない（調整中のまま・従業員にも見せない）", async () => {
    process.env.MAIL_MODE = "live";
    process.env.GMAIL_USER = "stub@example.com";
    process.env.GMAIL_APP_PASSWORD = "stub";
    process.env.MAIL_ALLOWLIST = "emp1@example.com"; // emp2 は許可リスト外 = 送信失敗になる
    const r = await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH } });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmed, false);
    assert.equal(r.json.reason, "SEND_FAILED");
    assert.equal(r.json.sent, 1);
    assert.equal(r.json.failed, 1);
    assert.equal(r.json.status, "ADJUSTING");
    assert.equal(sentMails.length, 1);
    const st = Object.fromEntries(r.json.recipients.map((x: any) => [x.employeeId, x.status]));
    assert.deepEqual(st, { e1: "SENT", e2: "FAILED", e3: "NO_EMAIL" });
    const emp = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
    assert.equal(emp.json.monthStatus.status, "ADJUSTING");
    assert.deepEqual(emp.json.entries, []);
  });
  await t("INC", "失敗した宛先だけ再送できる（送信済みの人へ二重送信しない）→ 全員成功で確定", async () => {
    process.env.MAIL_ALLOWLIST = "emp1@example.com,emp2@example.com";
    const r = await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH } });
    assert.equal(r.json.confirmed, true);
    assert.equal(r.json.status, "CONFIRMED");
    assert.equal(r.json.sent, 1, "今回送ったのはemp2のみ");
    assert.equal(r.json.alreadySent, 1);
    assert.deepEqual(sentMails.map((m) => m.to), ["emp1@example.com", "emp2@example.com"]);
  });

  // ===== (b) 配信後: 全員分の確定シフト（閲覧のみ・個人情報なし） =====
  await t("従業員", "配信後: 全従業員分の1か月分の確定シフトが取得できる（個人情報は含まない）", async () => {
    const r = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
    assert.equal(r.json.monthStatus.status, "CONFIRMED");
    assert.equal(r.json.employees.length, 3);
    assert.equal(r.json.entries.length, 5);
    for (const e of r.json.employees) {
      assert.deepEqual(Object.keys(e).sort(), ["baseEndTime", "baseStartTime", "fullName", "id", "isActive", "role"]);
    }
    assert.ok(!r.text.includes("emp1@example.com") && !r.text.includes("秘密のメモ") && !r.text.includes("個人メモ2"));
    for (const en of r.json.entries) assert.ok(!("createdBy" in en) && !("updatedBy" in en));
    assert.equal(r.json.selfEmployeeId, "e1");
    const s = await call(scheduleRoute.GET, `/api/schedule?date=2026-10-01`, "employee");
    assert.equal(s.json.rosterItems.length, 3, "確定後は日別スケジュールも取得可");
    assert.equal((await call(rosterExcel.GET, `/api/export/roster-excel?month=${MONTH}`, "employee")).status, 200);
  });
  await t("従業員", "本人の行を一番上に並べる（他は氏名順のまま）", async () => {
    const r = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
    const apiOrder = r.json.employees.map((e: any) => e.id);
    assert.equal(apiOrder.length, 3);
    const ordered = orderSelfFirst(r.json.employees, "e2").map((e: any) => e.id);
    assert.equal(ordered[0], "e2");
    assert.deepEqual(ordered.slice(1), apiOrder.filter((id: string) => id !== "e2"));
    assert.deepEqual(orderSelfFirst([{ id: "a" }, { id: "b" }], null).map((x) => x.id), ["a", "b"]);
  });
  await t("従業員", "確定後も編集不可（API）", async () => {
    const w = await call(rosterRoute.POST, `/api/roster`, "employee", { method: "POST", body: { employeeId: "e2", workDate: "2026-10-01", status: "OFF" } });
    assert.equal(w.status, 403);
    assert.equal(await getMonthStatus(MONTH), "CONFIRMED");
  });
  await t("INC", "月の状態API: 確定(確定日時あり)・配信結果を含む", async () => {
    const r = await call(statusRoute.GET, `/api/roster/month-status?month=${MONTH}`, "inc");
    assert.equal(r.json.status, "CONFIRMED");
    assert.ok(r.json.confirmedAt);
    assert.equal(r.json.lastDelivery.sent, 2);
  });

  // ===== (c) 確定後の修正 → 調整中、再配信 → 確定 =====
  for (const who of ["inc", "admin"] as const) {
    await t(who === "inc" ? "INC" : "管理者", "確定後にシフト修正 → 調整中に戻る → 再配信で再び確定", async () => {
      const edit = await call(rosterRoute.POST, `/api/roster`, who, { method: "POST", body: { employeeId: "e2", workDate: "2026-10-03", status: "OFF" } });
      assert.equal(edit.status, 200);
      assert.deepEqual(edit.json.revertedMonths, [MONTH]);
      const st = await call(statusRoute.GET, `/api/roster/month-status?month=${MONTH}`, who);
      assert.equal(st.json.status, "ADJUSTING");
      assert.equal(st.json.needsRedelivery, true);
      // 従業員からは再び見えない
      const emp = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
      assert.equal(emp.json.monthStatus.status, "ADJUSTING");
      assert.equal(emp.json.monthStatus.needsRedelivery, true);
      assert.deepEqual(emp.json.entries, []);
      assert.equal((await call(rosterExcel.GET, `/api/export/roster-excel?month=${MONTH}`, "employee")).status, 403);
      // 配信対象は全員「未送信」に戻る
      const pre = await call(confirmRoute.GET, `/api/roster/confirm-month?month=${MONTH}`, who);
      assert.deepEqual(pre.json.recipients.map((x: any) => x.status).sort(), ["NO_EMAIL", "UNSENT", "UNSENT"]);
      // 再配信（dry-run: 実送信しない）
      process.env.MAIL_MODE = "dry-run";
      const before = sentMails.length;
      const re = await call(confirmRoute.POST, `/api/roster/confirm-month`, who, { method: "POST", body: { month: MONTH } });
      assert.equal(re.json.confirmed, true);
      assert.equal(re.json.mode, "dry-run");
      assert.equal(sentMails.length, before, "dry-run では nodemailer を呼ばない");
      const st2 = await call(statusRoute.GET, `/api/roster/month-status?month=${MONTH}`, who);
      assert.equal(st2.json.status, "CONFIRMED");
      assert.equal(st2.json.needsRedelivery, false);
      const emp2 = await call(rosterRoute.GET, `/api/roster?month=${MONTH}`, "employee");
      assert.equal(emp2.json.monthStatus.status, "CONFIRMED");
      assert.equal(emp2.json.entries.find((e: any) => e.employeeId === "e2" && e.workDate.startsWith("2026-10-03")).status, "OFF", "修正内容が反映されている");
      // 次のループ用に元へ戻す
      await call(rosterRoute.POST, `/api/roster`, who, { method: "POST", body: { employeeId: "e2", workDate: "2026-10-03", status: "WORK" } });
      await call(confirmRoute.POST, `/api/roster/confirm-month`, who, { method: "POST", body: { month: MONTH } });
    });
  }
  await t("INC", "他の更新経路（AI確定）でも確定後の修正は調整中に戻る／他の月には影響しない", async () => {
    assert.equal(await getMonthStatus(MONTH), "CONFIRMED");
    const other = await call(rosterRoute.POST, `/api/roster`, "inc", { method: "POST", body: { employeeId: "e1", workDate: "2026-11-05", status: "WORK" } });
    assert.deepEqual(other.json.revertedMonths, []);
    assert.equal(await getMonthStatus(MONTH), "CONFIRMED", "別の月の修正は影響しない");
    assert.equal(await getMonthStatus("2026-11"), "ADJUSTING");
    assert.equal((fake as any).__tables.monthRosterConfirmation.filter((x: any) => x.month === "2026-11").length, 0, "未配信の月に行は作られない");
    const ai = await call(aiConfirmRoute.POST, `/api/ai-confirm`, "inc", { method: "POST", body: { employeeName: "鈴木 一郎", date: "2026-10-01", newStatus: "PAID_LEAVE" } });
    assert.equal(ai.status, 200);
    assert.equal(await getMonthStatus(MONTH), "ADJUSTING");
    await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH } });
    assert.equal(await getMonthStatus(MONTH), "CONFIRMED");
  });

  // ===== 境界ケース =====
  await t("INC", "配信対象(メール登録済み)が0人なら確定にしない", async () => {
    await seed();
    for (const e of (fake as any).__tables.employee) e.contactEmail = null;
    const r = await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH } });
    assert.equal(r.json.confirmed, false);
    assert.equal(r.json.reason, "NO_RECIPIENTS");
    assert.equal(await getMonthStatus(MONTH), "ADJUSTING");
  });
  await t("INC", "送信対象を絞って一部だけ送った場合は、未送信が残る間は確定にしない", async () => {
    await seed();
    const r = await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH, employeeIds: ["e1"] } });
    assert.equal(r.json.confirmed, false);
    assert.equal(r.json.reason, "NOT_ALL_SENT");
    const r2 = await call(confirmRoute.POST, `/api/roster/confirm-month`, "inc", { method: "POST", body: { month: MONTH, employeeIds: ["e2"] } });
    assert.equal(r2.json.confirmed, true, "残りを送れば確定");
  });
  await t("INC", "配信中にシフトが修正された場合は確定にしない", async () => {
    await seed();
    await finishDelivery({ month: MONTH, startRevision: 0, mode: "dry-run", sentEmployeeIds: [], failures: [], skippedNoEmail: [], targetCount: 2 });
    const start = await startDelivery(MONTH, false);
    await markMonthsRevised([MONTH], "inc@example.com"); // 配信中に別の人が修正
    const out = await finishDelivery({ month: MONTH, startRevision: start.revision, mode: "dry-run", sentEmployeeIds: ["e1", "e2"], failures: [], skippedNoEmail: [], targetCount: 2 });
    assert.equal(out.confirmed, false);
    assert.equal(out.reason, "REVISED_DURING_DELIVERY");
  });
  await t("INC", "既存データとの互換: statusが未設定だった旧データ(確定済み)は確定として扱う／不正な月は400", async () => {
    await seed();
    await fake.monthRosterConfirmation.create({ data: { month: "2026-09", confirmedAt: new Date() } }); // 旧形式: status省略 → 既定値CONFIRMED
    assert.equal(await getMonthStatus("2026-09"), "CONFIRMED");
    assert.equal((await call(rosterRoute.GET, `/api/roster?month=2026-9`, "inc")).status, 400);
    assert.equal((await call(rosterRoute.GET, `/api/roster`, "inc")).status, 400);
  });

  // ---- 結果
  const ng = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} passed`);
  console.log("RESULTS_JSON=" + JSON.stringify(results));
  if (ng > 0) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
