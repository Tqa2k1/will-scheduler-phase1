import { prisma } from "@/lib/prisma";
import { getMonthShiftGaps } from "@/lib/monthlyShiftGap";
import { getMonthNetMinutes, grossMinutesOf, netMinutesOf, ruleBreakMinutes } from "@/lib/workedHours";
import { getWeeklyScheduledHours } from "@/lib/weeklyHours";
import { planFairAssignments, planSignature, weekStartKey, type Plan, type PlanClaim, type PlanSlotDef } from "@/lib/fairAssignment";
import { writeAudit } from "@/lib/auditLog";
import { markMonthsRevised } from "@/lib/monthStatus";
import { parseMonth } from "@/lib/shortageMail";

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export class BulkConfirmError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

// 確定の対象を絞り込む条件（AI依頼から使う。指定なし＝その月の全員・全日）。
// 案そのものは必ず「その月の全申請」で作る（枠の定員・公平な並びを崩さないため）。絞り込みは結果の適用範囲だけに効く。
export type BulkScope = { employeeIds?: string[]; fromDate?: string; toDate?: string };

export type BulkPlanResult = {
  pendingCount: number;
  plan: Plan | null;
  /** バイトの「従業員|週の開始日」→ 既存の週勤務時間（今回の確定分を含まない） */
  existingWeeklyHours?: Record<string, number>;
};

function inScope(scope: BulkScope | undefined, employeeId: string | null | undefined, date: string | null | undefined) {
  if (!scope) return true;
  if (scope.employeeIds && !scope.employeeIds.includes(employeeId ?? "")) return false;
  if (scope.fromDate && (date ?? "") < scope.fromDate) return false;
  if (scope.toDate && (date ?? "") > scope.toDate) return false;
  return true;
}

// 案を絞り込み条件で切り出す（純粋関数）。署名は切り出し後の内容で作り直す。
export function scopePlan(plan: Plan, scope?: BulkScope, employeeIdByClaim: Record<string, string> = {}): Plan {
  if (!scope || (!scope.employeeIds && !scope.fromDate && !scope.toDate)) return plan;
  // 保留・不採用は氏名しか持たないため、申請IDから従業員を引いて判定する
  const keepDecision = (d: { claimId: string; date: string }) => inScope(scope, employeeIdByClaim[d.claimId], d.date);
  const assignments = plan.assignments.filter((a) => inScope(scope, a.employeeId, a.date));
  const notSelected = plan.notSelected.filter(keepDecision);
  const held = plan.held.filter((h) => inScope(scope, employeeIdByClaim[h.claimId], h.date && h.date !== "" ? h.date : null));
  const slots = plan.slots
    .map((s) => ({
      ...s,
      assigned: s.assigned.filter((a) => inScope(scope, a.employeeId, a.date)),
      notSelected: s.notSelected.filter(keepDecision),
      held: s.held.filter(keepDecision),
    }))
    .filter((s) => s.assigned.length + s.notSelected.length + s.held.length > 0);
  const unfilled = plan.unfilled.filter((u) => slots.some((s) => s.date === u.date && s.shiftLabel === u.shiftLabel && s.remainingShortage > 0));
  const totals = plan.totals
    .filter((t) => inScope(scope, t.employeeId, null))
    .map((t) => {
      const mine = assignments.filter((a) => a.employeeId === t.employeeId);
      const addedMinutes = mine.reduce((s, a) => s + a.netMinutes, 0);
      return { ...t, addedDays: mine.length, addedMinutes };
    });
  return { slots, assignments, notSelected, held, unfilled, totals, signature: planSignature(assignments, notSelected) };
}

// 指定月の「申請中(PENDING)」の勤務希望を集めて、公平な割り当て案を作る（何も保存しない）。
// 2回目メール経由で登録された PENDING も同じ対象（同じ ShiftClaimRequest）。
export async function buildBulkPlan(month: string, scope?: BulkScope): Promise<BulkPlanResult> {
  const p = parseMonth(month);
  if (!p) throw new BulkConfirmError("month は YYYY-MM 形式で指定してください", 400);
  const rangeStart = new Date(Date.UTC(p.year, p.mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(p.year, p.mon, 1));

  const pending = await prisma.shiftClaimRequest.findMany({
    where: { status: "PENDING", workDate: { gte: rangeStart, lt: rangeEnd } },
    include: { employee: true },
  });
  if (pending.length === 0) return { pendingCount: 0, plan: null };

  const [gaps, shiftTypes, workEntries, worked] = await Promise.all([
    getMonthShiftGaps(p.year, p.mon),
    prisma.shiftType.findMany(),
    prisma.monthRoster.findMany({ where: { workDate: { gte: rangeStart, lt: rangeEnd }, status: "WORK" }, select: { employeeId: true, workDate: true } }),
    getMonthNetMinutes(p.year, p.mon),
  ]);

  const shortageByKey: Record<string, number> = {};
  for (const g of gaps) shortageByKey[`${g.date}|${g.shiftTypeId}`] = g.shortage;

  const slotDefs: Record<string, PlanSlotDef> = {};
  for (const st of shiftTypes) {
    const gross = grossMinutesOf(st.defaultStartTime, st.defaultEndTime);
    slotDefs[st.id] = {
      shiftTypeId: st.id,
      label: `${st.defaultStartTime}〜${st.defaultEndTime}`,
      start: st.defaultStartTime,
      end: st.defaultEndTime,
      netMinutes: netMinutesOf(gross, ruleBreakMinutes(st.defaultStartTime, st.defaultEndTime, st.code)),
    };
  }

  const busyKeys = new Set(workEntries.map((e) => `${e.employeeId}|${dateKey(e.workDate)}`));
  const baseMinutes: Record<string, number> = {};
  const baseDays: Record<string, number> = {};
  for (const [id, w] of Object.entries(worked)) {
    baseMinutes[id] = w.minutes;
    baseDays[id] = w.days;
  }

  // バイトの週20時間判定用に、関係する週の既存勤務時間を取得（従業員×週でキャッシュ）
  const existingWeeklyHours: Record<string, number> = {};
  for (const c of pending) {
    if (c.employee.role !== "PARTTIME") continue;
    const key = `${c.employeeId}|${weekStartKey(dateKey(c.workDate))}`;
    if (existingWeeklyHours[key] === undefined) existingWeeklyHours[key] = await getWeeklyScheduledHours(c.employeeId, c.workDate);
  }

  const claims: PlanClaim[] = pending.map((c) => ({
    id: c.id,
    employeeId: c.employeeId,
    employeeName: c.employee.fullName,
    role: c.employee.role,
    priorityOrder: c.employee.priorityOrder,
    isActive: c.employee.isActive,
    date: dateKey(c.workDate),
    shiftTypeId: c.shiftTypeId,
    requestedStartTime: c.requestedStartTime,
    requestedEndTime: c.requestedEndTime,
  }));

  const fullPlan = planFairAssignments({ claims, slotDefs, shortageByKey, busyKeys, baseMinutes, baseDays, existingWeeklyHours });
  const employeeIdByClaim = Object.fromEntries(pending.map((c) => [c.id, c.employeeId]));
  const plan = scopePlan(fullPlan, scope, employeeIdByClaim);
  const scopedPending = scope ? pending.filter((c) => inScope(scope, c.employeeId, dateKey(c.workDate))).length : pending.length;
  return { pendingCount: scopedPending, plan, existingWeeklyHours };
}

// 本登録。月単位のロック（pg advisory lock）の中で案を作り直し、トランザクションで一括反映する。
// 途中で失敗した場合は何も登録しない（ロールバック）。再実行しても、確定済みはPENDINGでないため追加されない。
export async function executeBulkConfirm(month: string, actor: string, expectedSignature?: string, scope?: BulkScope) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bulk-confirm:" + month}))`;
      const { pendingCount, plan } = await buildBulkPlan(month, scope);
      if (pendingCount === 0 || !plan) return { empty: true as const, noop: false as const, plan: null, approved: 0, notSelected: 0 };
      if (expectedSignature && expectedSignature !== plan.signature) {
        throw new BulkConfirmError("プレビュー後に内容が変わりました。もう一度プレビューを確認してください");
      }

      // 確定も不採用も発生しない（条件未達のみ等）場合は、何も登録しない
      if (plan.assignments.length === 0 && plan.notSelected.length === 0) {
        return { empty: false as const, noop: true as const, plan, approved: 0, notSelected: 0 };
      }

      const now = new Date();
      const audits: Parameters<typeof writeAudit>[1] = [];

      for (const a of plan.assignments) {
        const workDate = new Date(a.date + "T00:00:00Z");
        const upd = await tx.shiftClaimRequest.updateMany({
          where: { id: a.claimId, status: "PENDING" },
          data: { status: "APPROVED", decidedAt: now, decidedBy: actor },
        });
        if (upd.count !== 1) throw new BulkConfirmError("他の操作で状態が変わった申請があります。もう一度お試しください");

        const existing = await tx.monthRoster.findUnique({ where: { employeeId_workDate: { employeeId: a.employeeId, workDate } } });
        if (existing?.status === "WORK") throw new BulkConfirmError(`${a.employeeName}さんは${a.date}に既に勤務が登録されています`);

        await tx.monthRoster.upsert({
          where: { employeeId_workDate: { employeeId: a.employeeId, workDate } },
          update: {
            status: "WORK",
            shiftTypeId: a.shiftTypeId,
            overrideStartTime: a.override?.start ?? null,
            overrideEndTime: a.override?.end ?? null,
            updatedBy: actor,
          },
          create: {
            employeeId: a.employeeId,
            workDate,
            status: "WORK",
            shiftTypeId: a.shiftTypeId,
            overrideStartTime: a.override?.start ?? null,
            overrideEndTime: a.override?.end ?? null,
            createdBy: actor,
          },
        });
        audits.push({
          recordId: a.claimId,
          action: "BULK_CONFIRM_APPROVE",
          changedBy: actor,
          oldValue: { status: "PENDING" },
          newValue: { status: "APPROVED", employeeId: a.employeeId, date: a.date, shift: a.shiftLabel, override: a.override },
        });
      }

      if (plan.notSelected.length > 0) {
        const ids = plan.notSelected.map((n) => n.claimId);
        const upd = await tx.shiftClaimRequest.updateMany({
          where: { id: { in: ids }, status: "PENDING" },
          data: { status: "NOT_SELECTED", decidedAt: now, decidedBy: actor },
        });
        if (upd.count !== ids.length) throw new BulkConfirmError("他の操作で状態が変わった申請があります。もう一度お試しください");
        for (const n of plan.notSelected) {
          audits.push({
            recordId: n.claimId,
            action: "BULK_CONFIRM_NOT_SELECTED",
            changedBy: actor,
            oldValue: { status: "PENDING" },
            newValue: { status: "NOT_SELECTED", reason: n.reason },
          });
        }
      }

      // 確定後に勤務が追加された月は「調整中」に戻す（再配信が必要）
      if (plan.assignments.length > 0) await markMonthsRevised([month], actor, tx);

      audits.push({
        tableName: "ShiftClaimBulkConfirm",
        recordId: month,
        action: "BULK_CONFIRM",
        changedBy: actor,
        newValue: { approved: plan.assignments.length, notSelected: plan.notSelected.length, held: plan.held.length, unfilled: plan.unfilled.length },
      });
      await writeAudit(tx, audits);

      return { empty: false as const, noop: false as const, plan, approved: plan.assignments.length, notSelected: plan.notSelected.length };
    },
    { timeout: 60000, maxWait: 15000 }
  );
}
