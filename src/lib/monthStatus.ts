import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/auditLog";
import {
  isValidMonth,
  type DeliveryFailure,
  type DeliverySkipped,
  type DeliverySummary,
  type MonthStatus,
  type MonthStatusInfo,
} from "@/lib/monthStatusShared";

// 月ごとの勤務スケジュールの「調整中／確定」の管理（DB: MonthRosterConfirmation.status）。
//
//   調整中 … 行がない、または status = ADJUSTING。従業員にはシフト内容を一切返さない。
//   確定   … status = CONFIRMED。「メール配信」が正常に完了した月だけ。
//
// 状態が変わるのは次の3か所だけ（メール送信ログからの推測はしない）。
//   1. メール配信が全員に成功した      → CONFIRMED            （finishDelivery）
//   2. 確定後にシフトが修正された      → ADJUSTING + 再配信が必要（markMonthsRevised）
//   3. 配信が失敗・一部失敗した        → 確定にしない（既に確定済みの月はそのまま）

type Db = Prisma.TransactionClient | typeof prisma;

export type DeliveryResultJson = {
  mode: string | null;
  // この版（revision）のシフトについて、確定メールを送信できた従業員ID。再送時に二重送信しないために使う
  sentEmployeeIds: string[];
  failures: DeliveryFailure[];
  skippedNoEmail: DeliverySkipped[];
};

export async function getMonthStatus(month: string, db: Db = prisma): Promise<MonthStatus> {
  if (!isValidMonth(month)) return "ADJUSTING";
  const row = await db.monthRosterConfirmation.findUnique({ where: { month }, select: { status: true } });
  return row?.status === "CONFIRMED" ? "CONFIRMED" : "ADJUSTING";
}

function summarize(row: {
  lastDeliveryAt: Date | null;
  lastDeliveryResult: Prisma.JsonValue | null;
}): DeliverySummary | null {
  if (!row.lastDeliveryAt || !row.lastDeliveryResult) return null;
  const r = row.lastDeliveryResult as unknown as Partial<DeliveryResultJson>;
  return {
    at: row.lastDeliveryAt.toISOString(),
    mode: r.mode ?? null,
    sent: r.sentEmployeeIds?.length ?? 0,
    failed: r.failures?.length ?? 0,
    skippedNoEmail: r.skippedNoEmail?.length ?? 0,
    failures: r.failures ?? [],
  };
}

// 画面・API向けの状態。forManager=false（従業員）には、配信結果や修正者などの内部情報を含めない。
export async function getMonthStatusInfo(month: string, forManager: boolean, db: Db = prisma): Promise<MonthStatusInfo> {
  const row = isValidMonth(month) ? await db.monthRosterConfirmation.findUnique({ where: { month } }) : null;
  const status: MonthStatus = row?.status === "CONFIRMED" ? "CONFIRMED" : "ADJUSTING";
  const info: MonthStatusInfo = {
    month,
    status,
    needsRedelivery: status === "ADJUSTING" && !!row?.revisedAfterConfirm,
    confirmedAt: status === "CONFIRMED" && row?.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
  if (forManager) {
    info.revisedAt = row?.revisedAt ? row.revisedAt.toISOString() : null;
    info.lastDelivery = row ? summarize(row) : null;
  }
  return info;
}

// シフト（MonthRoster）を修正したAPIから呼ぶ。確定済みの月は「調整中」に戻し、再配信が必要な状態にする。
// 調整中の月は revision だけ進める（配信失敗後の再送で、古い版の「送信済み」を引き継がないため）。
// 行がない月（一度も配信されていない月）は何もしない。トランザクション内で呼ぶ場合は tx を渡す。
export async function markMonthsRevised(months: Iterable<string>, by?: string | null, db: Db = prisma): Promise<string[]> {
  const reverted: string[] = [];
  for (const month of new Set(months)) {
    if (!isValidMonth(month)) continue;
    await db.monthRosterConfirmation.updateMany({
      where: { month, status: "ADJUSTING" },
      data: { revision: { increment: 1 } },
    });
    const res = await db.monthRosterConfirmation.updateMany({
      where: { month, status: "CONFIRMED" },
      data: {
        status: "ADJUSTING",
        revisedAfterConfirm: true,
        revisedAt: new Date(),
        revisedBy: by ?? null,
        revision: { increment: 1 },
      },
    });
    if (res.count > 0) {
      reverted.push(month);
      await writeAudit(db, {
        tableName: "MonthRosterConfirmation",
        recordId: month,
        action: "MONTH_REVERTED_TO_ADJUSTING",
        changedBy: by ?? null,
        oldValue: { status: "CONFIRMED" },
        newValue: { status: "ADJUSTING", reason: "確定後にシフトが修正されたため" },
      });
    }
  }
  return reverted;
}

export type RecipientStatus = "SENT" | "UNSENT" | "FAILED" | "NO_EMAIL";
export type RecipientRow = {
  employeeId: string;
  fullName: string;
  email: string | null;
  status: RecipientStatus;
  reason?: string;
};

// ASK②の配信対象者一覧。送信済み／未送信／送信失敗は、現在のシフトの版（revision）に対する直近の配信結果から決める。
// シフトが修正されると版が進むため、全員「未送信」に戻る（再配信が必要）。
export async function listRecipients(month: string, db: Db = prisma): Promise<RecipientRow[]> {
  const [employees, row] = await Promise.all([
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, contactEmail: true } }),
    isValidMonth(month) ? db.monthRosterConfirmation.findUnique({ where: { month } }) : Promise.resolve(null),
  ]);
  const valid = !!row && row.lastDeliveryRevision === row.revision && !!row.lastDeliveryResult;
  const r = (valid ? (row!.lastDeliveryResult as unknown as Partial<DeliveryResultJson>) : {}) as Partial<DeliveryResultJson>;
  const sent = new Set(r.sentEmployeeIds ?? []);
  const failed = new Map((r.failures ?? []).map((f) => [f.employeeId, f.reason]));
  return employees.map((e) => {
    if (!e.contactEmail) return { employeeId: e.id, fullName: e.fullName, email: null, status: "NO_EMAIL" as const };
    if (sent.has(e.id)) return { employeeId: e.id, fullName: e.fullName, email: e.contactEmail, status: "SENT" as const };
    if (failed.has(e.id)) return { employeeId: e.id, fullName: e.fullName, email: e.contactEmail, status: "FAILED" as const, reason: failed.get(e.id) };
    return { employeeId: e.id, fullName: e.fullName, email: e.contactEmail, status: "UNSENT" as const };
  });
}

export type DeliveryStart = {
  revision: number;
  // 前回の配信で既に送信できていて、今回は送らない従業員（同じ版のシフトに限る）
  alreadySentIds: Set<string>;
};

// 配信前に呼ぶ。配信中にシフトが修正されたかを後で判定できるよう、開始時の版を返す。
// resendAll=false のとき、同じ版で前回一部だけ失敗していた場合に限り、送信済みの人を飛ばす。
export async function startDelivery(month: string, resendAll: boolean, db: Db = prisma): Promise<DeliveryStart> {
  const row = await db.monthRosterConfirmation.findUnique({ where: { month } });
  if (!row) return { revision: 0, alreadySentIds: new Set() };
  let alreadySentIds = new Set<string>();
  if (!resendAll && row.status === "ADJUSTING" && row.lastDeliveryRevision === row.revision && row.lastDeliveryResult) {
    const r = row.lastDeliveryResult as unknown as Partial<DeliveryResultJson>;
    alreadySentIds = new Set(r.sentEmployeeIds ?? []);
  }
  return { revision: row.revision, alreadySentIds };
}

export type FinishDeliveryInput = {
  month: string;
  by?: string | null;
  startRevision: number;
  mode: string | null;
  sentEmployeeIds: string[]; // 今回送信できた人 + 前回までに送信済みの人
  failures: DeliveryFailure[];
  skippedNoEmail: DeliverySkipped[];
  // 配信対象（メール登録あり）の人数。0人なら「配信が完了した」とは言えないので確定しない
  targetCount: number;
};

export type FinishDeliveryOutcome = {
  confirmed: boolean;
  status: MonthStatus;
  // 確定にならなかった理由（confirmed=true のときは null）
  reason: "NO_RECIPIENTS" | "SEND_FAILED" | "NOT_ALL_SENT" | "REVISED_DURING_DELIVERY" | null;
};

// 配信後に呼ぶ。全員に送信できたときだけ「確定」にする。1通でも失敗したら確定にしない。
export async function finishDelivery(input: FinishDeliveryInput, db: Db = prisma): Promise<FinishDeliveryOutcome> {
  const { month, by, startRevision, mode, sentEmployeeIds, failures, skippedNoEmail, targetCount } = input;
  const now = new Date();
  const current = await db.monthRosterConfirmation.findUnique({ where: { month } });
  const currentRevision = current?.revision ?? 0;

  const resultJson: DeliveryResultJson = { mode, sentEmployeeIds, failures, skippedNoEmail };
  const record = {
    lastDeliveryAt: now,
    lastDeliveryRevision: startRevision, // 配信開始時の版。配信中に修正されたら版が合わなくなり「送信済み」は無効になる
    lastDeliveryResult: resultJson as unknown as Prisma.InputJsonValue,
  };

  let reason: FinishDeliveryOutcome["reason"] = null;
  if (targetCount === 0 || sentEmployeeIds.length === 0) reason = "NO_RECIPIENTS";
  else if (failures.length > 0) reason = "SEND_FAILED";
  else if (sentEmployeeIds.length < targetCount) reason = "NOT_ALL_SENT"; // 送信対象を絞った等で、未送信の人が残っている
  else if (currentRevision !== startRevision) reason = "REVISED_DURING_DELIVERY";

  if (reason === null) {
    await db.monthRosterConfirmation.upsert({
      where: { month },
      create: { month, status: "CONFIRMED", confirmedAt: now, confirmedBy: by ?? null, revisedAfterConfirm: false, ...record },
      update: { status: "CONFIRMED", confirmedAt: now, confirmedBy: by ?? null, revisedAfterConfirm: false, ...record },
    });
    await writeAudit(db, {
      tableName: "MonthRosterConfirmation",
      recordId: month,
      action: "MONTH_CONFIRMED",
      changedBy: by ?? null,
      oldValue: { status: current?.status ?? "ADJUSTING" },
      newValue: { status: "CONFIRMED", sent: sentEmployeeIds.length, mode },
    });
    return { confirmed: true, status: "CONFIRMED", reason: null };
  }

  // 確定にしない。行がなければ「調整中」の行として配信結果だけ残す（再送時に送信済みの人を飛ばすため）。
  // 既に確定済みの月で再配信が失敗した場合は、確定のまま（配信結果だけ更新）。
  if (current) {
    await db.monthRosterConfirmation.update({ where: { month }, data: record });
  } else {
    await db.monthRosterConfirmation.create({ data: { month, status: "ADJUSTING", confirmedAt: null, ...record } });
  }
  const status: MonthStatus = current?.status === "CONFIRMED" ? "CONFIRMED" : "ADJUSTING";
  await writeAudit(db, {
    tableName: "MonthRosterConfirmation",
    recordId: month,
    action: "MONTH_DELIVERY_NOT_CONFIRMED",
    changedBy: by ?? null,
    newValue: { reason, sent: sentEmployeeIds.length, failed: failures.length, mode },
  });
  return { confirmed: false, status, reason };
}
