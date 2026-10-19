-- =====================================================================
-- 2026-10-19  月ごとの勤務スケジュール確定状態（調整中 / 確定）を明示的に保存する
--
-- 対象: "MonthRosterConfirmation"（既存テーブルに列を追加するだけ。テーブル・行は削除しない）
-- 互換性:
--   * 既存の行（旧仕様で「確定」を押した月）は status = 'CONFIRMED' のまま引き継がれる
--   * 行が無い月は「調整中」として扱う（アプリ側）
--   * 何度実行しても安全（IF NOT EXISTS / 重複時は無視）
-- 適用方法（どちらか）:
--   1) npm run build / npx prisma db push  … schema.prisma から同じ変更を自動適用（通常はこちら）
--   2) psql "$DATABASE_URL" -f prisma/sql/2026-10-19_month_roster_status.sql  … 手動で適用する場合
-- =====================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE "RosterMonthStatus" AS ENUM ('ADJUSTING', 'CONFIRMED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "MonthRosterConfirmation"
  ADD COLUMN IF NOT EXISTS "status"               "RosterMonthStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS "revisedAfterConfirm"  BOOLEAN             NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "revisedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revisedBy"            TEXT,
  ADD COLUMN IF NOT EXISTS "revision"             INTEGER             NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastDeliveryAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastDeliveryRevision" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastDeliveryResult"   JSONB,
  ADD COLUMN IF NOT EXISTS "updatedAt"            TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 「ADJUSTING のまま未確定」の行は確定日時を持たないため、NOT NULL / 既定値を外す（既存の値はそのまま）
ALTER TABLE "MonthRosterConfirmation" ALTER COLUMN "confirmedAt" DROP NOT NULL;
ALTER TABLE "MonthRosterConfirmation" ALTER COLUMN "confirmedAt" DROP DEFAULT;

COMMIT;

-- ---------------------------------------------------------------------
-- 元に戻す場合（参考。通常は不要）:
--   ALTER TABLE "MonthRosterConfirmation"
--     DROP COLUMN "status", DROP COLUMN "revisedAfterConfirm", DROP COLUMN "revisedAt", DROP COLUMN "revisedBy",
--     DROP COLUMN "revision", DROP COLUMN "lastDeliveryAt", DROP COLUMN "lastDeliveryRevision",
--     DROP COLUMN "lastDeliveryResult", DROP COLUMN "updatedAt";
--   DELETE FROM "MonthRosterConfirmation" WHERE "confirmedAt" IS NULL;  -- 未確定の行を消してから
--   ALTER TABLE "MonthRosterConfirmation" ALTER COLUMN "confirmedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   ALTER TABLE "MonthRosterConfirmation" ALTER COLUMN "confirmedAt" SET NOT NULL;
--   DROP TYPE "RosterMonthStatus";
-- ---------------------------------------------------------------------
