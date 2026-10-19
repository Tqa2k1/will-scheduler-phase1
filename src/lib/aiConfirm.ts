import { prisma } from "@/lib/prisma";
import { runAiTools, type AiTool } from "@/lib/aiAssist";
import { buildBulkPlan, executeBulkConfirm, BulkConfirmError, type BulkScope } from "@/lib/bulkConfirm";
import { PARTTIME_WEEKLY_LIMIT_HOURS, weekStartKey, type Plan, type PlannedAssignment } from "@/lib/fairAssignment";
import { windowMinutes } from "@/lib/claimRules";
import { formatDateJp, parseMonth } from "@/lib/shortageMail";

// 「AI依頼」から勤務希望（応募）を確定する処理。
//  - AIは Function Calling で「対象月・従業員・期間」を決め、サーバーの確定プラン作成関数を呼ぶ。
//  - 実際の選定と確定は既存の一括確定（bulkConfirm / fairAssignment）をそのまま使う。
//    → 週20時間（バイト）・同日重複・必要人数・公平な並び・トランザクション・監査ログの各ルールは従来どおり。
//  - AIの文章だけで「確定した」とは言わせない。結果はDBを読み直して確認した内容だけを返す。
//  - 2段階: ① preview（何も保存しない）→ ② execute（管理者が「確定する」を押した時だけ。プレビューの署名が一致する場合のみ）。

export type ConfirmScope = { employeeIds?: string[]; employeeNames?: string[]; fromDate?: string; toDate?: string };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s: string) => s.replace(/[\s　]/g, "");

export async function pendingEmployees(month: string) {
  const p = parseMonth(month);
  if (!p) throw new BulkConfirmError("month は YYYY-MM 形式で指定してください", 400);
  const rows = await prisma.shiftClaimRequest.findMany({
    where: { status: "PENDING", workDate: { gte: new Date(Date.UTC(p.year, p.mon - 1, 1)), lt: new Date(Date.UTC(p.year, p.mon, 1)) } },
    include: { employee: true },
  });
  const map = new Map<string, { id: string; name: string; role: string; pending: number }>();
  for (const r of rows) {
    const e = map.get(r.employeeId) ?? { id: r.employeeId, name: r.employee.fullName, role: r.employee.role, pending: 0 };
    e.pending++;
    map.set(r.employeeId, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

// 氏名（姓だけ・空白の違いは許容）→ 従業員ID。見つからない／複数該当は理由つきで返す
export function resolveNames(names: string[], list: { id: string; name: string }[]) {
  const ids: string[] = [];
  const problems: string[] = [];
  for (const n of names) {
    const q = norm(n);
    if (!q) continue;
    const exact = list.filter((e) => norm(e.name) === q);
    const hit = exact.length ? exact : list.filter((e) => norm(e.name).includes(q));
    if (hit.length === 0) problems.push(`「${n}」は申請中の勤務希望がある従業員の中に見つかりません`);
    else if (hit.length > 1) problems.push(`「${n}」に該当する従業員が複数います（${hit.map((h) => h.name).join("、")}）。フルネームで指定してください`);
    else ids.push(hit[0].id);
  }
  return { ids: [...new Set(ids)], problems };
}

function hoursOf(a: PlannedAssignment): number {
  if (a.override) return windowMinutes(a.override.start, a.override.end) / 60;
  const [s, e] = a.shiftLabel.split("〜");
  return s && e ? windowMinutes(s, e) / 60 : a.netMinutes / 60;
}

// 従業員×週の実労働時間（既存＋今回の確定分）。バイトは週20時間の上限と比較する
export function weeklyReport(plan: Plan, existing: Record<string, number> = {}, roleById: Record<string, string> = {}) {
  const rows = new Map<string, { employeeName: string; weekStart: string; existingHours: number; addedHours: number; role: string }>();
  for (const a of plan.assignments) {
    const wk = weekStartKey(a.date);
    const k = `${a.employeeId}|${wk}`;
    const r = rows.get(k) ?? { employeeName: a.employeeName, weekStart: wk, existingHours: existing[k] ?? 0, addedHours: 0, role: roleById[a.employeeId] ?? "" };
    r.addedHours += hoursOf(a);
    rows.set(k, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, totalHours: Math.round((r.existingHours + r.addedHours) * 100) / 100, limit: r.role === "PARTTIME" ? PARTTIME_WEEKLY_LIMIT_HOURS : null }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ja") || a.weekStart.localeCompare(b.weekStart));
}

export function presentResult(plan: Plan, weekly: ReturnType<typeof weeklyReport>) {
  return {
    signature: plan.signature,
    approved: plan.assignments.map((a) => ({ claimId: a.claimId, employeeName: a.employeeName, date: a.date, dateLabel: formatDateJp(a.date), shiftLabel: a.shiftLabel })),
    notSelected: plan.notSelected.map((n) => ({ claimId: n.claimId, employeeName: n.employeeName, date: n.date, dateLabel: formatDateJp(n.date), shiftLabel: n.shiftLabel, reason: n.reason })),
    held: plan.held.map((h) => ({ claimId: h.claimId, employeeName: h.employeeName, date: h.date, dateLabel: h.date ? formatDateJp(h.date) : "", shiftLabel: h.shiftLabel, reason: h.reason })),
    unfilled: plan.unfilled.map((u) => ({ ...u, dateLabel: formatDateJp(u.date) })),
    weekly,
  };
}

async function roleMap(month: string) {
  const list = await prisma.employee.findMany({ select: { id: true, role: true } });
  return Object.fromEntries(list.map((e: { id: string; role: string }) => [e.id, e.role]));
}

export async function buildScopedPreview(month: string, scope: BulkScope) {
  const { pendingCount, plan, existingWeeklyHours } = await buildBulkPlan(month, scope);
  if (pendingCount === 0 || !plan) return null;
  return { pendingCount, plan, result: presentResult(plan, weeklyReport(plan, existingWeeklyHours, await roleMap(month))) };
}

const SYSTEM = `あなたはWHILLシフト管理の「勤務希望の確定」担当AIです。管理者の依頼に従い、申請中の勤務希望をまとめて確定するための案を作ります。
必ず次の順で関数を使ってください。文章だけで「確定した」「調整した」と答えてはいけません。
1. list_pending_employees で、対象月に申請中の勤務希望がある従業員と件数を確認する。
2. plan_confirmation を呼ぶ。依頼で人や期間が指定されていればそれを渡し、指定がなければ引数を省略（＝その月の全員）。
3. 関数の結果（確定予定・確定できないもの・週ごとの労働時間）だけを根拠に、日本語で3〜6行で報告する。
ルール:
- 選定・上限判定は plan_confirmation の中の既存ルールが行う（必要人数まで／合計労働時間が少ない人を優先→優先順位／同日重複なし／バイトは週${PARTTIME_WEEKLY_LIMIT_HOURS}時間まで）。あなたが人を選び直したり、結果を変えたりしない。
- 週${PARTTIME_WEEKLY_LIMIT_HOURS}時間以外の上限や、特定の人を特定の枠に固定する依頼は未対応。その場合は対応できないことを伝え、plan_confirmation は呼ばない。
- この段階ではまだ何も確定されない。「確認後に『この内容で確定する』ボタンで確定されます」と伝える。
- 見つからない従業員名などのエラーは、そのまま伝える。`;

export type AiConfirmPreview =
  | { ok: true; message: string; month: string; scope: BulkScope; pendingCount: number; result: ReturnType<typeof presentResult> }
  | { ok: false; error: string };

export async function aiConfirmPreview(month: string, prompt: string): Promise<AiConfirmPreview> {
  let employeesList;
  try { employeesList = await pendingEmployees(month); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "対象月の取得に失敗しました" }; }
  if (employeesList.length === 0) return { ok: false, error: `${month} に申請中の勤務希望はありません。` };

  const st: { built: Awaited<ReturnType<typeof buildScopedPreview>>; scope: BulkScope } = { built: null, scope: {} };
  const tools: AiTool[] = [
    {
      name: "list_pending_employees",
      description: "対象月に申請中(PENDING)の勤務希望がある従業員と件数、雇用区分(PARTTIME=バイト)を返す",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async () => ({ month, employees: employeesList.map((e) => ({ name: e.name, role: e.role, pendingCount: e.pending })) }),
    },
    {
      name: "plan_confirmation",
      description: "申請中の勤務希望から、既存ルールで確定する案を作る（保存はしない）。結果に確定予定・確定できない理由・従業員×週の労働時間が含まれる",
      parameters: {
        type: "object",
        properties: {
          employeeNames: { type: "array", items: { type: "string" }, description: "対象の従業員名。省略＝全員" },
          fromDate: { type: "string", description: "YYYY-MM-DD。この日以降だけ。省略可" },
          toDate: { type: "string", description: "YYYY-MM-DD。この日まで。省略可" },
        },
        additionalProperties: false,
      },
      run: async (args: { employeeNames?: string[]; fromDate?: string; toDate?: string }) => {
        const scope: BulkScope = {};
        if (args.employeeNames?.length) {
          const r = resolveNames(args.employeeNames, employeesList);
          if (r.problems.length) return { error: r.problems.join(" / ") };
          scope.employeeIds = r.ids;
        }
        for (const k of ["fromDate", "toDate"] as const) {
          const v = args[k];
          if (v !== undefined && v !== "") {
            if (!dateRe.test(v) || !v.startsWith(month)) return { error: `${k} は ${month} 内の YYYY-MM-DD で指定してください` };
            scope[k] = v;
          }
        }
        const b = await buildScopedPreview(month, scope);
        if (!b) return { error: "条件に合う申請中の勤務希望がありません" };
        st.built = b;
        st.scope = scope;
        const r = b.result;
        return {
          確定予定: r.approved.map((a) => `${a.employeeName} ${a.date} ${a.shiftLabel}`),
          不採用予定: r.notSelected.map((a) => `${a.employeeName} ${a.date}: ${a.reason}`),
          確定できない: r.held.map((a) => `${a.employeeName} ${a.date}: ${a.reason}`),
          週ごとの労働時間: r.weekly.map((w) => `${w.employeeName} 週${w.weekStart}〜 合計${w.totalHours}h${w.limit ? `（上限${w.limit}h）` : ""}`),
        };
      },
    },
  ];

  const user = `対象月: ${month}\n管理者の依頼: ${prompt.trim() || "申請中の勤務希望をすべて確定してください"}`;
  const ai = await runAiTools(SYSTEM, user, tools);
  if (ai.error) return { ok: false, error: ai.error };
  if (!st.built) {
    // 関数が呼ばれなかった／エラーで終わった＝案ができていない。成功したようには見せない
    return { ok: false, error: `確定案を作成できませんでした。${ai.message}` };
  }
  const b = st.built;
  return { ok: true, message: ai.message, month, scope: st.scope, pendingCount: b.pendingCount, result: b.result };
}

export type AiConfirmExecution =
  | { ok: true; confirmed: { claimId: string; employeeName: string; date: string; dateLabel: string; shiftLabel: string }[]; notConfirmed: { employeeName: string; date: string; dateLabel: string; reason: string; kind: "不採用" | "保留" | "要確認" }[]; weekly: ReturnType<typeof weeklyReport>; message: string }
  | { ok: false; error: string; status: number };

// 管理者が「この内容で確定する」を押した時に実行。既存の一括確定をそのまま呼び、DBを読み直して結果を確認する
export async function aiConfirmExecute(month: string, scope: BulkScope, signature: string, actor: string): Promise<AiConfirmExecution> {
  try {
    const r = await executeBulkConfirm(month, actor, signature, scope);
    if (r.empty || !r.plan) return { ok: false, error: "確定対象の勤務希望がありません", status: 409 };
    if (r.noop) {
      return { ok: false, error: "今回確定できる勤務希望はありません（条件の確認が必要なものがあります）。", status: 409 };
    }
    const plan = r.plan;
    // 実行結果の確認: 本当にDBが「確定(APPROVED)」になったかを読み直す
    const ids = plan.assignments.map((a) => a.claimId);
    const rows = ids.length ? await prisma.shiftClaimRequest.findMany({ where: { id: { in: ids } } }) : [];
    const okIds = new Set(rows.filter((x: { status: string }) => x.status === "APPROVED").map((x: { id: string }) => x.id));
    const confirmed = plan.assignments.filter((a) => okIds.has(a.claimId)).map((a) => ({ claimId: a.claimId, employeeName: a.employeeName, date: a.date, dateLabel: formatDateJp(a.date), shiftLabel: a.shiftLabel }));
    const notConfirmed: Extract<AiConfirmExecution, { ok: true }>["notConfirmed"] = [
      ...plan.assignments.filter((a) => !okIds.has(a.claimId)).map((a) => ({ employeeName: a.employeeName, date: a.date, dateLabel: formatDateJp(a.date), reason: "確定処理後の状態確認で確定になっていません", kind: "要確認" as const })),
      ...plan.notSelected.map((n) => ({ employeeName: n.employeeName, date: n.date, dateLabel: formatDateJp(n.date), reason: n.reason, kind: "不採用" as const })),
      ...plan.held.map((h) => ({ employeeName: h.employeeName, date: h.date, dateLabel: h.date ? formatDateJp(h.date) : "", reason: h.reason, kind: "保留" as const })),
    ];
    const weekly = weeklyReport(plan, undefined, await roleMap(month));
    const failed = plan.assignments.length - confirmed.length;
    if (failed > 0) return { ok: false, error: `確定処理は完了しましたが、${failed}件の状態を確認できませんでした。勤務希望の一覧を確認してください。`, status: 500 };
    return { ok: true, confirmed, notConfirmed, weekly, message: `${confirmed.length}件の勤務希望を確定しました。` };
  } catch (e) {
    if (e instanceof BulkConfirmError) return { ok: false, error: e.message, status: e.status };
    console.error("[ai-confirm]", e);
    return { ok: false, error: "確定処理に失敗しました。何も登録されていません。", status: 500 };
  }
}
