// 実行: npx tsx tests/logic.test.ts （DB不要。純粋ロジックのテスト）
import assert from "node:assert/strict";
import { requestMeetsSlot, requestInsideSlot, clampToSlot } from "../src/lib/claimRules";
import { planFairAssignments, weekStartKey, type PlanClaim, type PlanInput } from "../src/lib/fairAssignment";
import { ruleBreakMinutes, grossMinutesOf, netMinutesOf } from "../src/lib/workedHours";
import { needsMailSend } from "../src/lib/shortageMail";
import { isManagerRole } from "../src/lib/roles";
import { countRequestedByShift, countConfirmedByShift, summarizeSlot, slotKey } from "../src/lib/shiftHeadcount";
import { isSelfCanceledBeforeConfirm, countsAsRequested } from "../src/lib/claimStatus";
import { todayJst, nextMonthJst } from "../src/lib/jst";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

// ---- 権限
t("ADMIN/INCは管理者権限、EMPLOYEEは不可", () => {
  assert.equal(isManagerRole("ADMIN"), true);
  assert.equal(isManagerRole("INC"), true);
  assert.equal(isManagerRole("EMPLOYEE"), false);
  assert.equal(isManagerRole(undefined), false);
});

// ---- JST
t("JST: UTC 15:00 は翌日、12月の翌月は1月", () => {
  assert.equal(todayJst(new Date("2026-10-09T15:00:00Z")), "2026-10-10");
  assert.equal(nextMonthJst(new Date("2026-12-31T20:00:00Z")), "2027-02"); // JSTでは2027-01-01 → 翌月は2月
  assert.equal(nextMonthJst(new Date("2026-12-15T00:00:00Z")), "2027-01");
});

// ---- 休憩控除
t("休憩: 9時間日勤=60分、22:00開始=120分、6時間=0分、実労働は差し引き", () => {
  assert.equal(ruleBreakMinutes("08:00", "17:00", "早番"), 60);
  assert.equal(ruleBreakMinutes("22:00", "08:00", "明番"), 120);
  assert.equal(ruleBreakMinutes("08:00", "14:00"), 0);
  assert.equal(netMinutesOf(grossMinutesOf("08:00", "17:00"), 60), 480);
  assert.equal(netMinutesOf(grossMinutesOf("22:00", "08:00"), 120), 480);
});

// ---- 募集枠の条件
t("条件: 8-17枠は8:00〜14:00でOK、9:00開始はNG", () => {
  const s = { start: "08:00", end: "17:00" };
  assert.equal(requestMeetsSlot(s, { start: "08:00", end: "14:00" }).ok, true);
  assert.equal(requestMeetsSlot(s, { start: "08:00", end: "17:00" }).ok, true);
  assert.equal(requestMeetsSlot(s, { start: "09:00", end: "17:00" }).ok, false);
  assert.equal(requestMeetsSlot(s, { start: null, end: null }).ok, true);
});
t("条件: 13-22枠は16:00〜22:00でOK、16:00〜20:00はNG", () => {
  const s = { start: "13:00", end: "22:00" };
  assert.equal(requestMeetsSlot(s, { start: "16:00", end: "22:00" }).ok, true);
  assert.equal(requestMeetsSlot(s, { start: "16:00", end: "20:00" }).ok, false);
});
t("条件: ルールのない枠(16-22)は全時間が必要、日跨ぎ枠も判定できる", () => {
  assert.equal(requestMeetsSlot({ start: "16:00", end: "22:00" }, { start: "17:00", end: "22:00" }).ok, false);
  assert.equal(requestMeetsSlot({ start: "22:00", end: "08:00" }, { start: "22:00", end: "08:00" }).ok, true);
  assert.equal(requestMeetsSlot({ start: "22:00", end: "08:00" }, { start: "23:00", end: "08:00" }).ok, false);
});
t("枠内チェックと勤務表へ書く時間の切り出し", () => {
  const s = { start: "13:00", end: "22:00" };
  assert.equal(requestInsideSlot(s, { start: "16:00", end: "22:00" }), true);
  assert.equal(requestInsideSlot(s, { start: "12:00", end: "22:00" }), false);
  assert.deepEqual(clampToSlot(s, { start: "16:00", end: "22:00" }), { start: "16:00", end: "22:00" });
  assert.equal(clampToSlot(s, { start: "13:00", end: "22:00" }), null);
});

// ---- メール再送判定
t("メール: 未送信/失敗は送る、liveで成功済みは送らない、dry-run成功分はlive切替後に送る", () => {
  const now = new Date();
  assert.equal(needsMailSend(null, "live"), true);
  assert.equal(needsMailSend({ status: "FAILED", mode: "live", updatedAt: now }, "live"), true);
  assert.equal(needsMailSend({ status: "SENT", mode: "live", updatedAt: now }, "live"), false);
  assert.equal(needsMailSend({ status: "SENT", mode: "dry-run", updatedAt: now }, "dry-run"), false);
  assert.equal(needsMailSend({ status: "SENT", mode: "dry-run", updatedAt: now }, "live"), true);
  assert.equal(needsMailSend({ status: "SENDING", mode: null, updatedAt: now }, "live"), false);
  assert.equal(needsMailSend({ status: "SENDING", mode: null, updatedAt: new Date(now.getTime() - 11 * 60000) }, "live"), true);
});

// ---- 公平な割り当て
const defs = {
  E: { shiftTypeId: "E", label: "08:00〜17:00", start: "08:00", end: "17:00", netMinutes: 480 },
  L: { shiftTypeId: "L", label: "13:00〜22:00", start: "13:00", end: "22:00", netMinutes: 480 },
};
const claim = (id: string, emp: string, date: string, shift: "E" | "L", o: Partial<PlanClaim> = {}): PlanClaim => ({
  id, employeeId: emp, employeeName: emp, role: "PARTTIME", priorityOrder: 0, isActive: true,
  date, shiftTypeId: shift, requestedStartTime: null, requestedEndTime: null, ...o,
});
const base = (o: Partial<PlanInput>): PlanInput => ({
  claims: [], slotDefs: defs, shortageByKey: {}, busyKeys: new Set(), baseMinutes: {}, baseDays: {}, existingWeeklyHours: {}, ...o,
});

t("公平: 合計時間が少ない人を優先し、必要人数を超えない", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E"), claim("c2", "B", "2026-11-02", "E"), claim("c3", "C", "2026-11-02", "E")],
    shortageByKey: { "2026-11-02|E": 1 },
    baseMinutes: { A: 3000, B: 600, C: 1800 },
  }));
  assert.deepEqual(plan.assignments.map((a) => a.employeeId), ["B"]);
  assert.deepEqual(plan.notSelected.map((x) => x.claimId).sort(), ["c1", "c3"]);
});
t("公平: 時間が同じなら優先順位（小さい方）、それも同じならID順", () => {
  const p1 = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E", { priorityOrder: 5 }), claim("c2", "B", "2026-11-02", "E", { priorityOrder: 2 })],
    shortageByKey: { "2026-11-02|E": 1 },
  }));
  assert.equal(p1.assignments[0].employeeId, "B");
  const p2 = planFairAssignments(base({
    claims: [claim("c1", "B", "2026-11-02", "E"), claim("c2", "A", "2026-11-02", "E")],
    shortageByKey: { "2026-11-02|E": 1 },
  }));
  assert.equal(p2.assignments[0].employeeId, "A");
});
t("公平: 1枠ごとに合計を更新し、後の日は別の人に回る（日付順）", () => {
  const plan = planFairAssignments(base({
    claims: [
      claim("c1", "A", "2026-11-02", "E"), claim("c2", "B", "2026-11-02", "E"),
      claim("c3", "A", "2026-11-03", "E"), claim("c4", "B", "2026-11-03", "E"),
    ],
    shortageByKey: { "2026-11-02|E": 1, "2026-11-03|E": 1 },
  }));
  assert.deepEqual(plan.assignments.map((a) => `${a.date}:${a.employeeId}`), ["2026-11-02:A", "2026-11-03:B"]);
  assert.equal(plan.totals.find((x) => x.employeeId === "A")!.totalMinutes, 480);
});
t("同じ従業員を同じ日に複数枠へ確定しない（既存勤務がある日は保留）", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E")],
    shortageByKey: { "2026-11-02|E": 1 },
    busyKeys: new Set(["A|2026-11-02"]),
  }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.held.length, 1);
  assert.equal(plan.unfilled.length, 1);
});
t("希望時間が条件を満たさない応募は自動確定せず保留（枠は未確定のまま）", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E", { requestedStartTime: "10:00", requestedEndTime: "17:00" })],
    shortageByKey: { "2026-11-02|E": 1 },
  }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.held[0].claimId, "c1");
  assert.equal(plan.unfilled[0].shortage, 1);
});
t("必要人数に満たない枠は不足を維持し、応募者全員を確定", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E")],
    shortageByKey: { "2026-11-02|E": 3 },
  }));
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.unfilled[0].shortage, 2);
});
t("既に満員の枠（不足0）の応募は不採用、追加確定しない", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-02", "E")],
    shortageByKey: {},
  }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.notSelected.length, 1);
});
t("バイトの週20時間上限を超える応募は確定しない", () => {
  const plan = planFairAssignments(base({
    claims: [claim("c1", "A", "2026-11-04", "E")], // 9時間
    shortageByKey: { "2026-11-04|E": 1 },
    existingWeeklyHours: { [`A|${weekStartKey("2026-11-04")}`]: 12 },
  }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.held.length, 1);
});
t("同じ入力なら毎回同じ結果（signature一致）", () => {
  const input = base({
    claims: [claim("c1", "A", "2026-11-02", "E"), claim("c2", "B", "2026-11-02", "E")],
    shortageByKey: { "2026-11-02|E": 1 },
  });
  assert.equal(planFairAssignments(input).signature, planFairAssignments(input).signature);
});
t("再実行（PENDINGが無い）では何も追加されない", () => {
  const plan = planFairAssignments(base({ claims: [], shortageByKey: { "2026-11-02|E": 1 } }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.notSelected.length, 0);
});

// ---- シフト人数の集計（選択したシフト基準）
const rq = (employeeId: string, shiftTypeId: string | null, status = "PENDING", date = "2026-11-02") => ({ employeeId, date, shiftTypeId, status, cancelRequestedAt: null });
t("人数: 一部時間のみ（16:00〜22:00等）でも選択した第2シフトの1人として数える", () => {
  // 時間は集計に使わない（入力にも持たない）。シフトIDのみで数える
  const m = countRequestedByShift([rq("a", "S2"), rq("b", "S1")]);
  assert.equal(m.get(slotKey("2026-11-02", "S2")), 1);
  assert.equal(m.get(slotKey("2026-11-02", "S1")), 1);
});
t("人数: 同じ従業員・同日・同シフトは重複して数えない（別シフトは別）", () => {
  const m = countRequestedByShift([rq("a", "S1"), rq("a", "S1"), rq("a", "S2")]);
  assert.equal(m.get(slotKey("2026-11-02", "S1")), 1);
  assert.equal(m.get(slotKey("2026-11-02", "S2")), 1);
});
t("人数: キャンセル・却下・不採用・確定済は希望人数に数えない／シフト未選択も数えない", () => {
  const m = countRequestedByShift([rq("a", "S1", "CANCELED"), rq("b", "S1", "REJECTED"), rq("c", "S1", "NOT_SELECTED"), rq("d", "S1", "APPROVED"), rq("e", "S1", "INVITED"), rq("f", null)]);
  assert.equal(m.size, 0);
});
t("人数: 確定人数は WORK のみ・シフト別・重複なし", () => {
  const e = (employeeId: string, shiftTypeId: string | null, status = "WORK") => ({ employeeId, date: "2026-11-02", shiftTypeId, status });
  const m = countConfirmedByShift([e("a", "S1"), e("a", "S1"), e("b", "S1", "OFF"), e("c", "S2"), e("d", null)]);
  assert.equal(m.get(slotKey("2026-11-02", "S1")), 1);
  assert.equal(m.get(slotKey("2026-11-02", "S2")), 1);
});
t("人数: 希望と確定は別々。不足は確定基準、希望が全て確定した場合の不足も別に出す", () => {
  const s = summarizeSlot(3, 1, 1);
  assert.deepEqual(s, { required: 3, confirmed: 1, requested: 1, shortage: 2, shortageAfterRequests: 1 });
  assert.equal(summarizeSlot(2, 5, 0).shortage, 0);
});
t("キャンセル種別: 確定前の自己キャンセル（cancelRequestedAtなし）と承認済みキャンセルを区別", () => {
  assert.equal(isSelfCanceledBeforeConfirm({ status: "CANCELED", cancelRequestedAt: null }), true);
  assert.equal(isSelfCanceledBeforeConfirm({ status: "CANCELED", cancelRequestedAt: new Date() }), false);
  assert.equal(isSelfCanceledBeforeConfirm({ status: "PENDING", cancelRequestedAt: null }), false);
  assert.equal(countsAsRequested({ status: "CANCEL_REQUESTED", cancelRequestedAt: new Date() }), false);
});

console.log(`\n${n} tests passed`);
process.exit(0);
