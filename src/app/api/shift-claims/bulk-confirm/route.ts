import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isManagerRole } from "@/lib/roles";
import { buildBulkPlan, executeBulkConfirm, BulkConfirmError } from "@/lib/bulkConfirm";
import { formatDateJp } from "@/lib/shortageMail";
import type { Plan } from "@/lib/fairAssignment";
import { z } from "zod";

const Input = z.object({
  month: z.string(), // "2026-11"（基本は1か月単位）
  dryRun: z.boolean().default(true), // true: プレビューのみ（何も保存しない） / false: 本登録
  signature: z.string().optional(), // プレビューで返した signature。本登録時に内容が変わっていないか確認する
});

function present(plan: Plan) {
  return {
    signature: plan.signature,
    slots: plan.slots.map((s) => ({
      key: s.key, date: s.date, dateLabel: formatDateJp(s.date), shiftLabel: s.shiftLabel, need: s.need, applicants: s.applicants,
      assigned: s.assigned.map((a) => ({ claimId: a.claimId, employeeName: a.employeeName, override: a.override })),
      notSelected: s.notSelected.map((n) => ({ claimId: n.claimId, employeeName: n.employeeName, reason: n.reason })),
      held: s.held.map((h) => ({ claimId: h.claimId, employeeName: h.employeeName, reason: h.reason })),
      remainingShortage: s.remainingShortage,
    })),
    totals: plan.totals,
    unfilled: plan.unfilled.map((u) => ({ ...u, dateLabel: formatDateJp(u.date) })),
    held: plan.held.map((h) => ({ ...h, dateLabel: h.date ? formatDateJp(h.date) : "" })),
    counts: { approved: plan.assignments.length, notSelected: plan.notSelected.length, held: plan.held.length, unfilled: plan.unfilled.length },
  };
}

// POST /api/shift-claims/bulk-confirm — 勤務者の一括確定（INC/管理者のみ）
//  dryRun=true  : プレビュー（各枠の割り当て結果・従業員ごとの合計・未確定の枠）。何も保存しない
//  dryRun=false : 本登録（トランザクション。途中で失敗したら何も登録しない）。対象は「申請中(PENDING)」のみ
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "勤務者の確定はINC（管理者）のみ可能です" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });
  const { month, dryRun, signature } = parsed.data;
  const actor = session.user.email ?? session.user.id ?? "unknown";

  try {
    if (dryRun) {
      const { pendingCount, plan } = await buildBulkPlan(month);
      if (pendingCount === 0 || !plan) return NextResponse.json({ empty: true, message: "確定対象の勤務希望がありません" });
      return NextResponse.json({ empty: false, pendingCount, ...present(plan) });
    }
    const r = await executeBulkConfirm(month, actor, signature);
    if (r.empty || !r.plan) return NextResponse.json({ empty: true, message: "確定対象の勤務希望がありません" });
    if (r.noop) {
      return NextResponse.json({ empty: false, noop: true, message: "今回確定できる勤務希望はありません（条件の確認が必要なものがあります）", ...present(r.plan) });
    }
    return NextResponse.json({ empty: false, committed: true, approved: r.approved, notSelected: r.notSelected, ...present(r.plan) });
  } catch (e: any) {
    if (e instanceof BulkConfirmError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[bulk-confirm]", e);
    return NextResponse.json({ error: "一括確定に失敗しました。何も登録されていません" }, { status: 500 });
  }
}
