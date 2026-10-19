// 実行: npx tsx tests/ui-structure.test.ts
// 画面構成の変更（ホームのメニュー・旧URLのリダイレクト）と、アカウント設定の氏名同期・権限を確認する。
import assert from "node:assert/strict";
import { fake, session, type Sess } from "./helpers/setup";
import { NextRequest } from "next/server";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as any).React = React; // tsx は classic JSX のため、サーバーコンポーネントの描画に必要
import ExcelJS from "exceljs";
import DashboardPage from "../src/app/dashboard/page";
import EmployeesRedirect from "../src/app/employees/page";
import ShiftSettingsRedirect from "../src/app/shift-settings/page";
import * as employeesRoute from "../src/app/api/employees/route";
import * as employeeIdRoute from "../src/app/api/employees/[id]/route";
import * as usersRoute from "../src/app/api/users/route";
import * as userIdRoute from "../src/app/api/users/[id]/route";
import * as rosterExcel from "../src/app/api/export/roster-excel/route";
import * as shiftTypesRoute from "../src/app/api/shift-types/route";
import * as cartRoute from "../src/app/api/cart-positions/route";

const SESS = {
  admin: { user: { id: "u-admin", email: "admin@example.com", name: "管理者", role: "ADMIN", employeeId: null } },
  inc: { user: { id: "u-inc", email: "inc@example.com", name: "INC", role: "INC", employeeId: null } },
  emp: { user: { id: "u-emp", email: "emp1@example.com", name: "佐藤 花子", role: "EMPLOYEE", employeeId: "e1" } },
} as const;
type Who = keyof typeof SESS;

async function call(handler: (r: NextRequest, c: any) => Promise<Response>, url: string, as: Who | null, init?: { method?: string; body?: unknown }, params: any = {}) {
  session.current = as ? (SESS[as] as unknown as Sess) : null;
  const r = new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const res = await handler(r, { params });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* */ }
  return { status: res.status, json, buf };
}

async function seed() {
  const T = (fake as any).__tables;
  for (const k of Object.keys(T)) T[k].length = 0;
  await fake.shiftType.create({ data: { id: "s1", code: "S1", name: "第1", defaultStartTime: "08:00", defaultEndTime: "17:00", spansMidnight: false, requiredCount: 1 } });
  await fake.employee.create({ data: { id: "e1", fullName: "佐藤 花子", contactEmail: "emp1@example.com", role: "PARTTIME" } });
  await fake.employee.create({ data: { id: "e2", fullName: "鈴木 一郎", contactEmail: null, role: "STAFF" } });
  await fake.user.create({ data: { id: "u-admin", email: "admin@example.com", name: "管理者", passwordHash: "x", role: "ADMIN", employeeId: null } });
  await fake.user.create({ data: { id: "u-inc", email: "inc@example.com", name: "INC", passwordHash: "x", role: "INC", employeeId: null } });
  await fake.user.create({ data: { id: "u-emp", email: "emp1@example.com", name: "旧表示名", passwordHash: "x", role: "EMPLOYEE", employeeId: "e1" } });
  await fake.monthRoster.create({ data: { employeeId: "e1", workDate: new Date(Date.UTC(2026, 9, 1)), status: "WORK", shiftTypeId: "s1" } });
}

async function home(who: Who) {
  session.current = SESS[who] as unknown as Sess;
  const html = renderToStaticMarkup((await DashboardPage()) as any);
  return html;
}
async function redirectTarget(fn: () => unknown): Promise<string> {
  try { fn(); } catch (e: any) { const m = String(e?.digest ?? ""); return m.split(";")[2] ?? m; }
  return "";
}

let n = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await seed(); await fn(); n++; console.log("ok -", name); } catch (e) { failed++; console.error("NG -", name, "\n", e); }
}

async function main() {
  await t("ホーム(INC): 名称・配置が新構成。ASK①②・人数設定・業務管理・従業員管理・アカウント管理は出ない。説明文なし", async () => {
    const h = await home("inc");
    for (const w of ["シフト作成", "勤務表", "勤務希望確認", "アサイン表", "各種設定", "スケジュール設定", "アカウント設定", "パスワード変更"]) assert.ok(h.includes(w), `${w} が必要`);
    for (const w of ["ASK①", "ASK②", "人数設定", "業務管理", "従業員管理", "アカウント管理", "勤務時間設定"]) assert.ok(!h.includes(w), `${w} は出ない`);
    assert.ok(h.includes('href="/shift-requests"'), "勤務希望確認は既存の勤務希望一覧へ");
    assert.ok(h.indexOf("勤務表") < h.indexOf("勤務希望確認") && h.indexOf("勤務希望確認") < h.indexOf("アサイン表"), "シフト作成内の並び");
    assert.ok(h.includes('href="/tasks"') && h.includes('href="/users"') && h.includes('href="/account/password"'));
    assert.ok(!h.includes("home-tile__desc"), "ボタン下の説明文は削除");
    assert.ok(h.includes("<svg"), "アイコン付き");
  });
  await t("ホーム(ADMIN): INCと同じ構成。ホーム(従業員): 勤務表・アサイン表・勤務希望登録・パスワード変更のみ", async () => {
    const a = await home("admin");
    assert.ok(a.includes("アカウント設定") && a.includes("スケジュール設定"));
    const e = await home("emp");
    for (const w of ["勤務表", "アサイン表", "勤務希望登録", "パスワード変更"]) assert.ok(e.includes(w));
    for (const w of ["スケジュール設定", "アカウント設定", "各種設定", "勤務希望確認", "ASK"]) assert.ok(!e.includes(w), `${w} は従業員に出ない`);
    assert.ok(e.includes("ようこそ、佐藤 花子 さん"), "表示名は従業員情報の氏名");
  });
  await t("旧URLのリダイレクト: /employees→/users、/shift-settings→/tasks?tab=hours", async () => {
    assert.equal(await redirectTarget(() => EmployeesRedirect()), "/users");
    assert.equal(await redirectTarget(() => ShiftSettingsRedirect()), "/tasks?tab=hours");
  });
  await t("氏名の同期: 従業員の氏名変更 → 紐付けアカウントの表示名・勤務表Excelに反映", async () => {
    const r = await call(employeeIdRoute.PATCH, "/api/employees/e1", "inc", { method: "PATCH", body: { fullName: "佐藤 はな" } }, { id: "e1" });
    assert.equal(r.status, 200);
    assert.equal((await fake.user.findUnique({ where: { id: "u-emp" } })).name, "佐藤 はな");
    assert.equal((await fake.user.findUnique({ where: { id: "u-inc" } })).name, "INC", "紐付けのないアカウントは変わらない");
    const x = await call(rosterExcel.GET, "/api/export/roster-excel?month=2026-10", "inc");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf as any);
    const names: string[] = []; wb.worksheets[0].eachRow((row) => names.push(String(row.getCell(1).value ?? "")));
    assert.ok(names.includes("佐藤 はな") && !names.includes("佐藤 花子"), "Excelも新しい氏名");
    const h = await home("emp");
    assert.ok(h.includes("佐藤 はな"));
  });
  await t("アカウント作成: 従業員に紐付けると表示名は従業員の氏名。紐付けなしは表示名が必須。重複メールは409", async () => {
    const ok = await call(usersRoute.POST, "/api/users", "admin", { method: "POST", body: { email: "new@example.com", password: "secret1", role: "EMPLOYEE", employeeId: "e2" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.name, "鈴木 一郎");
    assert.equal((await call(usersRoute.POST, "/api/users", "admin", { method: "POST", body: { email: "x@example.com", password: "secret1", role: "INC" } })).status, 400);
    assert.equal((await call(usersRoute.POST, "/api/users", "admin", { method: "POST", body: { email: "new@example.com", password: "secret1", role: "EMPLOYEE", name: "x" } })).status, 409);
    // 既に別アカウントに紐付いた従業員は不可
    assert.equal((await call(usersRoute.POST, "/api/users", "admin", { method: "POST", body: { email: "dup@example.com", password: "secret1", employeeId: "e1" } })).status, 409);
  });
  await t("紐付け済みアカウントの表示名を直接変更しても従業員の氏名が正（無視）。紐付け変更時は同期", async () => {
    const r = await call(userIdRoute.PATCH, "/api/users/u-emp", "admin", { method: "PATCH", body: { name: "勝手な名前" } }, { id: "u-emp" });
    assert.equal(r.status, 200);
    assert.equal(r.json.name, "佐藤 花子");
    const r2 = await call(userIdRoute.PATCH, "/api/users/u-inc", "admin", { method: "PATCH", body: { employeeId: "e2" } }, { id: "u-inc" });
    assert.equal(r2.json.name, "鈴木 一郎");
    const r3 = await call(userIdRoute.PATCH, "/api/users/u-inc", "admin", { method: "PATCH", body: { employeeId: null, name: "INC 太郎" } }, { id: "u-inc" });
    assert.equal(r3.json.name, "INC 太郎", "紐付けなしのアカウントは表示名が正");
  });
  await t("権限: アカウント(User)API=ADMINのみ、従業員API=ADMIN/INCのみ、従業員アカウントは両方不可", async () => {
    assert.equal((await call(usersRoute.GET, "/api/users", "admin")).status, 200);
    assert.equal((await call(usersRoute.GET, "/api/users", "inc")).status, 403);
    assert.equal((await call(usersRoute.GET, "/api/users", "emp")).status, 403);
    assert.equal((await call(usersRoute.GET, "/api/users", null)).status, 401);
    assert.equal((await call(employeesRoute.GET, "/api/employees", "inc")).status, 200);
    assert.equal((await call(employeesRoute.GET, "/api/employees", "emp")).status, 403);
    assert.equal((await call(employeesRoute.POST, "/api/employees", "emp", { method: "POST", body: { fullName: "x" } })).status, 403);
    assert.equal((await call(usersRoute.POST, "/api/users", "inc", { method: "POST", body: { email: "a@b.co", password: "secret1", name: "x" } })).status, 403);
    const list = await call(usersRoute.GET, "/api/users", "admin");
    assert.ok(list.json.some((u: any) => u.email === "emp1@example.com" && u.employee?.fullName === "佐藤 花子"), "従業員と紐付けて一覧できる");
  });
  await t("従業員の追加: アカウントなしでも作成でき一覧に出る。削除でアカウントの紐付けのみ解除（アカウントは残る）", async () => {
    const c = await call(employeesRoute.POST, "/api/employees", "inc", { method: "POST", body: { fullName: "新人 太郎", role: "PARTTIME", baseStartTime: "09:00", baseEndTime: "18:00" } });
    assert.equal(c.status, 201);
    const list = await call(employeesRoute.GET, "/api/employees", "inc");
    assert.ok(list.json.some((e: any) => e.fullName === "新人 太郎"));
    const d = await call(employeeIdRoute.DELETE, "/api/employees/e1", "inc", { method: "DELETE" }, { id: "e1" });
    assert.equal(d.status, 200);
    const u = await fake.user.findUnique({ where: { id: "u-emp" } });
    assert.ok(u && u.employeeId === null, "アカウントは残り紐付けのみ解除");
  });
  await t("勤務時間設定・スケジュール設定のAPI（保存先）は従来どおり利用できる", async () => {
    assert.equal((await call(shiftTypesRoute.GET, "/api/shift-types", "inc")).status, 200);
    assert.equal((await call(cartRoute.GET, "/api/cart-positions", "inc")).status, 200);
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
