import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isManagerRole } from "@/lib/roles";
import { writeAudit } from "@/lib/auditLog";
import { markMonthsRevised } from "@/lib/monthStatus";
import { getMonthShiftGaps } from "@/lib/monthlyShiftGap";
import { clampToSlot } from "@/lib/claimRules";
import { attemptBackfillOnRosterChange } from "@/lib/autoBackfill";
import { z } from "zod";

const DecisionInput = z.object({ decision: z.enum(["APPROVED", "REJECTED", "CANCEL_APPROVED", "CANCEL_REJECTED"]) });

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

// PATCH /api/shift-claims/:id
//  - INC（管理者）:
//      APPROVED        … 申請中(PENDING)を個別に確定（月間勤務表へ反映。必要人数を超える確定は不可）
//      REJECTED        … 申請中(PENDING)を却下
//      CANCEL_APPROVED … 取消申請中(CANCEL_REQUESTED)を承認 → 取消済み(CANCELED)。月間勤務表の該当勤務を削除
//      CANCEL_REJECTED … 取消申請を却下 → 確定済み(APPROVED)に戻す
//  - 従業員本人: INCからの招待(INVITED)を「辞退」(REJECTED)のみ可能
// すべての変更は操作ログ（RosterAuditLog）に、実行したアカウントとともに残す。
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = DecisionInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "操作の指定が正しくありません" }, { status: 400 });
  const decision = parsed.data.decision;
  const actor = session.user.email ?? session.user.id ?? "unknown";

  const claim = await prisma.shiftClaimRequest.findUnique({ where: { id: params.id }, include: { shiftType: true } });
  if (!claim) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });

  const isSelfDecline =
    session.user.role === "EMPLOYEE" &&
    session.user.employeeId === claim.employeeId &&
    claim.status === "INVITED" &&
    decision === "REJECTED";

  if (!isManagerRole(session.user.role) && !isSelfDecline) {
    return NextResponse.json({ error: "この操作はINC（管理者）のみ可能です" }, { status: 403 });
  }

  const dateStr = claim.workDate.toISOString().slice(0, 10);
  const month = dateStr.slice(0, 7);
  const now = new Date();

  try {
    if (isSelfDecline) {
      const upd = await prisma.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "INVITED" }, data: { status: "REJECTED", decidedAt: now, decidedBy: actor } });
      if (upd.count !== 1) throw new HttpError("申請の状態が変わりました。画面を更新してください");
      await writeAudit(prisma, { recordId: claim.id, action: "INVITE_DECLINE", changedBy: actor, oldValue: { status: "INVITED" }, newValue: { status: "REJECTED" } });
      return NextResponse.json(await prisma.shiftClaimRequest.findUnique({ where: { id: claim.id } }));
    }

    const needStatus = decision === "APPROVED" || decision === "REJECTED" ? "PENDING" : "CANCEL_REQUESTED";
    if (claim.status !== needStatus) throw new HttpError("この申請は既に処理済み、または状態が変わっています。画面を更新してください");

    let backfillTarget: { employeeId: string; date: Date } | null = null;

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bulk-confirm:" + month}))`; // 一括確定と同じ月単位のロック

        if (decision === "REJECTED") {
          const upd = await tx.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: now, decidedBy: actor } });
          if (upd.count !== 1) throw new HttpError("申請の状態が変わりました。画面を更新してください");
          await writeAudit(tx, { recordId: claim.id, action: "CLAIM_REJECT", changedBy: actor, oldValue: { status: "PENDING" }, newValue: { status: "REJECTED" } });
          return;
        }

        if (decision === "APPROVED") {
          const upd = await tx.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "PENDING" }, data: { status: "APPROVED", decidedAt: now, decidedBy: actor } });
          if (upd.count !== 1) throw new HttpError("申請の状態が変わりました。画面を更新してください");

          const existing = await tx.monthRoster.findUnique({ where: { employeeId_workDate: { employeeId: claim.employeeId, workDate: claim.workDate } } });
          if (existing?.status === "WORK") throw new HttpError("この従業員は、この日に既に勤務が登録されています");

          // 必要人数を超えて確定しない（枠が特定できる申請のみ。旧形式の申請は従来どおり）
          if (claim.shiftTypeId) {
            const [y, m] = dateStr.split("-").map(Number);
            const gaps = await getMonthShiftGaps(y, m);
            const gap = gaps.find((g) => g.date === dateStr && g.shiftTypeId === claim.shiftTypeId);
            if (!gap || gap.shortage <= 0) throw new HttpError("この枠は既に必要人数を満たしているため、確定できません");
          }

          const override = claim.shiftType
            ? clampToSlot({ start: claim.shiftType.defaultStartTime, end: claim.shiftType.defaultEndTime }, { start: claim.requestedStartTime, end: claim.requestedEndTime })
            : claim.requestedStartTime && claim.requestedEndTime
              ? { start: claim.requestedStartTime, end: claim.requestedEndTime }
              : null;
          await tx.monthRoster.upsert({
            where: { employeeId_workDate: { employeeId: claim.employeeId, workDate: claim.workDate } },
            update: { status: "WORK", shiftTypeId: claim.shiftTypeId ?? undefined, overrideStartTime: override?.start ?? null, overrideEndTime: override?.end ?? null, updatedBy: actor },
            create: { employeeId: claim.employeeId, workDate: claim.workDate, status: "WORK", shiftTypeId: claim.shiftTypeId ?? null, overrideStartTime: override?.start ?? null, overrideEndTime: override?.end ?? null, createdBy: actor },
          });
          await markMonthsRevised([month], actor, tx); // 確定後の追加なら「調整中」に戻す
          await writeAudit(tx, { recordId: claim.id, action: "CLAIM_APPROVE", changedBy: actor, oldValue: { status: "PENDING" }, newValue: { status: "APPROVED", employeeId: claim.employeeId, date: dateStr, override } });
          return;
        }

        if (decision === "CANCEL_REJECTED") {
          const upd = await tx.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "CANCEL_REQUESTED" }, data: { status: "APPROVED", cancelRequestedAt: null, decidedAt: now, decidedBy: actor } });
          if (upd.count !== 1) throw new HttpError("申請の状態が変わりました。画面を更新してください");
          await writeAudit(tx, { recordId: claim.id, action: "CANCEL_REJECT", changedBy: actor, oldValue: { status: "CANCEL_REQUESTED" }, newValue: { status: "APPROVED" } });
          return;
        }

        // CANCEL_APPROVED: この申請で登録された勤務だけを月間勤務表から削除する
        const upd = await tx.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "CANCEL_REQUESTED" }, data: { status: "CANCELED", decidedAt: now, decidedBy: actor } });
        if (upd.count !== 1) throw new HttpError("申請の状態が変わりました。画面を更新してください");

        const roster = await tx.monthRoster.findUnique({ where: { employeeId_workDate: { employeeId: claim.employeeId, workDate: claim.workDate } } });
        let deleted: unknown = null;
        if (roster && roster.status === "WORK") {
          if (claim.shiftTypeId && roster.shiftTypeId !== claim.shiftTypeId) {
            throw new HttpError("勤務表のこの日の勤務が、申請内容と異なる内容に変更されています。勤務表を確認して手動で対応してください");
          }
          await tx.monthRoster.delete({ where: { id: roster.id } });
          deleted = { shiftTypeId: roster.shiftTypeId, start: roster.overrideStartTime, end: roster.overrideEndTime };
          backfillTarget = { employeeId: claim.employeeId, date: claim.workDate };
          await markMonthsRevised([month], actor, tx); // 確定後の取消なら「調整中」に戻す
        }
        await writeAudit(tx, { recordId: claim.id, action: "CANCEL_APPROVE", changedBy: actor, oldValue: { status: "CANCEL_REQUESTED", roster: deleted }, newValue: { status: "CANCELED", rosterDeleted: !!deleted, date: dateStr } });
      },
      { timeout: 30000, maxWait: 10000 }
    );

    // 勤務を外した日の日別割り当てを整理（既存の「出勤しない状態への変更」と同じ処理）。失敗しても取消自体は完了している。
    if (backfillTarget) {
      try {
        await attemptBackfillOnRosterChange((backfillTarget as any).employeeId, (backfillTarget as any).date);
      } catch (e) {
        console.error("[shift-claims] 取消後の日別割り当て整理に失敗:", e);
      }
    }

    return NextResponse.json(await prisma.shiftClaimRequest.findUnique({ where: { id: claim.id } }));
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[shift-claims PATCH]", e);
    return NextResponse.json({ error: "処理に失敗しました。しばらくしてから再度お試しください" }, { status: 500 });
  }
}
