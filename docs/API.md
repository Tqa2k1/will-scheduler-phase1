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

### POST `/api/shift-types` / PATCH・DELETE `/api/shift-types/[id]`（管理者のみ）
- シフト名(`code`)・`defaultStartTime`・`defaultEndTime`・基本必要人数(`requiredCount`)・時間帯別必要人数(`timeBands: [{startTime,endTime,requiredCount}]`)を作成/更新。PATCHで`timeBands`を送ると丸ごと置換。
- 時間帯はシフトの時間内・重複不可。使用中（勤務表/希望申請/ローテーションパターン）のシフトはDELETE不可(409)。

### GET `/api/schedule/required-headcount`
- シフト必要人数設定から求めた、1時間スロット（営業日インデックス0=4:00…23）ごとの必要人数の合計 `{ totalBySlot: number[] }`。

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

> v20: 両AI APIとも `prompt` は1000文字まで。プロジェクト知識とその月の整理済みメモを自動で付与（`AiMemory`）。権限は従来どおり管理者のみ。

### POST `/api/shift-claims/ai-confirm`（v20・INC/ADMINのみ）
- `{ mode:"preview", month:"YYYY-MM", prompt? }` → AIが対象（従業員名・期間）を判断して確定案を返す。DBは変更しない。`result.signature` と `scope` を返す。
- `{ mode:"execute", month, signature, scope }` → 既存の一括確定を実行。成功時 `confirmed[]`（確定した勤務希望）と `notConfirmed[]`（不採用・保留・要確認と理由）。署名不一致は409、失敗は理由つきエラー。

### POST `/api/roster/ai-assist`
- 権限: ADMINのみ。
- 入力: `month, prompt?`。
- 処理: OpenAI API（`openai`）を使い、月間ローテーションのAI変更提案を生成する。
- 出力: `message, changes[]`（`employeeId, employeeName, date, newStatus`）。在籍中の従業員・対象月内の日付・有効なステータスのみに検証済み。DBは変更しない。

### POST `/api/schedule/ai-assist`
- 権限: ADMINのみ（2026-09 追加）。日別スケジュールのAI追加。
- 入力: `date, prompt?`。
- 処理: その日の勤務者・現在の割当て・配置状況（不足）・有効な業務一覧をAIに渡し、割当て変更案を生成する（共通処理 `src/lib/aiAssist.ts`）。DBは変更しない。
- 出力: `message, changes[]`（`employeeId, employeeName, start, slotIdx, cartPositionId, positionCode, positionName`）。適用は画面から `POST /api/schedule`（手動編集と同じ保存処理）で行う。

### POST `/api/roster/apply-ai-changes`
- 権限: ADMINのみ（2026-08 追加）。
- 処理: `ai-assist`が提案した変更（`changes[]`、`employeeName`ベース）をMonthRosterに適用する。

### POST `/api/ai-confirm`
- 権限: ADMINのみ（2026-08 追加）。
- 入力: `employeeName, date, newStatus`。
- 処理: 氏名で従業員を検索し、`MonthRoster.updateMany`でステータスを更新する。

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

### GET `/api/shift-claims/my-month?month=YYYY-MM`（2026-10追加）
- 権限: 従業員本人。STEP2「勤務希望登録」画面用。自分の名前・対象月の人員不足日（INCが確定したスナップショットのみ）・自分の登録状況・登録締切（前月10日）を返す。他人の情報は返さない。

## 人員不足の確定とGmail通知（2026-10追加）

### GET `/api/shortage/preview?month=YYYY-MM`
- 権限: ADMINのみ。確定前の確認用（何も保存・送信しない）。不足一覧・登録締切・1回目メールの送信対象人数（役割=バイト）・メール未登録のスキップ予定者・送信済み日時・メール送信モードを返す。

### POST `/api/shortage/confirm`
- 権限: ADMINのみ。入力: `{ month, notify?: true, resend?: false }`。
- 不足を確定（`ShiftAdjustmentConfirmation`を上書き）し、`notify=true` なら役割が `PARTTIME` の在籍従業員のみに1回目Gmailを送信。メール未登録者はスキップして `skippedNoEmail` に返し、`notifyResult` にも保存。
- 送信済みの月は `resend=true` でない限り 409（二重送信防止）。

### POST `/api/roster/shift-adjustment/send-emails`（2回目メール）
- 選択された従業員へ、不足している日時ごとに1通ずつ「勤務可否のご確認」を送信。送信できた人のみ `ShiftClaimRequest(INVITED)` を記録。メール未登録者はスキップ。

### メール送信モード（環境変数 `MAIL_MODE`）
- `live` / `dry-run` / `test`。未設定時は本番(`NODE_ENV=production`)のみ `live`、それ以外は `dry-run`（実送信せずログのみ）。`test` は宛先を `MAIL_TEST_TO` に差し替える。

### 閲覧範囲（GET `/api/roster`, `/api/export/roster-excel`, `/api/employees`）
- 一般従業員: 月の状態が「確定」（`MonthRosterConfirmation.status=CONFIRMED`）の月のみ全員分（シフト情報のみ・閲覧のみ）。「調整中」の月はシフトデータを一切返さない。`GET /api/roster/month-status?month=` は状態のみ返す。`GET/POST /api/roster/confirm-month` は管理者・INCのみ（GET=配信前の宛先・プレビュー、POST=メール配信。全員成功時のみ確定）。`/api/employees` はADMINのみ。

## エクスポート

### GET `/api/export/roster-excel?month=2026-07`
- 月間勤務表をExcel（.xlsx）で出力（`exceljs`）。

### GET `/api/export/schedule-excel?date=2026-07-01`
- 日別スケジュールをExcelで出力。

### GET `/api/export/schedule-pdf?date=2026-07-01`
- 日別スケジュールをPDFで出力（`pdfkit`）。

## ✅ 修正済み（2026-08）
- `/api/roster/apply-ai-changes` と `/api/ai-confirm` に `getServerSession` + ADMIN権限チェックを追加した
  （未認証の第三者が勤務表を書き換えられる脆弱性だった）。他の全APIルートも
  `getServerSession` の有無を全件スキャンし、NextAuthのハンドラ自体を除き漏れがないことを確認済み。


## 2026-10 v18 追加・変更
- `GET /api/shift-claims/registration-hold?month=YYYY-MM` → `{month,isStopped}`（ログイン済みなら誰でも）。`POST`（INC/ADMINのみ）body `{month, stopped:boolean}`。従業員は403、不正な月は400。
- `POST /api/shift-claims` … 対象月が停止中なら403 `{registrationStopped:true}`。
- `GET /api/shift-claims/my-month` … `registrationStopped` を追加。
- `GET /api/shift-claims?month=` … 確定前の自己キャンセル分は返さない。`slots[].requested`（希望人数）を追加、`registrationStopped` を追加。
- `GET /api/shortage/preview` … `gaps[].requested` を追加。
- `POST /api/shift-claims/:id/cancel` … 変更なし（PENDING→即時、APPROVED→取消申請）。

## 2026-10 v19 変更
- `POST /api/users` … `employeeId` を指定する場合 `name` は省略可（表示名は従業員の氏名になる）。紐付けなしは `name` 必須（400）。
- `PATCH /api/users/:id` … 従業員に紐付いているアカウントの `name` 直接変更は無視（従業員の氏名が正）。紐付け変更時に表示名を従業員の氏名へ同期。
- `PATCH /api/employees/:id` … `fullName` 変更時、紐付いているアカウントの `User.name` を同期。
- 画面URL: `/employees`→`/users`、`/shift-settings`→`/tasks?tab=hours` へリダイレクト。`/account/password` を追加。
