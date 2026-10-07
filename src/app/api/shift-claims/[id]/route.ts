import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const DecisionInput = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

// PATCH /api/shift-claims/:id
//  - 管理者: 本人が申請した内容（status=PENDING）を承認/却下する。
//  - 従業員本人: INCから届いた招待（status=INVITED、まだ本人は未回答）を「辞退」できる
//    （decision=REJECTED のみ。承認や、他人の申請の操作は不可）。これにより、メールを
//    送っただけの状態と、本人の意思表示（辞退）を区別してINC側に正しく反映する。
// 承認した場合のみ、月間勤務表(MonthRoster)にWORKとして反映される。却下・辞退した場合は何も変更しない。
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body = await req.json();
  const parsed = DecisionInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const claim = await prisma.shiftClaimRequest.findUnique({ where: { id: params.id } });
  if (!claim) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });

  const isSelfDecline =
    session.user.role === "EMPLOYEE" &&
    session.user.employeeId === claim.employeeId &&
    claim.status === "INVITED" &&
    parsed.data.decision === "REJECTED";

  if (session.user.role !== "ADMIN" && !isSelfDecline) {
    return NextResponse.json({ error: "申請の承認・却下は管理者のみ可能です" }, { status: 403 });
  }
  if (session.user.role === "ADMIN" && claim.status !== "PENDING") {
    return NextResponse.json({ error: "この申請は既に処理済みです" }, { status: 409 });
  }

  const updated = await prisma.shiftClaimRequest.update({
    where: { id: params.id },
    data: { status: parsed.data.decision, decidedAt: new Date(), decidedBy: session.user.email ?? undefined },
  });

  if (parsed.data.decision === "APPROVED") {
    // 希望勤務(KIBO)で従業員が「何時から何時まで」を指定していた場合は、その時間を
    // この日だけの時間変更(override)として月間勤務表に反映する。未指定ならシフト区分の時間をそのまま使う。
    await prisma.monthRoster.upsert({
      where: { employeeId_workDate: { employeeId: claim.employeeId, workDate: claim.workDate } },
      update: {
        status: "WORK",
        shiftTypeId: claim.shiftTypeId ?? undefined,
        overrideStartTime: claim.requestedStartTime ?? undefined,
        overrideEndTime: claim.requestedEndTime ?? undefined,
        updatedBy: session.user.email ?? undefined,
      },
      create: {
        employeeId: claim.employeeId,
        workDate: claim.workDate,
        status: "WORK",
        shiftTypeId: claim.shiftTypeId ?? null,
        overrideStartTime: claim.requestedStartTime ?? null,
        overrideEndTime: claim.requestedEndTime ?? null,
        createdBy: session.user.email ?? undefined,
      },
    });
  }

  return NextResponse.json(updated);
}
