import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/auditLog";
import { isValidMonth } from "@/lib/monthStatusShared";

// 対象月ごとの勤務希望の「登録停止／再開」。行がない月は受付中。月は勤務日の属する月（"YYYY-MM"）。
// 日付・月の判定はJST基準（勤務日は日付文字列のまま扱い、UTC/JSTのずれを持ち込まない）。

export async function isRegistrationStopped(month: string): Promise<boolean> {
  if (!isValidMonth(month)) return false;
  const row = await prisma.claimRegistrationHold.findUnique({ where: { month } });
  return !!row?.isStopped;
}

export async function setRegistrationStopped(month: string, stopped: boolean, by?: string | null): Promise<{ month: string; isStopped: boolean }> {
  const row = await prisma.claimRegistrationHold.upsert({
    where: { month },
    update: { isStopped: stopped, updatedBy: by ?? null },
    create: { month, isStopped: stopped, updatedBy: by ?? null },
  });
  await writeAudit(prisma, {
    tableName: "ClaimRegistrationHold",
    recordId: month,
    action: stopped ? "CLAIM_REGISTRATION_STOP" : "CLAIM_REGISTRATION_RESUME",
    changedBy: by ?? null,
    newValue: { isStopped: stopped },
  });
  return { month: row.month, isStopped: row.isStopped };
}

export function stoppedMessage(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月の勤務希望登録は現在停止中です`;
}
