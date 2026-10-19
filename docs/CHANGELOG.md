# CHANGELOG - WHILL Scheduler

## 2026-10 (v20: AI機能の改善・ホームに「勤務希望確認」)

### AI機能（OpenAI連携は維持。`src/lib/aiAssist.ts` を中心に最小変更）
- **プロジェクト知識**: docs/・DBスキーマ・APIの権限・`src/lib` のコード地図から `src/lib/aiKnowledge.generated.ts` を自動生成（`npm run ai:knowledge`）。実行時はファイルを読まず、依頼内容に関連する部分だけを `src/lib/aiKnowledge.ts` が検索（キーワード＋日本語2文字）して、最大約1800文字をプロンプトに追加。基本ルール（権限・AIは提案のみ等）は常に付与。
- **更新の仕組み**: docs/コードを変えたら `npm run ai:knowledge`。`npm test` の先頭で `--check` が走り、古いと失敗する。
- **整理済みメモ**: 会話全文は保存しない。依頼の要点と結果の要約（160文字以内）を月ごとに最大20件（`AiMemory` テーブル、**追加のみ**）。次回は最新5件を参考情報として使う。重複・短すぎる依頼は保存しない。テーブル未作成でもAI依頼は止まらない。
- **速度・安定**: OpenAIクライアントの使い回し、タイムアウト40秒、再試行1回、temperature 0.2、依頼文は1000文字まで。
- **機密**: APIキーはサーバーの環境変数 `OPENAI_API_KEY` のみ。エラー文のキー断片はマスクし、401/429/タイムアウトは定型文で表示。キーはプロンプト・ログ・レスポンスに出さない。
- DB適用: `prisma db push`（または `prisma/sql/2026-10-19_ai_memory.sql`）。既存テーブルは変更なし。

### AI依頼で勤務希望を確定（v20追加）
- 「応募者の確認・勤務者の確定」の AI依頼 に **勤務希望の確定** を追加（勤務表の調整案と切り替え）。AIが文章だけ返して終わらないよう、OpenAI の Function Calling で `list_pending_employees` → `plan_confirmation` を呼ぶ。
- 選定・確定は既存の一括確定（`bulkConfirm` / `fairAssignment`）をそのまま使用。ルール（必要人数まで、合計労働時間の少ない人→優先順位、同日重複なし、バイトは週20時間まで、トランザクション、監査ログ）は不変。AIは人・期間の絞り込み（`BulkScope`）だけを決め、選び直しはしない。
- 流れ: ① `POST /api/shift-claims/ai-confirm {mode:"preview"}` で確定案（確定予定／不採用予定／確定できない理由／従業員×週の労働時間）を表示（保存なし） → ② 「この内容で確定する」→ `{mode:"execute", signature}` で実行。署名が一致しなければ何も確定しない。実行後はDBを読み直して APPROVED を確認し、確定した一覧と、確定されなかった分（対象日・理由）を表示。失敗時はエラーを表示し、成功とは表示しない。
- 権限: INC/ADMIN のみ（従業員403・未ログイン401）。

### ホーム
- INC/ADMINの「シフト作成」に **勤務希望確認** を追加（勤務表とアサイン表の間）。既存の `/shift-requests`（月・日付・シフト・従業員・状態で絞り込み）へ移動するだけで、新しいデータ・APIは追加していない。従業員のホームには出ない。

## 2026-10 (v19: 画面構成・名称・アイコンの整理、アカウント設定の統合 — 主に見た目)

内部コード名・APIパス・DBのテーブル/カラム/値は変更していない（スキーマ変更なし）。

### 名称変更の対応表
| 旧名称 | 新名称 | 画面・URL |
|---|---|---|
| 人数設定 | 勤務時間設定 | `/tasks?tab=hours`（スケジュール設定のタブ。旧 `/shift-settings` はリダイレクト） |
| 業務管理 | スケジュール設定 | `/tasks`（URL不変） |
| 「業務を作成」ボタン | スケジュール作成 | `/tasks` |
| 一覧の列「業務名」「コード」 | 表示名／業務内容（表示名のみ変更。DB: `CartPosition.name/code`） | `/tasks` |
| アカウント管理＋従業員管理 | アカウント設定 | `/users`（旧 `/employees` はリダイレクト） |
| （アカウント管理内のパスワード変更） | パスワード変更（独立画面） | `/account/password`。全ロール共通 |
| 月次自動割当て | アサイン作成 | 勤務表の操作ボタン（処理は同じ） |
| パターン適用 | パターン設定 | 勤務表の操作ボタン（処理は同じ） |
| ホーム「シフト作成」内の ASK①・ASK②・人数設定 | （削除・移動） | ASK①②は勤務表画面のボタンから（URL `/shortage`, `/roster/shift-adjustment` は不変） |

### 変更内容
- **ホーム**: 「シフト作成」（勤務表・アサイン表）と「各種設定」（スケジュール設定・アカウント設定・パスワード変更）。ボタン下の説明文を削除しアイコンを追加。従業員ホームは勤務表・アサイン表・勤務希望登録・パスワード変更。
- **勤務表**: ボタン順は ASK① → ASK② → アサイン作成 → Excel出力 → AI依頼 → パターン設定。「メール配信」は画面右下（sticky・スマホは全幅）。
- **スケジュール設定**: 一覧は 表示名／カラー／業務内容／区分／稼働時間 のみ。行クリックで編集モーダル（編集・要件を管理・停止/再開・削除）。停止中の行はグレー背景＋「停止中」ラベル。勤務時間設定は同画面のタブ（`ShiftSettingsPanel`）。
- **アカウント設定**: 従業員情報（氏名・役割・基本勤務時間・連絡先・優先順位）とログイン情報（ID・権限）を1画面で表示・編集。ログインを持たない従業員も表示。紐付けのないアカウントは別枠。アカウントの作成・削除は管理者のみ（従来どおり）。従業員情報の編集は管理者・INC。
- **氏名の正のデータ**: `Employee.fullName`。紐付け済みアカウントの `User.name` は、従業員の氏名変更時・紐付け時・アカウント作成時にサーバー側で自動同期（`syncUserNameFromEmployee`）。紐付けなしのアカウントは `User.name` が正。
- **アイコン**: 自前の `components/ui/Icon.tsx`（インラインSVG）を拡張。新規ライブラリなし。他社ロゴ不使用。
- **説明文の削除**: 操作方法・機能説明の文章を削除（一覧は最終報告）。通知・エラー・警告・確認・入力ルールは維持。
- **テスト**: `tests/ui-structure.test.ts` 追加（メニュー構成・リダイレクト・氏名同期・権限）。

## 2026-10 (v18: 勤務希望のキャンセル整理・登録の停止/再開・人数集計・ASK UI統一・Excel/PDF)

- **キャンセル**: 確定前は従業員が即時キャンセル（INC承認不要。INC一覧・希望人数・不足判定・ASK候補から除外、履歴は残す）。確定後はINC承認が必要（従来フロー維持）。
- **登録の停止/再開**: 月別。`/shift-requests`のINC画面から操作、APIでも登録・変更を403、従業員画面にバナー表示。新テーブル `ClaimRegistrationHold`（`prisma/sql/2026-10-19_claim_registration_hold.sql`、新規テーブルのみで後方互換）。API: `/api/shift-claims/registration-hold`、`my-month` に `registrationStopped`。
- **人数集計**: 選択シフト基準・重複なし・キャンセル除外。希望人数と確定人数を別表示（`src/lib/shiftHeadcount.ts`、`/api/shortage/preview` の `requested`、INC画面の slots.requested）。
- **ASK①/②**: 見出し・段階表示・確認ダイアログを統一（業務フロー不変）。
- **AI依頼**: 共通コンポーネント `AiAssistModal` として応募者の確認画面でも利用可能（既存API・設定を再利用、自動適用なし）。
- **PDF復旧**: pdfkit がバンドルされ `data/Helvetica.afm` が見つからず500になっていたのを `next.config.js` で外部パッケージ化＋フォントをトレース対象に追加して修正。
- **Excel**: 配色・罫線・フォント・列幅/行高・曜日色・業務色・印刷設定（A4横・1ページ幅・見出し繰り返し・フッター）をWeb画面に合わせた（`src/lib/excelStyle.ts`）。ライブラリはexceljsのまま（追加なし）。
- **ドキュメント**: `AGENTS.md`、`PROJECT_OVERVIEW.md`、`docs/WORKFLOWS.md`・`HEADCOUNT_RULES.md`・`PERMISSIONS.md`・`DATA_FLOW.md`・`TESTING.md` を追加。
- **テスト**: `tests/claims.test.ts` 追加、`logic.test.ts` に集計テスト追加。

## 2026-10 (v17: 従業員の勤務表を「調整中／確定」管理の全員閲覧に変更・ASK②の使いやすさ改善)

- **月の状態をDBで管理**: `MonthRosterConfirmation.status`（`ADJUSTING`=調整中 / `CONFIRMED`=確定）。メール送信ログからの推測はしない。行がない月は「調整中」。
  - 「メール配信」（`POST /api/roster/confirm-month`）が**全員分成功**したときだけ確定。1通でも失敗・配信先0人・配信中にシフトが修正された場合は確定にしない。
  - 確定後にシフトを修正（勤務表・パターン適用・AI反映・AI確定・勤務希望の承認／取消・一括確定）すると該当月だけ「調整中（再配信が必要）」に戻り、再配信の成功で再び確定。
- **従業員の勤務表**: 確定月だけ全員分の1か月分を閲覧のみで表示（氏名・シフト時間のみ。メール・電話・メモは返さない）。本人の行を最上部で強調。調整中の月は「調整中」とだけ表示し、APIもシフトデータを返さない（`/api/roster`・`/api/schedule`・各Excel/PDF出力）。従業員の勤務表から「人員不足」行を削除（勤務希望登録・INC/管理者側は変更なし）。
- **ASK②**: 4ステップ表示（①状況確認→②シフト調整→③配信内容確認→④メール配信）、不足日・未調整枠の一覧、月の状態バッジと「再配信が必要」表示、配信対象者の選択と送信済み／未送信／送信失敗、メール文面プレビュー、配信前の確認ダイアログ、失敗した宛先だけの再送（二重送信しない）。
- **メール**: 確定メールも `MAIL_MODE`（live / dry-run / test）と `MAIL_ALLOWLIST` に従う（従来は常に実送信）。文面は `src/lib/mailTemplates.ts` でプレビューと送信を共通化。
- **DB**: `MonthRosterConfirmation` に列追加 + enum `RosterMonthStatus`（`prisma/sql/2026-10-19_month_roster_status.sql`、`prisma db push` でも反映）。既存の行は「確定」のまま（互換）。
- **テスト/lint**: `npm test`（`tests/integration.test.ts` を追加。インメモリDBで従業員・INC・管理者の通しテスト）、`npm run lint`（eslint 導入）。

## 2026-10 (v16: 勤務表・アサイン表以外の画面デザイン刷新 — 見た目のみ)

UI UX Pro Max の「Minimalism & Swiss Style」に沿って、勤務表（`/roster`）とアサイン表（`/schedule/[date]`）以外の画面を統一デザインに更新。ロジック・API・権限・DB・URLは変更なし。

- 共通の見出し領域（`PageHeader`）を採用: パンくず「ホーム › ページ名」→ タイトル → 操作（月選択・実行ボタン）。旧「← ホームに戻る」リンクを置き換え（遷移先は同じ）。ASK② は「ホーム › 勤務表 › ASK②」。
- ページ余白・最大幅を `.app-page` に統一（勤務表・アサイン表には適用しない）。表は見出し行を面で区切り、行ホバーを追加。カードは影なし・細い枠線。
- 色を直書きしていた通知カードを `.msg--info / --warning / --error`（トークン参照）に置き換え、`role="status"/"alert"` を付与。
- ログイン画面を再設計（ブランド → フォーム → エラー → ボタン。ラベル紐付け・`autoComplete` 追加）。ホームのヘッダーと集計カードを整理。
- 対象: ログイン / ホーム / 人数設定 / ASK① / ASK② / 勤務希望登録・履歴 / 応募者の確認・勤務者の確定 / 業務管理 / 従業員管理 / アカウント管理。

## 2026-10 (v15: デザインシステムの刷新 — 見た目のみ)

UI UX Pro Max（https://github.com/nextlevelbuilder/ui-ux-pro-max-skill）の「Minimalism & Swiss Style」（業務アプリ/ダッシュボード向け）に合わせて配色・書体・操作感を更新。機能・ロジック・DB・権限・URLは変更なし。

- `src/app/globals.css` のデザイントークンを更新: Primary `#2563eb`（hover `#1d4ed8`）/ 背景 `#f8fafc` / 文字 `#0f172a` / 補助文字 `#475569` / 枠線 `#e4ecfc` / 成功色を緑系（`#047857`）/ 情報色を青系。文字と背景のコントラストは4.5:1以上。
- 書体: 欧文・数字に Inter（`layout.tsx` で `next/font` 読み込み）、日本語は従来どおり Noto Sans JP にフォールバック。表内の数字は等幅数字（`tabular-nums`）。
- 操作できる要素に `cursor: pointer` を統一（フォーカス表示・`prefers-reduced-motion` は従来どおり維持）。
- 各画面のレイアウト・コンポーネント構造・文言は変更なし（トークン経由で自動的に反映）。

## 2026-10 (v14: 表示名の統一・ホーム画面のボタン直接表示)

表示名とホーム画面のレイアウトのみの変更。業務ロジック・認証/権限・DB・URL（ルート）・APIは変更なし。

- サイト名の表記を「A SIGN」→「Assign」に統一（タブ名・ログイン画面・ホーム・メールの送信者名/件名）。
- 画面上の表示名を変更: ダッシュボード→ホーム / 月間勤務表→勤務表 / 月間スケジュール確定→メール配信 / シフト調整→ASK② /
  AI追加→AI依頼 / 日別スケジュール→アサイン表 / 人員不足を確定→ASK① / シフト必要人数設定→人数設定。
  （ボタン名・見出し・戻るリンク・案内文・エラーメッセージ・PDFタイトルが対象。コード内コメント、AIへの指示文、「〜を実行」「〜してGmail送信」などの動作名は変更なし）
- ホーム画面（`/dashboard`）から「連絡先」「事象発生時の連絡フロー」「ご確認ください」（予約表確認・TELの注意）を削除（`ContactPanel.tsx` と関連CSS）。
- ホーム画面のメニュー（☰）を廃止し、各機能のボタンを直接表示（`NavMenu.tsx` を削除、`LogoutButton.tsx` を追加）。
  表示条件は従来どおり（管理者/INC・従業員・全員の区別は `isManagerRole` / ロール判定のまま）。ログアウトはヘッダーに直接配置。
- 未使用だった旧メニュー `dashboard.tsx`（DashboardMenu）を削除。

## 2026-10 (v13: 勤務希望の取消・公平な一括確定・メール送信履歴・INC権限)

### DB変更（追加のみ。`npx prisma db push` で反映。既存データは変更・削除しない）
- `ShiftClaimStatus` に `CANCEL_REQUESTED`（取消申請中）/ `CANCELED`（取消済み）/ `NOT_SELECTED`（不採用）を追加。
- `ShiftClaimRequest.cancelRequestedAt`（nullable）を追加。
- 新テーブル `ShortageMailLog`（月×従業員で一意。送信状態・モード・失敗理由・送信者）。

### 権限
- `src/lib/roles.ts` の `isManagerRole`（ADMIN と INC）で運用操作の権限を判定。アカウント管理（/users）だけは ADMIN 専用。
- アカウント管理で INC アカウントを作成できる。

### 勤務希望
- `POST /api/shift-claims` をサーバー側で検証（人員不足の枠か / 希望時間が枠内か / 既に勤務予定でないか / 週20時間 / 過去日でないか）。確定済みを申請中へ戻せた不具合を修正。申請中の再登録は「変更」。
- 取消: 申請中は本人がすぐ取消、確定済みは取消申請（INC承認で `MonthRoster` の該当勤務を削除。履歴は残す）。
- INC画面 `/shift-requests`: 枠ごとの応募状況、フィルター（日付/シフト/従業員/ステータス）、当月確定済み実労働時間・優先順位・枠の条件、個別確定/却下/取消承認。
- 一括確定 `POST /api/shift-claims/bulk-confirm`（プレビュー→確定。月単位ロック＋トランザクション）。公平性: 当月の実労働時間（休憩控除後）→ 優先順位 → 従業員ID。
- 操作ログは `RosterAuditLog` に実行アカウントとともに記録（`src/lib/auditLog.ts`）。

### メール
- 本文を「翌月の勤務希望を毎月10日までに登録」の内容に変更（不足日程一覧なし・登録URLあり）。
- 再送は未送信・失敗の従業員のみ（`ShortageMailLog`）。`MAIL_ALLOWLIST` で実送信テストの宛先を限定。`MAIL_MODE` の既定は従来どおり（開発は dry-run）。

### 表示の整理（v13追記）
- 4つのSTEP表示（FlowSteps）を全画面から削除。「人員不足を確定」「シフト調整」「勤務希望登録」は独立した機能として扱う。
- ダッシュボード: 従業員は「勤務希望登録」のみ、INCは「人員不足を確定」「シフト調整」のみ表示。
- 「勤務希望の承認・確定」画面の表示名を「応募者の確認・勤務者の確定」に変更（処理は変更なし。シフト調整画面のリンクから開く）。

### テスト
- `npm test`（DB不要の純粋ロジック18件）。

## 2026-10 (v12: 勤務希望登録とシフト調整の分離 / 人員不足確定時のGmail自動送信)

### 画面の分離（用途ごとに別メニュー・別画面）
- STEP1 `/shortage`（管理者）: 人員不足を確定 → 役割が「バイト」(PARTTIME) の従業員へ1回目Gmail。確認ダイアログ（送信対象人数・不足件数）、送信済み月は再送信の確認あり。
- STEP2 `/shift-requests/register`（従業員）: 勤務希望登録。自分の名前・月カレンダー・不足日・不足時間帯のみ。履歴は混ぜない。
- 履歴 `/shift-requests/history`（従業員）: 登録日 / 対象月 / 日付 / 勤務時間 / 登録状態（状態ラベルは従来どおり）。
- STEP3・4 `/roster/shift-adjustment`（管理者）: 残っている不足の確認と、候補者への個別Gmail（2回目）。候補者検索ロジックは変更なし。
- `/shift-requests` は管理者の「勤務希望の承認」専用に変更（従業員は登録画面へリダイレクト）。月間勤務表の「人員不足を確定」ボタンは `/shortage` へのリンクに、KIBO申請モーダルは削除（登録は専用画面）。
- 全画面に共通の流れ表示（`src/components/FlowSteps.tsx`）。ダッシュボードのメニューを管理者/従業員で分離。

### メール
- `mailer.ts` に `sendShortageRequestEmail`（1回目）/ `sendAvailabilityCheckEmail`（2回目）を追加。`MAIL_MODE`（live / dry-run / test）と `MAIL_TEST_TO` を追加。非本番は既定でdry-run（実送信しない）。
- 登録締切 = 対象月の前月10日（`src/lib/shortageMail.ts`）。締切後も登録は可能。
- 2回目メールは不足日時ごとに1通。メール未登録・送信失敗の人には `ShiftClaimRequest(INVITED)` を作らない（候補に残る）。

### 権限（API側）
- `GET /api/roster` / `GET /api/export/roster-excel`: 一般従業員は月間スケジュール確定済みの月のみ全員分、未確定月は自分の行のみ。メールアドレス・備考・更新者は返さない。`src/lib/rosterAccess.ts`。
- `GET /api/employees` をADMINのみに変更（連絡先メールが全員に見えていたため）。

### DB（追加のみ・nullable）
- `ShiftAdjustmentConfirmation`: `notifiedAt` / `notifiedBy` / `notifyResult`。新モデル `MonthRosterConfirmation`。`prisma db push` で反映。

## 2026-09 (v11: シフト調整の表示改善 / シフト名の非表示 / アカウント削除)

### シフト調整（`/roster/shift-adjustment`）
- メール送信後に `runAdjustment()` が送信結果（送信先一覧）を即クリアしていた問題を修正（`runAdjustment(keepResult)`）。
- 送信先は従業員ごとに1回だけ表示（日付ごとの表示はしない）。メール未登録でスキップした従業員名も表示。送信前にも「送信対象: N名」を表示。
- 人員不足時のアルバイト向け注意事項を追加（`src/lib/shortageNotice.ts`）。8:00〜17:00不足→「8:00から」、13:00〜22:00不足→「16:00から」。
  画面表示は月間勤務表のKIBO申請モーダルで、対象シフト（8:00〜17:00 or 13:00〜22:00）を選択したときのみ赤文字で表示。加えて、「人員不足を確定」のスナップショット（`ShiftAdjustmentConfirmation.shortagesByDate` のJSON内 `bands[].notice`）に保存。スキーマ変更なし。
- 不足判定・候補者抽出・メール本文・送信処理のロジックは変更なし。

### 月間勤務表・日別スケジュール
- 「早番」「遅番」などのシフト名の表示を削除し、勤務時間のみ表示（月間勤務表のExcel出力も同様）。勤務時間データ・ロジックは変更なし。

### ブランディング（サイト名 Assign・ロゴ）
- サイト名を「Assign」に変更（ブラウザのタブ名 `layout.tsx`、ログイン画面、メールの送信者名・件名 `mailer.ts`）。
- ロゴ画像を追加: `public/logo.png`（背景透過・正方形に切り出し）、ファビコン `src/app/icon.png`。
- ロゴの色をアプリのプライマリ色（`#1d4e89`）より少し濃い `#173f70`（`--color-primary-hover` と同じ）に変更。
- ログイン画面（フォーム上部）とダッシュボードのヘッダーにロゴを表示。ログイン画面のカードは狭いスマホで画面幅に収まるよう `maxWidth` を追加。
- 業務名の「WHILL」（WHILL到着準備など）やAIプロンプト内の記述はサイト名ではないため変更なし。

### モバイル表示（メニューのはみ出し修正）
- 縦持ちスマホでヘッダーが折り返すとメニューボタンが左端に来て、`right: 0` 基準のメニューが画面左に隠れていた問題を修正。
  `src/lib/useKeepInViewport.ts` を追加し、ダッシュボードのメニュー（`NavMenu`）と月間勤務表のセル編集ポップアップを常に画面内に収める
  （横: はみ出した分だけ移動 / 縦: メニューのみ画面高に収まらない場合に内部スクロール。回転・リサイズ時に再計算）。
- メニューの幅は `min(240px, 画面幅-16px)`、外側タップ（touchstart）でも閉じる。KIBO申請モーダルは画面が低い場合に内部スクロール。
- 画面に収まっているPC表示では位置・見た目は変わらない。

### アカウント管理
- `DELETE /api/users/[id]` と「削除」ボタン（確認ダイアログ付き）を追加。削除するのは `User` のみで、従業員・シフト等のデータは削除しない。
  自分自身・最後の管理者は削除不可。削除済みアカウントの発行済みセッションは `auth.ts` の jwt コールバックで無効化。

## 2026-09 (v10: 従業員・業務データの同期 / Excel・PDFをWebと一致 / 日別スケジュールのAI追加)

### アカウント管理（紐付け従業員）
- `GET /api/users`: 紐付け先の従業員が削除済み（`isActive=false`）の場合は「未紐付け」として返す（削除済みの名前を表示しない）。
- `DELETE /api/employees/[id]`（論理削除）時に、その従業員に紐付いた `User.employeeId` を解除する（アカウントは残る）。
- アカウント作成・紐付け変更（`POST /api/users`, `PATCH /api/users/[id]`）で、削除済み従業員・他アカウントに紐付済みの従業員を拒否（以前は一意制約違反で500になっていた）。
- `/users` 画面: 紐付け候補は「在籍中かつ未紐付け」のみ。タブに戻った時に従業員一覧を自動再取得（`useRefetchOnFocus`）。

### Excel・PDF出力をWeb画面と一致
- 日別スケジュールのExcel/PDFが1時間(24コマ)・`slotStart`完全一致で引いていたため、Web（30分刻み）で手動編集した30分業務が欠落/前半のみになっていた。
  Web・Excel・PDFが同じ共通ロジック（`src/lib/scheduleGrid.ts`）を使うように統一。60分業務は2コマ結合。
- 業務の表示を `code` から業務管理の最新の「業務名」に変更（Web・Excel・PDF共通）。
- PDFに日本語フォントを適用（標準Helveticaは日本語を描画できなかった）。`fonts/ipag.ttf`（IPAゴシック、同梱）→ 環境変数 `PDF_FONT_PATH` → システムフォントの順で探す。
- 月間勤務表Excelも画面と同じ関数（`rosterCellParts`）で出力（勤務時間の下にシフトを表示）。全出力APIに `force-dynamic` / `Cache-Control: no-store`。

### 月間勤務表・日別スケジュール
- 「勤務時間」「シフト（工程）」を氏名と同様に太字・固定表示で見やすく（日別: 勤務時間列を固定表示＋シフト表示 / 月間: セルに勤務時間（太字）＋シフト）。
- 日別スケジュールに「AI追加」（管理者のみ）を追加: `POST /api/schedule/ai-assist`。月間勤務表のAI追加と同じ流れ
  （AIは提案のみ → 一覧で確認 → 「適用」で手動編集と同じ保存処理を使って反映）。共通処理は `src/lib/aiAssist.ts`。
  提案は在籍中の従業員・勤務時間内・有効な業務のみに検証し、60分業務は1時間単位で置換する。
- 月間勤務表のAI追加: 削除済み従業員をAIに渡さない・提案を検証（従業員/日付/ステータス）・`employeeId` で適用（同姓同名の取り違え防止）。
- 配置状況の不足判定: 無効化された業務要件を対象外に（自動割当てAPIと同じ条件に統一）。
- 日別スケジュールの業務プルダウン・凡例から、停止中の業務を除外（現在その業務が割り当て済みの場合のみ表示）。

### その他（データの不整合）
- 欠勤・休みの代替配置（`autoBackfill`）が削除済み従業員を候補に選ぶ問題を修正。
- `apply-pattern`: 削除済み従業員にはパターンを適用しない。
- 未使用の旧AI反映API（`ai-confirm`, `apply-ai-changes`）が削除済み従業員を対象にしないよう修正。
- DBスキーマ変更なし（`prisma db push` は不要）。


## 2026-09 (v9: 「全」交代・22時勤務Break/バッテリー交換・人員不足の再計算・業務編集)

- 業務「全」: 2時間で交代を基本、交代できる人がいない場合のみ3時間、4時間以上は不可（A/Bは変更なし）。
- 新業務「バッテリー交換」(`BATTERY_EXCHANGE`, 60分)。seed追加＋業務一覧取得/自動割当て時に無ければ自動作成。
- 22時勤務(3/4人)のBreak開始時間を自動調整（同時最大2人、長さ120分のまま）、バッテリー交換を1:00or2:00と4:00に配置
  （`src/lib/nightCrewPlan.ts`、`autoAssign.ts` Phase 2-N）。日勤Breakは変更なし。
- 人員不足の件数を、保存後の実割当てから再計算（`computeShortageCells`）。旧 `computeShortageCount` は削除。
- 60分業務を日別スケジュールで分割せず1セル表示、変更時は1時間全体を置換。
- 業務管理に「編集」ボタン（業務名・説明・コード。システム使用コードは変更不可、重複チェックあり）。
- DBスキーマ変更なし（`prisma db push` は不要）。

## 2026-09 (シフト調整: 招待とINC承認の混同を修正)

### 「メール送信」と「本人の登録」を区別（ShiftClaimStatus.INVITED追加）

- 従来、一括メール送信の時点で `ShiftClaimRequest` を `PENDING`（本人申請・承認待ち）として作成していたため、
  INC側の承認待ち一覧・社員側の申請履歴に「本人が申請した」かのように表示されていた。
- `ShiftClaimStatus` に `INVITED`（招待送信済み・未回答）を追加（既存3状態は変更なし）。一括メール送信時は
  `INVITED` で記録し、本人が実際に登録した時点で既存の仕組みのまま `PENDING` に変わる。
- `findInvitedForShift` を追加。`/roster/shift-adjustment` のINC画面で、招待・申請済みの従業員を
  実際の回答状況（招待送信済み・未回答／本人申請済み・承認待ち／承認済み／辞退・却下）つきで表示する。
- `/api/shift-claims/[id]` PATCH: 従業員本人が自分の `INVITED` 案件を「辞退」(REJECTEDのみ)できる経路を追加。
  承認は引き続き管理者のみ。
- `/shift-requests`（社員側）: 申請履歴にシフト内容（コード・時間）を表示するよう修正し、`INVITED`案件には
  「この勤務を希望する」「辞退する」ボタンを追加。

### シフト調整の初期チェック・送信結果の表示

- `/roster/shift-adjustment` の初期チェックを、全候補者→ アルバイト(PARTTIME)のみに変更。それ以外は手動選択。
- `POST /api/roster/shift-adjustment/send-emails` のレスポンスに `recipients`（社員名・メールアドレス）を追加し、
  画面に送信件数とあわせて表示する。

## 2026-09 (シフト必要人数の設定化)

### シフト必要人数をINCがアプリから設定可能に（コード固定の廃止）

- 従来 `src/lib/monthlyShiftGap.ts` に固定されていた `MONTHLY_SHIFT_CODES` / `REQUIRED_PER_SHIFT_BY_CODE`
  （早番4・遅番4・明番4・午前番1・超遅1）を廃止し、DBの設定を使う。
- DB: `ShiftType.requiredCount`（基本必要人数・nullable）と新モデル `ShiftTimeBand`（時間帯別必要人数）を追加。
  seed は `requiredCount` が null のシフトにのみ従来値を初期投入する（INCの変更値は上書きしない）。
- 新画面 `/shift-settings`（管理者のみ。シフト名・開始/終了・基本必要人数・時間帯別必要人数）。
- API: `POST /api/shift-types`、`PATCH/DELETE /api/shift-types/[id]`、`GET /api/schedule/required-headcount` を追加。
  `GET /api/shift-types` は `requiredCount` と `timeBands` も返す。
- 共通ロジック: `src/lib/shiftRequirements.ts`。時間帯別設定がある時間帯は基本必要人数より優先、無い時間帯は基本人数。
- 「人員不足を確定」/シフト調整（`getMonthShiftGaps`）: 上記設定で不足を計算。時間帯別設定があるシフトは、
  区間ごとに（必要人数 − その区間を通して勤務している人数）を出し、最大の不足をシフトの不足とする。
- 自動割り当て: 設定から求めた「1時間スロットごとの必要人数の合計」を A/B/全 の配置人数の上限に使う
  （A→B→全 の順に、`TaskRequirement` の業務ごとの上限内で配分。合計が0のスロットは従来どおり）。
  日別スケジュールの「配置状況」表示も同じ設定を使う。WHILL関連業務の固定人数・`dailyStaffing.ts`
  （従業員向けの日単位不足判定）は今回変更していない。

## 2026-08-07 (v4)

### 自動アサイン: 休憩の確実性・タイミング精度・持ち場交代の改善

対象: `src/lib/autoAssign.ts`。Prisma schema・DB構造・既存API構造・業務名・既存の勤務表機能は
変更していない（関数シグネチャも v3 から変更なし）。分析→原因特定→修正の順で実施。

前提確認（分析結果）: `autoAssign.ts`のA/B/全の配置自体（v3時点）は要求通りに動作しており、
今回のスコープは「休憩・夜勤処理・持ち場交代・全体のスケジュール品質」の改善という位置づけ。

#### 1. パートスタッフへの休憩付与を廃止

- 原因: 休憩配置ループが全従業員を対象にしており、パートスタッフを除外していなかった。
- 修正: Phase 7（休憩）の対象からパートスタッフ（`EmployeeRole.PARTTIME`）を除外。

#### 2. 8時間以上勤務者が休憩を取れないケースがあった

- 原因: 休憩はduty配置後の「空きスロット」のみを対象にしていたため、その従業員が
  duty（A/B/全）で全時間帯を埋められてしまうと休憩を配置する余地が残らず、休憩が
  スキップされていた。
- 修正: 空きスロットが無い場合、業務A/B/全の割当てを1つ（明け番は2つ）取り消して休憩を
  確保するフォールバックを追加（WHILL・事務時間は取り消さない）。この結果、不足数が
  増える可能性があるが、要件「休憩 > 不足ゼロ」を優先している。4時間以上勤務する
  全員に同じ原則を適用（8時間以上だけを特別扱いする理由はないため）。

#### 3. 休憩のタイミング精度

- 修正: 休憩の優先タイミングを「経過4時間に最も近いスロット」に変更（従来は経過3〜5時間の
  範囲内で単純に若い番号を優先していた）。「勤務開始直後」「勤務終了直前」を禁止する制約は
  維持。

#### 4〜6. 夜勤・明け番の連続勤務としての扱い

- 確認: `resolvedStart`/`resolvedEnd`から実際のシフト時間を計算し、シート境界(4:00)ではなく
  実際の経過時間を基準に休憩を判定する仕組み（v3で導入）自体は正しく機能していることを
  シミュレーションテストで確認した。
- **新たに発見した不具合**: 日をまたぐ夜勤（明け番）は`buildDailyRosterView()`により当日側・
  翌日側（引き継ぎ）の2つの断片に分かれ、それぞれが独立した`buildAutoAssignPlan()`呼び出し
  （＝別々の日のAPIリクエスト）として処理される。上記2番の「休憩を強制確保する」フォールバックを
  素朴に実装すると、**両方の断片が独立に「休憩が必要」と判断し、休憩が二重（最大4時間）に
  なる**ことをテストで検出した。
- 修正: シフト全体の中間時点（経過時間の半分）がどちらの断片に属するかを決定的に計算し、
  その断片だけが休憩配置の「責任」を持つ設計に変更（`ownsBreakResponsibility`）。
  責任を持たない側の断片は休憩配置を一切行わない。これにより明け番でも休憩は必ず
  ちょうど2時間（3時間以上には絶対にならない）、二重にもならないことをテストで確認した。

#### 6〜7. 持ち場交代のタイミングと方向性

- 修正: 交代の目安を「1〜3時間」から「2時間を優先・3時間まで許容」に変更
  （`ROTATE_PREFERRED_HOURS=2`, `ROTATE_MAX_HOURS=3`）。2時間に達した時点でまず交代を
  試み、交代候補がいなければ運用の安定を優先して同じ人が継続する（強制的な交代はしない）。
  交代先の選定で「直前と別の業務を優先する」ロジックを追加（A→B→全のような移動を促す）。

#### 10. デバッグログ

- 追加: 各Phaseの開始、候補者の選定理由・却下理由、交代の理由（交代した/できなかった）、
  休憩の配置理由・配置できなかった理由、休憩確保のためにduty配置を取り消したケース、
  夜勤の実労働時間・経過時間の計算結果、休憩配置の「責任」判定結果、を
  `AUTO_ASSIGN_DEBUG=1`で出力するようにした。

#### 検証方法

Prismaに接続しない純粋関数であることを利用し、`tsx`でモックデータに対する
シミュレーションテストを実施（DBなしで検証可能）。確認したケース:
- 夜勤（22:00-08:00、2断片に分割）: 休憩が合計ちょうど2時間になること
- 通常勤務（6時間）: 休憩が経過4時間の位置（許容範囲の中央）に入ること
- パートスタッフ: 休憩が一切入らないこと
- 1人だけで8+時間の需要を満たす場合: 空きが無くても休憩が強制確保されること（不足を許容）
- 2人でのローテーション: 2時間程度で交代し、かつ各自の8時間しきい値に応じた個別休憩も
  正しく両立して配置されること

型チェック: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` でエラーなしを確認済み。


## 2026-08-07

### 日別スケジュール・自動アサインの修正（コード分析 → 原因特定 → 修正の順で実施）

対象: `src/app/schedule/[date]/page.tsx`, `src/lib/dailyRoster.ts`, `src/lib/autoAssign.ts`,
`src/app/api/schedule/auto-assign/route.ts`。新規: `src/lib/dutySchedule.ts`。
Prisma schema・既存API入出力形式・`ShiftType`関連のDB項目/ロジックは変更していない。

#### ① 日別スケジュール表示

- 原因: 画面のテーブルに「シフト」列（ヘッダー2行＋各行のセル）が存在していた。
- 修正: 「シフト」列のみ削除。社員名・勤務時間・業務内容・配置状況・その他表示項目は維持。
  `ShiftType`データやDBロジックは削除していない（表示のみの変更）。

#### ② 社員の表示順

- 原因: `src/lib/dailyRoster.ts`のソート処理が`employeeRole === "INC"`を常に先頭に固定していた
  （role/yakuwariによる並び替え）。
- 修正: role条件を削除し、「勤務開始時刻(activeStartIdx)→勤務終了時刻(activeEndIdx)→氏名」の順に
  変更。社員データ構造(`DailyRosterItem`)自体は変更していない。

#### ③ 配置状況（不足人数計算）

- 原因: `src/app/schedule/[date]/page.tsx`の`shortageBySlot`が、(a) 業務コード(A/B/全)が
  その時間に「誰かに割り当てられているか」だけを見ており、各業務**自身**の稼働時間
  （例:業務Bは6:00〜24:00）を考慮していなかった。「その時間に誰かしら勤務している」だけで
  不足表示が出ていたため、業務が稼働していない時間帯でも不足表示が出ていた。
  (b) WHILL関連業務が計算対象に含まれていなかった。
- 修正: 業務A/B/全・WHILL関連業務それぞれの稼働時間・必要人数の定義を
  `src/lib/dutySchedule.ts`に集約し（サーバー側の自動アサインと共有）、各コードごとに
  「稼働時間内かどうか」を判定してから必要人数と実際配置人数を比較するように変更。
  A/B/全の必要人数は`GET /api/task-requirements`から取得（自動アサインAPIと同じロジック）。

#### ④⑤⑥ 休憩配置・明け番・夜勤（日付跨ぎ）

- 原因: `src/lib/autoAssign.ts`の休憩配置ロジックが、シート（当日/翌日）の見た目上の
  インデックス基準で「勤務時間の長さ」「休憩位置」を計算していた。日付をまたぐ夜勤は
  `buildDailyRosterView()`によって当日側・翌日側（引き継ぎ）の2つの断片に分割されるため、
  各断片を独立に見て休憩必要性を判定すると、(a) 本来1回のはずの休憩が二重に計算されうる、
  (b) シート境界(4:00)付近を基準にした不自然な休憩位置になりうる、という問題があった。
- 修正: 休憩の判定基準を「実際のシフト開始時刻(`resolvedStart`)からの経過時間」に統一。
  シフト全体の実労働時間・断片に入る前の経過時間を計算し、各スロットを経過時間に変換してから
  「最初/最後の1時間を除く」「経過3〜5時間を優先」というルールを適用する。対象の経過時間帯が
  今見ている断片に含まれない場合は何もしない（＝もう一方の断片側の実行に委ねる）ことで、
  二重休憩を防いでいる。明け番・通常勤務とも同じ経過時間基準を使い、明け番のみ休憩の長さが
  2時間になる。詳細は AUTO_ASSIGN_RULES.md セクション5。

#### ⑦ 業務優先順位

- 原因: `buildAutoAssignPlan()`が`RolePriority`テーブルの値を一切参照しておらず、
  候補選択が「今日の割当時間数が少ない人」のみで決まっていた（ランダムに見える配置の原因）。
- 修正: `buildAutoAssignPlan()`に`priorityByRole`引数を追加（後方互換な追加引数）。
  候補選択を「①ロール優先順位 → ②割当時間数の少なさ」の順に変更。
  `src/app/api/schedule/auto-assign/route.ts`で`prisma.rolePriority.findMany()`を取得し、
  `src/lib/autoBackfill.ts`と同じフォールバック規則（未設定ロール＝999＝最低優先）で
  `priorityByRole`を組み立てて渡すようにした。

#### ⑧⑨ パートスタッフ制限・優先順位（業務種別）

- 確認の結果、2026-08-06の改修で既に実装済み（パートはWHILL・事務時間から除外、
  優先順位は業務A→業務B→業務全→WHILL→休憩→事務時間の順で処理）であることを確認。
  今回の修正では変更していない。

型チェック: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` でエラーなしを確認済み。

未対応・スコープ外（docs/TODO.md参照）: Excel/PDF出力にはまだ「シフト」列が残っている
（今回のスコープは画面のみ）。`dailyStaffing.ts`（`ShiftClaimRequest`用の日単位の粗い不足指標）
は時間帯を考慮しない設計のまま据え置き。`autoBackfill.ts`はA/B/全のみ対象のまま。


## 2026-08-06

### Auto Assign Engine — Rewritten to follow the 2026-08 priority rules

`src/lib/autoAssign.ts` は時間帯(スロット)を主軸としたグローバルな逐次割当てロジックに書き直した。
`prisma/schema.prisma` と既存API入出力形式は変更していない。

変更点:

- 優先順位を明示的に実装: 業務A → 業務B → 業務全 → WHILL関連業務 → 休憩 → 事務時間。
  下位の業務が上位の業務の枠を奪わないように、処理順序自体をこの優先順位通りにした。
- 業務A/B/全に「1〜3時間で担当交代」ルールを追加（`MAX_CONSECUTIVE_HOURS_ON_DUTY`）。
- WHILL関連業務を、旧実装の「各自のシフト開始・終了に紐づくbookend」方式から、
  「固定時刻・固定必要人数の4イベント」方式に変更（WHILL到着準備19:00-20:00・
  WHILL到着片づけ10:00-11:00・WHILL出発準備11:00-12:00(2名)・WHILL出発片づけ18:00-19:00(2名)）。
  使用する業務コード（`WHILL_ARRIVAL_PREP`/`WHILL_ARRIVAL_CLEANUP`/`WHILL_DEPARTURE_PREP`/
  `WHILL_DEPARTURE_CLEANUP`）は `prisma/seed.ts` に既存のものをそのまま使用。
- 事務時間（`OFFICE`）を新たに自動アサインの対象に追加。業務A/B/全・WHILL・休憩をすべて
  配置した後の「余り時間」だけを、パート以外のスタッフに割り当てる。
- 休憩ロジックを、通常勤務「開始から3〜5時間」・明け番「2時間連続」を目安にするよう調整。
  休憩は既存の業務配置（A/B/全・WHILL）を上書きしない空きスロットのみを対象にした。
- パートスタッフ（`EmployeeRole.PARTTIME`）をWHILL業務・事務時間の割当て対象から除外。
- デバッグ用ログ（`AUTO_ASSIGN_DEBUG=1`環境変数で有効化）を追加し、人数不足や休憩を
  配置できなかったケースを追跡できるようにした。
- `src/app/api/schedule/auto-assign/route.ts`: 取得する`CartPosition`のコード一覧に
  `OFFICE` / `WHILL_ARRIVAL_PREP` / `WHILL_ARRIVAL_CLEANUP` を追加（`WHILL_DEPARTURE_PREP` /
  `WHILL_DEPARTURE_CLEANUP` はもともと含まれていた）。入出力の形式・権限チェックは変更なし。
- `buildAutoAssignPlan` / `computeShortageCount` / `PRODUCTIVE_CODES` のシグネチャは維持
  （`src/lib/autoBackfill.ts`との互換性のため）。

未対応・持ち越し（docs/TODO.md参照）:
- `autoBackfill.ts`（欠勤時の自動代替配置）は今回のスコープ外。現状はA/B/全のみバックフィルする。
- WHILL関連業務の必要人数は `WHILL_EVENTS` にハードコードしたまま（`TaskRequirement`未連携）。

型チェック: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` でエラーなしを確認済み。

### Project Documentation

`docs/` フォルダのドキュメント一式を全面的に整備:

- Created ARCHITECTURE.md, BUSINESS_RULES.md, AUTO_ASSIGN_RULES.md, DATABASE.md, API.md,
  PROJECT_STRUCTURE.md
- Updated AI_CONTEXT.md, TODO.md, CHANGELOG.md（本エントリ）


## 2026-08-04

### Project Documentation
Added project documentation:

- Created AI_CONTEXT.md
- Created TODO.md
- Created CHANGELOG.md


### Authentication
Implemented:

- NextAuth login system
- Email + password authentication
- bcrypt password hashing
- JWT session


### User Management

Added:

- User account management
- Role control
- ADMIN / EMPLOYEE permission system


### Employee Management

Added:

- Employee CRUD
- Employee information management
- Employee constraints


### Schedule Management

Added:

- Monthly roster management
- Daily schedule management
- Automatic assignment foundation


### Database

Implemented Prisma models:

- User
- Employee
- MonthRoster
- DailyAssignment
- Break
- CartPosition
- TaskRequirement
- RotationPattern
- AuditLog


### Export

Added:

- Excel export
- PDF export


### Email

Added:

- Mail notification system
- Nodemailer integration


---

---

## 2026-09-11

### 自動割り当てロジックの全面見直し（v5）

- 優先順位を ①休憩 → ②WHILL関連業務 → ③業務A/B/全 → ④事務時間 に変更（v4までは
  A/B/全→WHILL→休憩→事務時間の順だった）
- 業務A/B/全の割当てを「業務ごとに全時間帯を埋める」から「時間帯ごとにA→B→全を埋める」
  方式に変更。直前と別の持ち場を優先する交代ロジックが時系列的に正しく機能するようにした
  （A→B→全→Aのようなローテーションが機能していなかった不具合の修正）
- 同じ人物を同じ持ち場に3時間を超えて連続配置することを絶対禁止のハード上限にした
  （v4は交代候補がいない場合に限り無制限に延長を許容していた）
- 休憩を最優先で配置するようにしたことで、v4にあった「空きが無ければ業務の枠を明け渡す
  （bump）」処理が不要になった
- 詳細は docs/AUTO_ASSIGN_RULES.md 参照。DB schema・API入出力形式・UIは変更していない

## 2026-09-11 (v6)

### 業務ローテーションを「現場的に自然な勤務」にするための調整

対象: `src/lib/autoAssign.ts` の Phase 4（業務A/B/全の持ち場交代ロジック）のみ。
Prisma schema・DB構造・既存API入出力形式・関数シグネチャは変更していない。

- 「2時間に達したら、まず交代を試みる」（v5）を「2時間に達しても、交代が必要な理由が
  なければ基本的に継続する」（v6）に変更。v5では2時間ちょうどの瞬間、交代候補さえいれば
  無条件に交代していたため、1時間単位の細かい・不自然な業務変更が起こりうる不具合があった。
- 2〜3時間（`ROTATE_PREFERRED_HOURS`〜`ROTATE_MAX_HOURS`）を「交代してもよいが必須ではない」
  中間ゾーンとして扱う。実際に交代するのは次のいずれかの場合のみ:
  1. 前任者がそのスロットで稼働していない、または休憩・WHILLなど他の業務にすでに
     割り当て済み（＝BREAK・WHILL・勤務時間の都合による必然的な交代）
  2. 3時間の絶対上限に到達（`ROTATE_MAX_HOURS`。従来通りのハード制約、変更なし）
  3. 他スタッフとの業務時間の偏りが `REBALANCE_HOUR_GAP`（2時間）以上ある
     （人員バランス調整が必要な場合のみ、早めに交代する）
  上記のいずれにも該当しない場合は、2時間経過後もそのまま同じ人が同じ持ち場を継続する。
- 「1（事務時間・OFFICE）」は従来通りPhase 5で「他のどの業務にも割り当てられなかった
  残り時間」にのみ使う設計を維持（今回の変更で不要な交代が減った分、意図せずOFFICEに
  なっていた時間も減る）。パート・アルバイトへのOFFICE非割当ても変更なし。
- 詳細は docs/AUTO_ASSIGN_RULES.md セクション3参照。

## 2026-09-16 (v7)

### パート/アルバイトの「空欄」防止（サンプルExcelからのロジック逆算）

対象: `src/lib/autoAssign.ts` の Phase 4（業務A/B/全の候補選定・割当て）のみ。
Prisma schema・DB構造・既存API入出力形式・UIは変更していない。

- 完成イメージのサンプルExcel（人員に余裕がある日の例）を分析し、パート/アルバイトの
  勤務時間には事務時間(OFFICE)も空欄も一切なく、常に実業務(A/B/全)で埋まっていることを
  確認した。
- 原因: `sortCandidates`がロール優先順位のみで候補を並べており、「パート/アルバイトは
  事務時間の対象外」という既存ルールと噛み合っていなかった。正社員等（事務時間に回せる人）
  が必要人数(cap)の枠を先に埋めてしまうと、パート/アルバイトは選ばれず、かつ事務時間にも
  回せないため、勤務時間中なのに何も割り当てられない「空欄」になり得た。
- 修正1: `sortCandidates`で「パート/アルバイトかどうか」をロール優先順位より先に評価し、
  常に最優先で実業務へ回すようにした。
- 修正2: 各時間帯の通常の割当て処理の後に、パート/アルバイトのうちその時間帯でまだ何も
  割り当てられていない人を、稼働中の業務(A/B/全)のいずれかへ必要人数を超えてでも
  追加配置するセーフティネットを追加した（同時間帯にパート/アルバイトがcap数を超えて
  重なる場合の保険）。不足数の計算（`computeShortageCount`）には影響しない。
- 人員不足時の挙動（不足はそのまま「未配置」として表示する等）・勤務の途中開始/終了に
  よる人員増減への追従（スロットごとの`isActive`判定）・勤務時間外の人を割り当てない
  仕組みは変更していない（元々スロット単位の処理のため、これらは自動的に成立している）。
- 詳細は docs/AUTO_ASSIGN_RULES.md セクション3参照。

## 2026-09-17 (v8)

### 休憩ルール全面改訂・「責任者」ロール追加・INC/責任者のOFFICE優先・不足時のINC最終手段化

対象: `prisma/schema.prisma`（`EmployeeRole`に`RESPONSIBLE`追加）、`prisma/seed.ts`
（`RolePriority`初期値の並び替え）、`src/lib/autoAssign.ts`、`docs/AUTO_ASSIGN_RULES.md`、
`docs/BUSINESS_RULES.md`、および`EmployeeRole`のロール一覧をハードコードしている
API（`role-priorities`, `employees`, `employees/reorder`, `task-requirements`,
`task-requirements/[id]`）とUI（`employees/page.tsx`, `tasks/page.tsx`）。
既存のPrisma schema以外の構造（DB構造・API入出力形式・関数シグネチャ）は変更していない。
今回の指示は「旧ルールと新ルールを混在させない」という明示があったため、該当箇所は
新ルールで完全に置き換えている。

- **休憩ルールを変更**（v4〜v7の「4時間以上で休憩、パートタイム除外」を破棄）:
  「7時間以上勤務＝休憩1時間、6時間以下＝休憩なし」に統一し、パートタイム除外を撤廃
  （`MANDATORY_BREAK_MIN_SHIFT_HOURS`を4→7に変更。Phase 2のパートタイムskip処理を削除）。
  6時間超7時間未満のシフトは運用上存在しない前提。夜勤（明番）の2時間連続休憩は維持。
- **休憩の分散と業務維持の優先順位を明文化**: ①休憩開始時刻の調整による分散を優先→
  ②それでも避けられなければ複数人の同時休憩を許容→③最終的には分散より業務A/B/全の
  維持を優先。既存の「稼働人数(slack)が多い時間帯を優先する」ランキングロジックは
  そのまま流用（この方向性と矛盾しないため変更なし）。
- **新ロール「責任者」(`EmployeeRole.RESPONSIBLE`)を追加**。`RolePriority`のデフォルト
  並び順をINC→STAFF→CONTRACT→PARTTIME→OJTから
  **INC→責任者→STAFF→CONTRACT→PARTTIME→OJT**に変更。
- **INC・責任者のOFFICE優先ルールを追加**: `sortCandidates`（Phase 3 WHILL・Phase 4業務
  A/B/全で共用）に、INC・責任者を「他に候補がいない場合のみ選ばれる最後尾」に押し下げる
  新しい判定（`OFFICE_RESERVED_ROLES`）を、パートタイム最優先判定の次・`RolePriority`
  判定の前に追加した。これにより、業務A/B/全の必要人数を他のロールで満たせる限り
  INC・責任者はそちらに回らず、Phase 5（事務時間）で自動的にOFFICEに回る。業務A/B/全の
  必要人数を現有スタッフだけでは満たせない場合は、INC・責任者も他の従業員と同様に
  業務A/B/全を担当する（OFFICE専任という制限は設けていない）。
- **人員不足時の考え方は変更なし（再確認・明文化）**: 不足を細かいローテーションや無理な
  配置で無理やり解決しない方針を維持。「INCを最終手段として追加する」という要件は、
  ロースターへの新規追加ではなく、既存roster内のINC・責任者を上記の仕組みでA/B/全に
  回すことで実現している（`buildAutoAssignPlan()`は渡された`rosterItems`の範囲内で
  完結する純粋関数という既存設計を維持したため）。
- `EmployeeRole`にロールを追加したことに伴い、この列挙値をハードコードしていた
  Zodスキーマ・UIの選択肢・ラベル定義（上記対象ファイル）をすべて更新した。
  `prisma/migrations`は使用しておらず`prisma db push`でスキーマを反映する構成のため、
  マイグレーションファイルの追加は不要。
- 詳細は docs/AUTO_ASSIGN_RULES.md セクション5・6、docs/BUSINESS_RULES.md参照。

## Future Changes

New changes should be added above this section.

Format:

## YYYY-MM-DD

### Feature name

- What was added
- What was changed
- What problem was fixed