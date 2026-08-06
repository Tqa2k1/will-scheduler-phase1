# API.md — WHILL Scheduler API一覧

> 全て `src/app/api/**/route.ts`。特記がない限り、未ログインは401、権限不足は403を返す。
> 入力バリデーションは`zod`（`safeParse`失敗時は400 + `error.flatten()`）。

## 認証

### POST/GET `/api/auth/[...nextauth]`
- 処理: NextAuth標準ハンドラ（Credentials Provider）。ログイン/ログアウト/セッション取得。
- ファイル: `src/app/api/auth/[...nextauth]/route.ts`, ロジックは `src/lib/auth.ts`。

## 従業員

### GET `/api/employees`
- 権限: ログイン済みなら誰でも。
- 出力: `Employee[]`（fullName昇順）。

### POST `/api/employees`
- 権限: ADMINのみ。
- 入力: `fullName, role, commuteType?, note?, baseStartTime?, baseEndTime?, contactEmail?`
- 処理: 従業員作成 + `RosterAuditLog`記録。

### PATCH `/api/employees/:id`
- 権限: ADMINのみ。従業員情報の更新。

### DELETE `/api/employees/:id`
- 権限: ADMINのみ。論理削除（`isActive = false`）。

## アカウント（User）

### GET `/api/users`
- 権限: ADMINのみ。アカウント一覧。

### POST `/api/users`
- 権限: ADMINのみ。新規アカウント作成。

### PATCH `/api/users/:id`
- 権限: ADMINのみ。紐付け従業員・表示名の変更。

## シフト種別

### GET `/api/shift-types`
- 権限: ログイン済み。`明番/早番/中番/遅番/超早/超遅` の一覧。

## 業務（CartPosition）

### GET `/api/cart-positions`
- 権限: ログイン済み。無効化された業務も含む全件（フィルタはフロント側）。

### POST `/api/cart-positions`
- 権限: ADMINのみ。業務の新規作成。

### PATCH `/api/cart-positions/:id`
- 権限: ADMINのみ。業務の更新。

### DELETE `/api/cart-positions/:id`
- 権限: ADMINのみ。業務の完全削除。

## 業務要件（TaskRequirement）

### GET `/api/task-requirements?cartPositionId=xxx`
- 権限: ログイン済み。`cartPositionId`省略時は全件。

### POST `/api/task-requirements`
- 権限: ADMINのみ。業務要件の作成。

### PATCH / DELETE `/api/task-requirements/:id`
- 権限: ADMINのみ。

## 優先順位（RolePriority）

### GET `/api/role-priorities`
- 権限: ログイン済み。

### PATCH `/api/role-priorities`
- 権限: ADMINのみ。自動バックフィル時の優先順位を一括更新。

## ローテーションパターン

### GET `/api/rotation-patterns`
- 権限: ログイン済み。4勤2休/3勤2休/5勤2休などの一覧。

## 月間勤務表（MonthRoster）

### GET `/api/roster?month=2026-07`
- 権限: ログイン済み。`{ employees, entries }` を返す（対象月の全アクティブ従業員＋MonthRosterエントリ）。

### POST `/api/roster`
- 権限: ADMINのみ。
- 入力: `employeeId, workDate, shiftTypeId?, status?, overrideStartTime?, overrideEndTime?`（部分更新対応）。
- 副作用: `status`がWORK以外（公休/有休/調整休）に変わった場合、
  `attemptBackfillOnRosterChange()`（`src/lib/autoBackfill.ts`）を呼び、その日の担当業務を
  他の出勤者で自動的に埋め直す。

### POST `/api/roster/apply-pattern`
- 権限: ADMINのみ。
- 処理: ローテーションパターンを対象期間に適用。既に有休/調整休が入っている日は上書きしない。
  `continueToYearEnd=true` で、選択月以降・同年12月末まで自動継続（既存データがある月は
  `overwriteExisting=true`でない限りスキップ）。

### POST `/api/roster/confirm-month`
- 権限: ADMINのみ。月間スケジュールの確定処理（メール通知を伴う想定。`src/lib/mailer.ts`参照）。

### POST `/api/roster/ai-assist`
- 権限: ADMINのみ。
- 入力: `month, prompt?`。
- 処理: Groq API（`groq-sdk`）を使い、月間ローテーションのAI変更提案を生成する。

### POST `/api/roster/apply-ai-changes`
- 処理: `ai-assist`が提案した変更（`changes[]`、`employeeName`ベース）をMonthRosterに適用する。
- ⚠️ 注意: このルートには `getServerSession` によるログイン/権限チェックが実装されていない
  （他の管理系APIと異なる）。要確認・要修正候補（TODO.md参照）。

### POST `/api/ai-confirm`
- 入力: `employeeName, date, newStatus`。
- 処理: 氏名で従業員を検索し、`MonthRoster.updateMany`でステータスを更新する。
- ⚠️ 注意: こちらも `getServerSession` によるログイン/権限チェックが実装されていない。

## 日別スケジュール（DailyAssignment）

### GET `/api/schedule?date=2026-07-01`
- 権限: ログイン済み（ADMIN/EMPLOYEE共通、閲覧内容は同じ）。
- 出力: `{ rosterItems, assignments }`（`buildDailyRosterView()` の結果 + その日のDailyAssignment一覧）。

### POST `/api/schedule`
- 権限: ADMINのみ。1時間スロット単位で業務を手動割当て。

### POST `/api/schedule/auto-assign`
- 権限: ADMINのみ。
- 入力: `{ date }`
- 処理: `buildAutoAssignPlan()`（`src/lib/autoAssign.ts`）で1日分の自動割当てプランを計算し、
  既存の割当てを削除→一括作成（トランザクション）。詳細は AUTO_ASSIGN_RULES.md。
- 出力: `{ success, shortageCount, assignedCount }`

### GET `/api/schedule/auto-assign?month=2027-01`
- 権限: ADMINのみ。指定月に既にDailyAssignmentデータがあるか確認する軽量エンドポイント。
- 出力: `{ existingCount }`

## 勤務希望申請（ShiftClaimRequest）

### GET `/api/shift-claims`
- ADMIN: 承認待ちの申請一覧。
- EMPLOYEE: 今後30日で人員不足の日のうち、自分が未出勤・未申請の日一覧（不足人数つき）+ 自分の申請履歴。

### POST `/api/shift-claims`
- 権限: ログイン済み（EMPLOYEE想定）。人員不足の日に出勤を申請する。

### PATCH `/api/shift-claims/:id`
- 権限: ADMINのみ。申請の承認/却下。

## エクスポート

### GET `/api/export/roster-excel?month=2026-07`
- 月間勤務表をExcel（.xlsx）で出力（`exceljs`）。

### GET `/api/export/schedule-excel?date=2026-07-01`
- 日別スケジュールをExcelで出力。

### GET `/api/export/schedule-pdf?date=2026-07-01`
- 日別スケジュールをPDFで出力（`pdfkit`）。

## ⚠️ 未確認・要確認事項
- `/api/roster/apply-ai-changes` と `/api/ai-confirm` は認証チェックが無いように見える
  （他のADMIN専用APIと実装パターンが異なる）。セキュリティ上のリスクの可能性があるため、
  `docs/TODO.md` に記載し、対応要否を確認すること。
