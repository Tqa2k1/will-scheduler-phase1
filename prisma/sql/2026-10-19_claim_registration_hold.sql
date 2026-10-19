-- 勤務希望の登録停止／再開（対象月ごと）。既存テーブル・既存データには影響しない（新規テーブルのみ）。
-- 何度実行しても安全（IF NOT EXISTS）。`prisma db push` でも同じ内容が反映される。
CREATE TABLE IF NOT EXISTS "ClaimRegistrationHold" (
  "id"        TEXT        NOT NULL,
  "month"     TEXT        NOT NULL,
  "isStopped" BOOLEAN     NOT NULL DEFAULT true,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimRegistrationHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClaimRegistrationHold_month_key" ON "ClaimRegistrationHold"("month");
-- ロールバック: DROP TABLE "ClaimRegistrationHold";
