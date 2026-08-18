-- 2026-08-07: シフト調整/KIBO(希望勤務)/従業員個人優先順位/業務30分単位 対応
--
-- 注意: このプロジェクトはこれまで `prisma migrate` ではなく `prisma db push` で
-- スキーマを反映する運用だった（package.json の build スクリプト参照）。そのため
-- prisma/migrations フォルダはこれまで存在しなかった。今回は要件により、変更内容を
-- 明示的なSQLとして残すために手動でこのファイルを作成した。
--
-- 適用方法:
--   A) これまで通りの運用を続ける場合: このファイルは記録用として無視し、
--      `npx prisma db push` を実行すれば同じ内容がDBに反映される。
--   B) `prisma migrate` 運用に切り替える場合:
--      `npx prisma migrate resolve --applied 20260807000000_shift_adjustment_kibo_priority_slotunit`
--      で「適用済み」として登録してから、今後は `prisma migrate dev` を使う。
--
-- 影響範囲: 既存テーブルへの列追加（NULL許容 or デフォルト値あり）と新規テーブル追加のみ。
-- 既存データの削除・型変更・NOT NULL制約の追加は一切行っていない（既存データを壊さない）。

-- 1) ShiftClaimRequest: 希望勤務(KIBO)の希望時間帯（nullable。既存レコードはNULLのまま＝
--    従来の「その日ならいつでも」の人員不足申請として扱われる。挙動は変わらない）
ALTER TABLE "ShiftClaimRequest" ADD COLUMN "desiredStartTime" TEXT;
ALTER TABLE "ShiftClaimRequest" ADD COLUMN "desiredEndTime" TEXT;

-- 2) CartPosition: 業務の時間単位（デフォルト60分＝既存の全業務はそのまま1時間単位で動作する）
ALTER TABLE "CartPosition" ADD COLUMN "slotUnitMinutes" INTEGER NOT NULL DEFAULT 60;

-- 3) EmployeePriority: 従業員個人の優先順位（新規テーブル。役割優先順位(RolePriority)とは独立）
CREATE TABLE "EmployeePriority" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "priorityOrder" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePriority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeePriority_employeeId_key" ON "EmployeePriority"("employeeId");

ALTER TABLE "EmployeePriority" ADD CONSTRAINT "EmployeePriority_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
