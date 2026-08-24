import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const DecisionInput = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

// PATCH /api/shift-claims/:id — INCが承認/却下する（管理者のみ）。
// 承認した場合のみ、月間勤務表(MonthRoster)にWORKとして反映される。却下した場合は何も変更しない。
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "申請の承認・却下は管理者のみ可能です" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = DecisionInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const claim = await prisma.shiftClaimRequest.findUnique({ where: { id: params.id } });
  if (!claim) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  if (claim.status !== "PENDING") {
    return NextResponse.json({ error: "この申請は既に処理済みです" }, { status: 409 });
  }

  const updated = await prisma.shiftClaimRequest.update({
    where: { id: params.id },
    data: { status: parsed.data.decision, decidedAt: new Date(), decidedBy: session.user.email ?? undefined },
  });

  if (parsed.data.decision === "APPROVED") {
    await prisma.monthRoster.upsert({
      where: { employeeId_workDate: { employeeId: claim.employeeId, workDate: claim.workDate } },
      update: {
        status: "WORK",
        shiftTypeId: claim.shiftTypeId ?? undefined,
        updatedBy: session.user.email ?? undefined,
      },
      create: {
        employeeId: claim.employeeId,
        workDate: claim.workDate,
        status: "WORK",
        shiftTypeId: claim.shiftTypeId ?? null,
        createdBy: session.user.email ?? undefined,
      },
    });
  }

  return NextResponse.json(updated);
}
