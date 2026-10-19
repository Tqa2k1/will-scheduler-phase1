-- AI依頼の整理済みメモ。新規テーブルのみ（既存データに影響なし）。何度実行しても安全。`prisma db push` でも同じ内容が反映される。
CREATE TABLE IF NOT EXISTS "AiMemory" (
  "id"        TEXT         NOT NULL,
  "scope"     TEXT         NOT NULL,
  "note"      TEXT         NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiMemory_scope_createdAt_idx" ON "AiMemory"("scope", "createdAt");
-- ロールバック: DROP TABLE "AiMemory";
