import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/auditLog";
import { todayJst } from "@/lib/jst";

// POST /api/shift-claims/:id/cancel — 従業員本人が自分の勤務希望を取り消す
//  - 申請中(PENDING)   … 本人がすぐ取消（→ CANCELED）。月間勤務表は未反映のため何も変わらない
//  - 確定済み(APPROVED) … INCの承認が必要（→ CANCEL_REQUESTED）。INCが承認すると勤務表から削除される
// 他人の申請は操作できない。履歴は削除せず、操作ログにも残す。
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "EMPLOYEE" || !session.user.employeeId) {
    return NextResponse.json({ error: "この操作は従業員アカウントのみ可能です" }, { status: 403 });
  }
  const actor = session.user.email ?? session.user.id ?? "unknown";

  const claim = await prisma.shiftClaimRequest.findUnique({ where: { id: params.id } });
  if (!claim || claim.employeeId !== session.user.employeeId) {
    return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  }
  const dateStr = claim.workDate.toISOString().slice(0, 10);
  const now = new Date();

  if (claim.status === "PENDING") {
    const upd = await prisma.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "PENDING" }, data: { status: "CANCELED", decidedAt: now, decidedBy: actor } });
    if (upd.count !== 1) return NextResponse.json({ error: "申請の状態が変わりました。画面を更新してください" }, { status: 409 });
    await writeAudit(prisma, { recordId: claim.id, action: "CLAIM_CANCEL", changedBy: actor, oldValue: { status: "PENDING" }, newValue: { status: "CANCELED", date: dateStr } });
    return NextResponse.json({ status: "CANCELED" });
  }

  if (claim.status === "APPROVED") {
    if (dateStr < todayJst()) return NextResponse.json({ error: "過去の勤務は取消申請できません" }, { status: 400 });
    const upd = await prisma.shiftClaimRequest.updateMany({ where: { id: claim.id, status: "APPROVED" }, data: { status: "CANCEL_REQUESTED", cancelRequestedAt: now } });
    if (upd.count !== 1) return NextResponse.json({ error: "申請の状態が変わりました。画面を更新してください" }, { status: 409 });
    await writeAudit(prisma, { recordId: claim.id, action: "CANCEL_REQUEST", changedBy: actor, oldValue: { status: "APPROVED" }, newValue: { status: "CANCEL_REQUESTED", date: dateStr } });
    return NextResponse.json({ status: "CANCEL_REQUESTED" });
  }

  return NextResponse.json({ error: "この申請は取り消せる状態ではありません" }, { status: 409 });
}
