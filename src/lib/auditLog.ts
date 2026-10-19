import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
  tableName?: string; // 省略時は ShiftClaimRequest
  recordId: string;
  action: string;
  changedBy?: string | null; // 実行したINC（管理者）アカウントのメールアドレス
  oldValue?: unknown;
  newValue?: unknown;
};

// 操作ログ（確定・変更・取消・メール送信）。どのアカウントが、いつ（changedAt は自動）実行したかを残す。
export async function writeAudit(db: Db, entries: AuditEntry | AuditEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await db.rosterAuditLog.createMany({
    data: list.map((e) => ({
      tableName: e.tableName ?? "ShiftClaimRequest",
      recordId: e.recordId,
      action: e.action,
      changedBy: e.changedBy ?? null,
      oldValue: (e.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (e.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
}
