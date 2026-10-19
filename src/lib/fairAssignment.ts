import { createHash } from "crypto";
import { requestMeetsSlot, clampToSlot, windowMinutes } from "@/lib/claimRules";

// 勤務者の一括確定: 公平な割り当て（純粋関数。DBには触れない）
//
// 処理順: 日付の昇順 → 同日はシフト開始時刻の昇順 → shiftTypeId。
// 各枠では、条件を満たす応募者を次の順で並べ、必要人数（不足人数）まで採用する。
//   ① 当月の合計実労働時間（休憩控除後・確定済み＋この処理で既に割り当てた分）が少ない人
//   ② 従業員管理の「優先順位」（数値が小さいほど優先）
//   ③ 従業員ID（固定の基準。同じ入力なら毎回同じ結果）
// 1枠採用するごとに、その従業員の合計時間を更新して次の枠へ進む。
// 加算する時間は「募集枠の勤務時間（休憩控除後）」。応募者が申請した時間の長短では変えない。

export const PARTTIME_WEEKLY_LIMIT_HOURS = 20;

export type PlanSlotDef = { shiftTypeId: string; label: string; start: string; end: string; netMinutes: number };
export type PlanClaim = {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  priorityOrder: number;
  isActive: boolean;
  date: string; // YYYY-MM-DD
  shiftTypeId: string | null;
  requestedStartTime: string | null;
  requestedEndTime: string | null;
};

export type PlanInput = {
  claims: PlanClaim[]; // 対象は status=PENDING のみ（呼び出し側で絞る）
  slotDefs: Record<string, PlanSlotDef>; // shiftTypeId → 定義
  shortageByKey: Record<string, number>; // "date|shiftTypeId" → 現在の不足人数
  busyKeys: Set<string>; // "employeeId|date" 既に出勤予定(WORK)がある
  baseMinutes: Record<string, number>; // employeeId → 当月の確定済み実労働分
  baseDays: Record<string, number>;
  existingWeeklyHours: Record<string, number>; // "employeeId|週の開始日(日曜)" → 既存の勤務時間（バイトの週20時間判定用）
};

export type PlannedAssignment = {
  claimId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  shiftTypeId: string;
  shiftLabel: string;
  override: { start: string; end: string } | null; // 月間勤務表に書く例外時間（枠と同じならnull）
  netMinutes: number;
};
export type PlanDecision = { claimId: string; employeeName: string; date: string; shiftLabel: string; reason: string };

export type SlotResult = {
  key: string;
  date: string;
  shiftTypeId: string;
  shiftLabel: string;
  need: number;
  assigned: PlannedAssignment[];
  notSelected: PlanDecision[];
  held: PlanDecision[];
  remainingShortage: number;
  applicants: number;
};

export type EmployeeTotal = {
  employeeId: string;
  employeeName: string;
  addedDays: number;
  addedMinutes: number;
  totalDays: number;
  totalMinutes: number;
};

export type Plan = {
  slots: SlotResult[];
  assignments: PlannedAssignment[];
  notSelected: PlanDecision[]; // 不採用にする応募
  held: PlanDecision[]; // PENDINGのまま残す応募（条件未達・手動確認が必要）
  unfilled: { date: string; shiftLabel: string; shortage: number; applicants: number }[];
  totals: EmployeeTotal[];
  signature: string;
};

// 案の指紋。プレビュー後に内容が変わっていないかの確認に使う
export function planSignature(assignments: PlannedAssignment[], notSelected: PlanDecision[]): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        assignments.map((a) => [a.claimId, a.employeeId, a.date, a.shiftTypeId, a.override]).sort(),
        notSelected.map((n) => n.claimId).sort(),
      ])
    )
    .digest("hex");
}

export function weekStartKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function planFairAssignments(input: PlanInput): Plan {
  const { claims, slotDefs, shortageByKey, busyKeys } = input;
  const running: Record<string, number> = { ...input.baseMinutes };
  const days: Record<string, number> = { ...input.baseDays };
  const weekly: Record<string, number> = { ...input.existingWeeklyHours };
  const assignedKeys = new Set<string>(); // "employeeId|date" この処理で割り当て済み（同日の重複防止）

  // 枠ごとに応募をまとめる
  const claimsBySlot = new Map<string, PlanClaim[]>();
  const orphan: PlanClaim[] = [];
  for (const c of claims) {
    if (!c.shiftTypeId || !slotDefs[c.shiftTypeId]) {
      orphan.push(c);
      continue;
    }
    const key = `${c.date}|${c.shiftTypeId}`;
    const list = claimsBySlot.get(key) ?? [];
    list.push(c);
    claimsBySlot.set(key, list);
  }

  // 対象の枠 = 現在不足している枠 ∪ 応募がある枠
  const keys = new Set<string>([...Object.keys(shortageByKey).filter((k) => (shortageByKey[k] ?? 0) > 0), ...claimsBySlot.keys()]);
  const ordered = [...keys]
    .filter((k) => slotDefs[k.split("|")[1]])
    .sort((a, b) => {
      const [da, sa] = a.split("|");
      const [db, sb] = b.split("|");
      return da.localeCompare(db) || slotDefs[sa].start.localeCompare(slotDefs[sb].start) || sa.localeCompare(sb);
    });

  const slots: SlotResult[] = [];
  const nameOf: Record<string, string> = {};
  for (const c of claims) nameOf[c.employeeId] = c.employeeName;

  for (const key of ordered) {
    const [date, shiftTypeId] = key.split("|");
    const def = slotDefs[shiftTypeId];
    const need = Math.max(0, shortageByKey[key] ?? 0);
    const list = claimsBySlot.get(key) ?? [];
    const res: SlotResult = {
      key, date, shiftTypeId, shiftLabel: def.label, need,
      assigned: [], notSelected: [], held: [], remainingShortage: need, applicants: list.length,
    };
    const decide = (c: PlanClaim, reason: string): PlanDecision => ({
      claimId: c.id, employeeName: c.employeeName, date, shiftLabel: def.label, reason,
    });

    // 1) 条件チェック（満たさない応募は自動確定しない＝PENDINGのまま残す）
    const eligible: (PlanClaim & { override: { start: string; end: string } | null; hours: number })[] = [];
    const ineligible: PlanDecision[] = [];
    for (const c of list) {
      if (!c.isActive) { ineligible.push(decide(c, "従業員が無効（退職・削除済み）です")); continue; }
      if (busyKeys.has(`${c.employeeId}|${date}`) || assignedKeys.has(`${c.employeeId}|${date}`)) {
        ineligible.push(decide(c, "この日は既に勤務予定があります"));
        continue;
      }
      const meets = requestMeetsSlot(def, { start: c.requestedStartTime, end: c.requestedEndTime });
      if (!meets.ok) { ineligible.push(decide(c, meets.reason ?? "募集枠の条件を満たしていません")); continue; }
      const override = clampToSlot(def, { start: c.requestedStartTime, end: c.requestedEndTime });
      const hours = (override ? windowMinutes(override.start, override.end) : windowMinutes(def.start, def.end)) / 60;
      if (c.role === "PARTTIME") {
        const wk = `${c.employeeId}|${weekStartKey(date)}`;
        if ((weekly[wk] ?? 0) + hours > PARTTIME_WEEKLY_LIMIT_HOURS) {
          ineligible.push(decide(c, `週${PARTTIME_WEEKLY_LIMIT_HOURS}時間の上限を超えます`));
          continue;
        }
      }
      eligible.push({ ...c, override, hours });
    }

    // 2) 公平な並び: 合計実労働時間 → 優先順位 → 従業員ID
    eligible.sort(
      (a, b) =>
        (running[a.employeeId] ?? 0) - (running[b.employeeId] ?? 0) ||
        a.priorityOrder - b.priorityOrder ||
        a.employeeId.localeCompare(b.employeeId)
    );

    // 3) 必要人数まで採用（超えない）
    const chosen = eligible.slice(0, need);
    const rest = eligible.slice(need);
    for (const c of chosen) {
      res.assigned.push({
        claimId: c.id, employeeId: c.employeeId, employeeName: c.employeeName, date,
        shiftTypeId, shiftLabel: def.label, override: c.override, netMinutes: def.netMinutes,
      });
      running[c.employeeId] = (running[c.employeeId] ?? 0) + def.netMinutes;
      days[c.employeeId] = (days[c.employeeId] ?? 0) + 1;
      assignedKeys.add(`${c.employeeId}|${date}`);
      if (c.role === "PARTTIME") {
        const wk = `${c.employeeId}|${weekStartKey(date)}`;
        weekly[wk] = (weekly[wk] ?? 0) + c.hours;
      }
    }
    res.remainingShortage = need - chosen.length;

    // 4) 選ばれなかった応募: 枠が埋まった（または元から満員）なら不採用、まだ不足があれば条件未達としてPENDINGのまま
    const slotFull = res.remainingShortage === 0;
    const reasonFull = need === 0 ? "この枠は既に必要人数を満たしています" : "必要人数に達したため不採用";
    if (slotFull) {
      for (const c of rest) res.notSelected.push(decide(c, reasonFull));
      for (const d of ineligible) res.notSelected.push({ ...d, reason: `${reasonFull}（${d.reason}）` });
    } else {
      res.held.push(...ineligible);
    }
    slots.push(res);
  }

  // 枠に結び付かない応募（旧形式でシフト未指定、または枠定義なし）は自動処理せず手動確認
  const heldOrphans: PlanDecision[] = orphan.map((c) => ({
    claimId: c.id, employeeName: c.employeeName, date: c.date, shiftLabel: "未指定",
    reason: "シフト（枠）が特定できない旧形式の申請です。手動で確認してください",
  }));

  const assignments = slots.flatMap((s) => s.assigned);
  const notSelected = slots.flatMap((s) => s.notSelected);
  const held = [...slots.flatMap((s) => s.held), ...heldOrphans];
  const unfilled = slots
    .filter((s) => s.remainingShortage > 0)
    .map((s) => ({ date: s.date, shiftLabel: s.shiftLabel, shortage: s.remainingShortage, applicants: s.applicants }));

  const involved = new Set<string>([...claims.map((c) => c.employeeId)]);
  const totals: EmployeeTotal[] = [...involved]
    .map((id) => {
      const mine = assignments.filter((a) => a.employeeId === id);
      return {
        employeeId: id,
        employeeName: nameOf[id] ?? id,
        addedDays: mine.length,
        addedMinutes: mine.reduce((s, a) => s + a.netMinutes, 0),
        totalDays: days[id] ?? 0,
        totalMinutes: running[id] ?? 0,
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ja"));

  const signature = planSignature(assignments, notSelected);

  return { slots, assignments, notSelected, held, unfilled, totals, signature };
}
