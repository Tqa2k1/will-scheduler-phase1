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
- 権限: ADMINのみ。業務の新規作成。`slotUnitMinutes`（30 or 60、既定60）を指定可能。

### PATCH `/api/cart-positions/:id`
- 権限: ADMINのみ。業務の更新。`slotUnitMinutes`の変更も可能。

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
- 権限: ADMINのみ。30分単位で`slotStart`/`slotEnd`を指定して手動割当て（2026-08〜）。
  業務の`slotUnitMinutes`（既定60）に応じてdurationを検証: 60分限定の業務は必ず60分、
  30分許可の業務は30分または60分。上書きする範囲に重なる既存レコードは自動的に削除される。

### POST `/api/schedule/auto-assign`
- 権限: ADMINのみ。
- 入力: `{ date }`
- 処理: `buildAutoAssignPlan()`（`src/lib/autoAssign.ts`）で1日分の自動割当てプランを計算し、
  既存の割当てを削除→一括作成（トランザクション）。詳細は AUTO_ASSIGN_RULES.md。
- 出力: `{ success, shortageCount, assignedCount }`

### GET `/api/schedule/auto-assign?month=2027-01`
- 権限: ADMINのみ。指定月に既にDailyAssignmentデータがあるか確認する軽量エンドポイント。
- 出力: `{ existingCount }`

## 勤務希望申請（ShiftClaimRequest）／ 希望勤務(KIBO)（2026-08〜desiredStartTime/EndTime対応）

### GET `/api/shift-claims`
- ADMIN: 承認待ちの申請一覧(`pending`) + KIBO時間帯付きも含む全件一覧(`all`、最大200件)。
- EMPLOYEE: 今後30日で人員不足の日のうち、自分が未出勤・未申請の日一覧（不足人数つき）+
  自分の申請履歴 + KIBO登録の受付可否(`kiboWindow`: 対象月・受付中かどうか・締切日)。

### POST `/api/shift-claims`
- 権限: ログイン済み（EMPLOYEE想定）。
- 入力: `{ workDate, desiredStartTime?, desiredEndTime? }`
- `desiredStartTime`/`desiredEndTime`省略時: 従来通り、人員不足の日への出勤申請（締切なし）。
- 両方指定時: 希望勤務(KIBO)登録。翌月分のみ・当月10日までの受付（`src/lib/kiboWindow.ts`）。

### PATCH `/api/shift-claims/:id`
- 権限: ADMINのみ。申請の承認/却下。KIBO（時間帯指定あり）を承認した場合、対応する
  `ShiftType`（早番/遅番/明番）もMonthRosterに反映する。

## シフト調整・希望勤務(KIBO)（2026-08追加）

### GET `/api/shift-adjustment?date=2026-08-20`
- 権限: ADMINのみ。指定日の3ダイヤ（早番/遅番/明番、各4名）の必要人数・出勤予定人数・不足数を返す。

### GET `/api/shift-adjustment`（dateなし）
- 権限: ADMINのみ。今後30日のうち、いずれかのダイヤが不足している日の一覧を返す。

### POST `/api/shift-adjustment`
- 権限: ADMINのみ。
- 入力: `{ date, windowCode }`（windowCodeは"早番"/"遅番"/"明番"）
- 処理: 出勤できそうな候補者（`findEligibleEmployeesForWindow`）にメールを送信し、
  `RosterAuditLog`に送信履歴を記録する。

## 従業員個人優先順位（2026-08追加）

### GET `/api/employee-priorities`
- 権限: ログイン済み。全アクティブ従業員の`role`と`priorityOrder`一覧（優先順位昇順）。

### PATCH `/api/employee-priorities`
- 権限: ADMINのみ。`{ items: [{employeeId, priorityOrder}] }`で一括更新。

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
