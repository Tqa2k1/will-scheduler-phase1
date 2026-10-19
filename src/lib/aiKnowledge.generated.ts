// 自動生成ファイル。編集しないこと。更新: npm run ai:knowledge （元: docs/*.md・PROJECT_OVERVIEW.md・prisma/schema.prisma・src/app/api・src/lib）
export type KnowledgeChunk = { id: string; title: string; source: string; keywords: string[]; text: string };
export const KNOWLEDGE: KnowledgeChunk[] = [
 {
  "id": "PROJECT_OVERVIEW-md:PROJECT_OVERVIEW-md-Assign-whill-schedul:0",
  "title": "PROJECT_OVERVIEW.md — Assign（whill-scheduler-lv2）",
  "source": "PROJECT_OVERVIEW.md",
  "keywords": [],
  "text": "パシフィック・クルーのシフト管理システム。月間勤務表・日別アサイン表・人員不足の確定とメール（ASK①/②）・勤務希望の登録と確定を扱う。"
 },
 {
  "id": "PROJECT_OVERVIEW-md:技術スタック:0",
  "title": "技術スタック",
  "source": "PROJECT_OVERVIEW.md",
  "keywords": [],
  "text": "Next.js 14.2.5（App Router）/ React 18 / TypeScript / Prisma 5.22 + PostgreSQL / NextAuth（JWT, ロール ADMIN・INC・EMPLOYEE）/ zod / nodemailer（Gmail）/ exceljs（Excel）/ pdfkit + IPAフォント（PDF）/ eslint / tsx テスト。"
 },
 {
  "id": "PROJECT_OVERVIEW-md:ディレクトリ:0",
  "title": "ディレクトリ",
  "source": "PROJECT_OVERVIEW.md",
  "keywords": [],
  "text": "- `src/app/` 画面とAPI（`src/app/api/**/route.ts`）\n- `src/lib/` 業務ロジック（人数集計 `shiftHeadcount.ts`、不足判定 `monthlyShiftGap.ts`、勤務希望 `claim*.ts`、月の状態 `monthStatus*.ts`、Excelスタイル `excelStyle.ts`）\n- `src/components/` 共通UI（`ui/`、`ask/AskSteps.tsx`、`AiAssistModal.tsx`）\n- `prisma/schema.prisma`、`prisma/sql/`（手動適用用SQL）\n- `tests/` 単体・統合テスト（インメモリDB）\n- `docs/` 詳細ドキュメント"
 },
 {
  "id": "PROJECT_OVERVIEW-md:主な機能:0",
  "title": "主な機能",
  "source": "PROJECT_OVERVIEW.md",
  "keywords": [],
  "text": "| 機能 | 画面 | 備考 |\n|---|---|---|\n| 月間勤務表 | `/roster` | INC/ADMINは編集。ボタン: ASK①・ASK②・アサイン作成・Excel出力・AI依頼・パターン設定、メール配信は右下。従業員は「確定」月のみ全員分を閲覧（自分の行が先頭） |\n| 日別アサイン表 | `/schedule/[date]` | 自動アサイン、Excel/PDF出力 |\n| ASK① 人員不足の確定 | `/shortage` | 不足を確定し1回目メール |\n| 勤務希望登録 | `/shift-requests/register` | 従業員。停止中は登録・変更不可 |\n| 応募者の確認・勤務者の確定（ホーム「勤務希望確認」から） | `/shift-requests` | INC/ADMIN。月・日付・シフト・従業員・状態で絞り込み。月別の登録停止/再開、AI依頼、一括確定 |\n| ASK② シフト調整・配信 | `/roster/shift-adjustment` | 調整、確定メール配信 |\n| AI依頼 | ASK②画面・応募者の確認画面 | `/api/roster/ai-assist`。提案は確認後に適用 |\n| スケジュール設定 | `/tasks`（タブ: スケジュール／勤務時間設定） | 旧「業務管理」＋旧「人数設定」。旧 `/shift-settings` はリダイレクト |\n| アカウント設定 | `/users` | 旧「従業員管理」＋旧「アカウント管理」。氏名の正は `Employee.fullName`。旧 `/employees` はリダイレクト |\n| パスワード変更 | `/account/password` | 全ロール共通 |\n| エクスポート | 各画面 | `/api/export/roster-excel`, `schedule-excel`, `schedule-pdf` |"
 },
 {
  "id": "PROJECT_OVERVIEW-md:起動:0",
  "title": "起動",
  "source": "PROJECT_OVERVIEW.md",
  "keywords": [],
  "text": "`.env.example` を `.env` にコピーし値を設定 → `npm install` → `npx prisma generate && npx prisma db push` → `npm run dev`。テストは `npm test`。"
 },
 {
  "id": "docs-WORKFLOWS-md:全体の流れ:0",
  "title": "全体の流れ",
  "source": "docs/WORKFLOWS.md",
  "keywords": [],
  "text": "1. **ASK①**（`/shortage`、INC）: 現在の勤務表から不足（日・シフト・人数）を確定（`ShiftAdjustmentConfirmation`）し、役割が「バイト」の従業員へ1回目メール「勤務希望登録のお願い」（`ShortageMailLog`で二重送信防止）。\n2. **勤務希望の登録**（`/shift-requests/register`、従業員）: 不足の日・シフトを選び、シフト内の勤務時間を登録（`ShiftClaimRequest`、状態 PENDING）。\n3. **応募者の確認・勤務者の確定**（`/shift-requests`、INC）: 応募を確認し、承認／却下、または一括確定（`bulkConfirm.ts`。実労働時間が少ない人→優先順位→ID順）。承認で勤務表（`MonthRoster`）へ反映。\n4. **ASK②**（`/roster/shift-adjustment`、INC）: 残りの不足に候補者を招待・調整し、月の確定メールを配信。全員成功で月が「確定」。\n\nASK①/②は画面を統一（`AskSteps`の段階表示・同じ見出し/ボタン/確認ダイアログ）したが、処理順序・API呼び出しは変更していない。"
 },
 {
  "id": "docs-WORKFLOWS-md:勤務希望のステータス:0",
  "title": "勤務希望のステータス",
  "source": "docs/WORKFLOWS.md",
  "keywords": [],
  "text": "INVITED（ASK②の招待）/ PENDING（申請中）/ APPROVED（確定）/ REJECTED / CANCEL_REQUESTED（確定後の取消申請）/ CANCELED / NOT_SELECTED。"
 },
 {
  "id": "docs-WORKFLOWS-md:キャンセル:0",
  "title": "キャンセル",
  "source": "docs/WORKFLOWS.md",
  "keywords": [],
  "text": "| 状態 | 従業員の操作 | 結果 |\n|---|---|---|\n| PENDING（確定前） | `POST /api/shift-claims/:id/cancel` | **即時** CANCELED。INC承認不要。`decidedAt`/`decidedBy`に日時・操作者、監査ログ `CLAIM_CANCEL`。`cancelRequestedAt`が空＝「確定前の自己キャンセル」。 |\n| APPROVED（確定後） | 同上 | CANCEL_REQUESTED（`cancelRequestedAt`記録）。**INCが承認するまで確定のまま**（人数不変）。承認(`PATCH /api/shift-claims/:id` decision=CANCEL_APPROVED)で CANCELED・勤務表から削除。却下で APPROVED に戻る。 |\n\n確定前の自己キャンセル（`isSelfCanceledBeforeConfirm`）は、INC一覧・希望人数・不足判定・ASK②候補（招待中一覧）から除外される。DBには履歴として残る。"
 },
 {
  "id": "docs-WORKFLOWS-md:登録の停止-再開-月別:0",
  "title": "登録の停止／再開（月別）",
  "source": "docs/WORKFLOWS.md",
  "keywords": [],
  "text": "- INC/ADMINが `/shift-requests` の「登録を停止する／再開する」で切替（`POST /api/shift-claims/registration-hold` `{month, stopped}`）。`ClaimRegistrationHold`に月ごとに保存。\n- 停止中: `POST /api/shift-claims` が 403（`registrationStopped:true`）。従業員画面は「○月の勤務希望登録は現在停止中です」を表示し、登録・変更フォームを隠す。既存データは残り、未確定のキャンセルは可能。\n- 月は日付文字列（JST）の `YYYY-MM` で判定。操作は監査ログ（CLAIM_REGISTRATION_STOP / RESUME）。"
 },
 {
  "id": "docs-HEADCOUNT_RULES-md:HEADCOUNT_RULES-md-シフト人数の集計ルール:0",
  "title": "HEADCOUNT_RULES.md — シフト人数の集計ルール",
  "source": "docs/HEADCOUNT_RULES.md",
  "keywords": [],
  "text": "実装: `src/lib/shiftHeadcount.ts`（純粋関数）、`src/lib/monthlyShiftGap.ts`（不足判定）。テスト: `tests/logic.test.ts`、`tests/claims.test.ts`。\n\n- 主なシフト: 第1シフト 08:00–17:00 / 第2シフト 13:00–22:00（`ShiftType`）。\n- 人数は**登録時に選択したシフト（`shiftTypeId`）基準**。勤務時間がシフト全体と違っても（例: 第2シフトで16:00–22:00）そのシフトの1人。**時間帯からシフトを逆算しない**。\n- 登録時間は選択シフトの枠内に収まること（`requestInsideSlot`、APIで検証）。\n- 同じ従業員・同日・同シフトは重複して数えない（`employeeId_workDate` ユニーク制約＋集計時の重複排除）。\n- キャンセル・却下・不採用・招待中は数えない。\n- **勤務希望人数**（PENDINGのみ、`countRequestedByShift`）と**勤務確定人数**（勤務表のWORK、`countConfirmedByShift`/`getMonthShiftGaps.current`）を別々に集計・表示。不足は確定人数基準（`summarizeSlot`）。希望が全て確定した場合の不足は `shortageAfterRequests`。\n- 表示: 応募者の確認画面「必要/確定/希望（申請中）/不足」、ASK①・ASK②の不足表。"
 },
 {
  "id": "docs-HEADCOUNT_RULES-md:既知の差異-仕様との矛盾点:0",
  "title": "既知の差異（仕様との矛盾点）",
  "source": "docs/HEADCOUNT_RULES.md",
  "keywords": [],
  "text": "1. `getMonthShiftGaps` には、`shiftTypeId` が無い旧データに限り開始時刻からシフトを推定するフォールバックが残る（旧データ互換のため維持）。\n2. `ShiftTimeBand`（時間帯別必要人数）が設定されたシフトは、時間帯ごとに時間で評価する（`evaluateShiftGap`）。「時間から逆算しない」とは別の仕組みなので、時間帯設定を使う場合は注意。"
 },
 {
  "id": "docs-PERMISSIONS-md:PERMISSIONS-md-権限:0",
  "title": "PERMISSIONS.md — 権限",
  "source": "docs/PERMISSIONS.md",
  "keywords": [],
  "text": "ロール: ADMIN / INC（`isManagerRole`＝管理者側）/ EMPLOYEE。認証は NextAuth（JWT）。権限は**API側で必ず検査**する。\n\n| 操作 | ADMIN/INC | EMPLOYEE |\n|---|---|---|\n| 勤務表の編集・ASK①/②・メール配信・AI依頼・一括確定 | ○ | × (403) |\n| 月別の勤務希望登録の停止/再開 | ○ | ×(403) |\n| 登録停止状態の参照（GET registration-hold） | ○ | ○ |\n| 勤務希望の登録・自分の取消 | × | ○（本人のみ。停止中は登録・変更不可） |\n| 取消申請の承認／却下、申請の承認／却下 | ○ | × |\n| アカウント設定（従業員情報の閲覧・編集・追加・削除、優先順位） | ○ | ×(403・`/users`は`/account/password`へ誘導) |\n| アカウント設定（ログインアカウントの作成・削除・紐付け） | ADMINのみ（INCは403） | × |\n| スケジュール設定（スケジュール・勤務時間設定） | ○ | × |\n| パスワード変更（自分のみ） `/account/password` | ○ | ○ |\n| 勤務表の閲覧 | 常に全員分 | 「確定」月のみ全員分（氏名・シフト時間のみ）。調整中はデータを返さない |\n| Excel/PDF出力 | 常に可 | 確定月のみ（調整中は403） |"
 },
 {
  "id": "docs-DATA_FLOW-md:DATA_FLOW-md-データの流れ:0",
  "title": "DATA_FLOW.md — データの流れ",
  "source": "docs/DATA_FLOW.md",
  "keywords": [],
  "text": "```\nShiftType/ShiftTimeBand(必要人数) + MonthRoster(確定勤務)\n   └─ getMonthShiftGaps ─→ 不足(日×シフト)\n        ├─ ASK① /api/shortage(preview/confirm) → ShiftAdjustmentConfirmation(スナップショット) → 1回目メール(ShortageMailLog)\n        ├─ 従業員 /api/shift-claims/my-month ← スナップショット + ClaimRegistrationHold(停止中か)\n        ├─ 従業員 POST /api/shift-claims → ShiftClaimRequest(PENDING)   ※停止中は403\n        ├─ 従業員 cancel → 確定前: CANCELED(即時) / 確定後: CANCEL_REQUESTED\n        ├─ INC /api/shift-claims?month → buildAdminClaimList(自己キャンセルを除外, 希望人数=countRequestedByShift)\n        ├─ INC 承認/一括確定 → MonthRoster(WORK) + markMonthsRevised → 月は「調整中」\n        └─ ASK② 配信成功 → MonthRosterConfirmation.status = CONFIRMED\n```\nエクスポートは `/api/roster`・`/api/schedule` と同じ閲覧範囲・同じロジックで生成（`src/lib/excelStyle.ts` で配色・罫線・印刷設定）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:BUSINESS_RULES-md-WHILL-Scheduler:0",
  "title": "BUSINESS_RULES.md — WHILL Scheduler",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "> このファイルは、コード（`prisma/schema.prisma`, `src/lib/*.ts`, `prisma/seed.ts`）と、\n> 2026-08 に確定した業務ルール指示（`docs/AUTO_ASSIGN_RULES.md` のもとになった要件）から\n> 判明している業務ルールをまとめたもの。自動アサイン固有の詳細ルールは\n> AUTO_ASSIGN_RULES.md に分離しているので、そちらも合わせて読むこと。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:用語-業務コード:0",
  "title": "用語（業務コード）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "| コード (DB `CartPosition.code`) | 名称 | 分類 |\n|---|---|---|\n| `A` | Aカート（業務A） | CART |\n| `B` | Bカート（業務B） | CART |\n| `全` | 全カート（業務全） | CART |\n| `BF` | BF | SPECIAL |\n| `BREAK` | 休憩 | SPECIAL |\n| `MOVE` | 移動 | SPECIAL |\n| `WHILL_ARRIVAL_PREP` | WHILL到着準備 | SPECIAL |\n| `WHILL_ARRIVAL_CLEANUP` | WHILL到着片づけ | SPECIAL |\n| `WHILL_DEPARTURE_PREP` | WHILL出発準備 | SPECIAL |\n| `WHILL_DEPARTURE_CLEANUP` | WHILL出発片づけ | SPECIAL |\n| `OFFICE` | 事務時間 | SPECIAL |\n| `MTG` | 会議 | SPECIAL |\n\n（出典: `prisma/seed.ts` の `positions` 配列。これが実際にDBへ投入される業務マスタ。）"
 },
 {
  "id": "docs-BUSINESS_RULES-md:業務A・業務B・業務全:0",
  "title": "業務A・業務B・業務全",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 業務A: 稼働時間 **5:00〜26:00（=翌2:00）**。\n- 業務B: 稼働時間 **6:00〜24:00**。\n- 業務全: 稼働時間 **5:00〜25:00（=翌1:00）**。\n- 時間帯あたりの必要人数は `TaskRequirement.requiredCount`（管理画面 `/tasks` で設定）で決まる。\n  未設定の場合、自動アサインのフォールバック値は1名（`src/lib/autoAssign.ts` の `capFor`）。\n  ただし `prisma/seed.ts` は初回投入時にA/B/全それぞれ requiredCount=4 をデフォルトとして\n  設定している（⚠️ 要確認: 実運用でこの値が「1名」相当を想定しているのか「4名（4台のカート）」を\n  想定しているのかはDB/管理画面側の設定次第であり、コードからは断定できない）。\n- 優先順位は 業務A > 業務B > 業務全 > WHILL関連業務 > 休憩 > 事務時間（AUTO_ASSIGN_RULES.md参照）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:WHILL関連業務:0",
  "title": "WHILL関連業務",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "固定の時刻・固定の必要人数を持つ、1日4つのイベント（`src/lib/autoAssign.ts` の `WHILL_EVENTS`）。\n\n| 業務 | 時間 | 必要人数 |\n|---|---|---|\n| WHILL（到）片づけ | 10:00〜11:00 | 1名 |\n| WHILL（出）準備 | 11:00〜12:00 | 2名 |\n| WHILL（出）片づけ | 18:00〜19:00 | 2名 |\n| WHILL（到）準備 | 19:00〜20:00 | 1名 |\n\n- パートスタッフ（`EmployeeRole.PARTTIME`）はWHILL業務に配置禁止。\n- WHILL業務のために業務A/B/全の人員を削らない（優先順位が低いため、A/B/全に必要な人を\n  奪ってはいけない）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:明け番-夜勤引き継ぎ:0",
  "title": "明け番（夜勤引き継ぎ）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- `ShiftType` の `明番`（22:00〜08:00, `spansMidnight: true`）で勤務するスタッフ。\n- 当日シート上では、前日から続く夜勤として **4:00〜シフト終了時刻** の部分だけが\n  「引き継ぎ（`isCarryOver: true`）」として表示される（`src/lib/dailyRoster.ts`）。\n- 休憩は **2時間連続**。ただし全員を同時に休憩へ入れない。業務A/B/全の稼働時間内では、\n  他スタッフの配置状況を見ながら順番に休憩を設定する（業務A/B/全の稼働時間外はこの制限なし）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:休憩ルール-通常勤務-2026-09-v8で全面改訂:0",
  "title": "休憩ルール（通常勤務、2026-09 v8で全面改訂）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- **6時間以下の勤務には休憩を配置しない。**\n- **7時間以上勤務した場合は休憩1時間を配置する**（勤務開始から3〜5時間程度を目安に配置）。\n- 6時間超7時間未満のシフトは運用上存在しない前提。\n- **パートタイムも対象**（v8で変更。以前はパートタイムを休憩対象外としていたが撤廃した。\n  パートタイムが7時間以上勤務する場合は他の従業員と同じく休憩1時間を付与する）。\n- スタッフ全員を同時に休憩に入れない（時間をずらす）のを優先するが、それによって業務A/B/全の\n  必要人数を満たせなくなる場合は、①まず休憩開始時刻を調整する→②それでも避けられなければ\n  複数人の同時休憩を許容する→③最終的には休憩の分散よりも業務A/B/全の維持を優先する。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:事務時間-OFFICE:0",
  "title": "事務時間（OFFICE）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- **最初から事務時間を配置しない。** 業務A/B/全・WHILL関連業務・休憩をすべて配置したあとに\n  余った時間だけを使う。\n- パートスタッフは事務時間に配置禁止。\n- **v8で追加**: INC・責任者(`EmployeeRole.RESPONSIBLE`)は通常時は事務時間を優先的に担当する。\n  ただしINC・責任者を事務時間専任に固定するわけではなく、業務A/B/全の必要人数を現有スタッフ\n  だけで満たせない場合は、INC・責任者も他の従業員と同様に業務A/B/全を担当する。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:パートスタッフ-EmployeeRole-PARTTIME-のルール:0",
  "title": "パートスタッフ（`EmployeeRole.PARTTIME`）のルール",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 配置可能: 業務A / 業務B / 業務全（乗車業務のみ）。\n- 配置禁止: WHILL準備・WHILL片づけ・事務時間・その他業務。\n- 勤務時間の上限: **週20時間**（`src/lib/weeklyHours.ts` の `PARTTIME_WEEKLY_HOUR_LIMIT`）。\n  この上限は既存のプロジェクトルールであり、今回の業務ルール改訂でも変更していない。\n- 休憩: v8で変更。7時間以上勤務する場合は他の従業員と同じく休憩1時間を付与する\n  （以前はパートタイムは休憩対象外だったが撤廃）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:INC・責任者-EmployeeRole-INC-EmployeeRole-RE:0",
  "title": "INC・責任者（`EmployeeRole.INC` / `EmployeeRole.RESPONSIBLE`、2026-09 v8）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- `責任者`（`RESPONSIBLE`）はv8で新規追加したロール。INCは元々プロジェクトに存在するロール。\n- ロール優先順位のデフォルト（`RolePriority`初期値）: **INC → 責任者 → STAFF → CONTRACT →\n  PARTTIME → OJT**。\n- 通常時、INC・責任者は事務時間(OFFICE)を優先的に担当する。\n- ただしINC・責任者は事務時間専任ではない。業務A/B/全の必要人数を現有スタッフだけでは\n  満たせない場合、INC・責任者も他の従業員と同様に業務A/B/全を担当する（最終手段としての\n  「INC投入」は、この既存roster内でのINC・責任者の業務A/B/全参加によって実現しており、\n  ロースターへの新規追加・呼び出しは自動アサインの範囲外）。\n- 人員不足の解消は、まず現在のroster内で調整することを優先し、無理な細かいローテーションや\n  無理な配置による解決はしない。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:日別スケジュール画面の表示ルール:0",
  "title": "日別スケジュール画面の表示ルール",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 表示列: 社員名 / 勤務時間 / 業務内容 / 配置状況（+ その他既存表示項目）。**「シフト」列は\n  表示しない**（2026-08改訂で削除。`ShiftType`のDBデータ・ロジック自体は削除していない）。\n- 社員の表示順は役割（role/yakuwari）で決めない。\n  ① 勤務開始時刻が早い順 → ② 同じ場合は勤務終了時刻が早い順 → ③ それでも同じ場合は氏名（かな順）。\n- 配置状況（不足表示）は、業務A/B/全に加えてWHILL関連業務も対象にし、各業務**自身の稼働時間内\n  のみ**で必要人数と実際配置人数を比較する（稼働時間外・誰も勤務していない時間帯は不足表示しない）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:持ち場交代ルール:0",
  "title": "持ち場交代ルール",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 業務A/B/全について、同じスタッフが長時間同じ持ち場を担当し続けないようにする。\n- 目安: **1〜3時間程度**で担当を交代する。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:ロールと権限-勤務系ロールとログイン系ロールは別軸:0",
  "title": "ロールと権限（勤務系ロールとログイン系ロールは別軸）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- `EmployeeRole`（従業員としての役割）: `STAFF`（社員）/ `CONTRACT`（契約社員）/\n  `PARTTIME`（バイト）/ `OJT` / `INC` / `RESPONSIBLE`（責任者。2026-09 v8で追加）。\n  INCは実際に自動アサインの対象として運用されている（「現状未使用」ではない）。\n- `UserRole`（ログインアカウントの権限）: `ADMIN` / `INC` / `EMPLOYEE`。\n  `EmployeeRole.INC` と `UserRole.INC` は名前が同じだが別のenumであることに注意。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:未確認・要確認事項:0",
  "title": "⚠️ 未確認・要確認事項",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- WHILL業務の「到（到着）」「出（出発）」がそれぞれ何を指すか（WHILLの到着便・出発便の対応と\n  推測されるが、業務仕様書等の一次情報での確認はできていない）。\n- `RolePriority`（自動バックフィル時の優先順位: INC→STAFF→CONTRACT→PARTTIME→OJT）と、\n  今回のAUTO_ASSIGN_RULES.mdの優先順位（A→B→全→WHILL→休憩→事務時間）は「何を優先するか」の\n  軸が異なる（前者は「誰を優先するか」、後者は「どの業務を優先するか」）。両者は独立したルールとして\n  共存している。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:業務-全-の交代:0",
  "title": "業務「全」の交代",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 基本は2時間連続で交代。交代できる人がいない場合のみ3時間まで。4時間以上は絶対に配置せず、\n  割当てできない場合は人員不足として残す（A・Bは従来どおり）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:60分業務:0",
  "title": "60分業務",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- WHILL到着片づけ・到着準備・出発片づけ・出発準備・バッテリー交換は60分単位で扱い、30分に分割しない。\n  別の業務へ変更する場合は、その1時間全体を新しい業務に置き換える。通常業務は30分単位のまま。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:バッテリー交換-業務コード-BATTERY_EXCHANGE:0",
  "title": "バッテリー交換（業務コード `BATTERY_EXCHANGE`）",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 必要人数1人・60分。22時勤務のみに自動割当て（日勤は自動割当てなし。手動では設定可能）。\n- パート・アルバイトは対象外（WHILLと同じ扱い）。\n- 1回目は1:00または2:00（他業務・Breakとの重複と人員不足がない方を自動選択。範囲外にはしない）、2回目は4:00固定。\n- 22時勤務は3人または4人のみを想定。それ以外の人数では自動割当てしない。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:22時勤務のBreak:0",
  "title": "22時勤務のBreak",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 長さは120分のまま。開始時間のみ自動調整（1:00 / 2:00 / 3:00）。同時にBreakできるのは最大2人。\n  希望パターン（4人: 1:00×1・2:00×2・3:00×1 / 3人: 2:00×2・3:00×1）は、120分のままだと3人同時Breakに\n  なるため、最大2人を優先して最小限ずらす（4人: 1:00×2・3:00×2 / 3人: 1:00・2:00・3:00に1人ずつ）。\n- 日勤のBreakは変更なし。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:スケジュール設定-旧-業務管理-の編集:0",
  "title": "スケジュール設定（旧：業務管理）の編集",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 「編集」ボタンで業務名・説明を自由に変更できる。コードは重複チェックのうえ変更可。\n- ただしシステムが直接参照するコード（A / B / 全 / BREAK / OFFICE / WHILL_* 4種 / BATTERY_EXCHANGE）は\n  変更不可（変更すると自動割当て・不足判定が黙って動かなくなるため）。名称・色・説明は変更できる。\n- 保存済みの割当て(DailyAssignment)は業務の `id` で参照しているため、コードを変更してもデータは壊れない\n  （画面・Excel/PDFの表示コードのみ変わる）。"
 },
 {
  "id": "docs-BUSINESS_RULES-md:人員不足表示:0",
  "title": "人員不足表示",
  "source": "docs/BUSINESS_RULES.md",
  "keywords": [],
  "text": "- 「人員不足のコマ」は、自動割当て後に保存された割当てから、稼働時間・必要人数を考慮して再計算した件数\n  （日別スケジュール画面の赤表示と同じ）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:AUTO_ASSIGN_RULES-md-自動アサインエンジンの詳細仕様:0",
  "title": "AUTO_ASSIGN_RULES.md — 自動アサインエンジンの詳細仕様",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "> 対象ファイル: `src/lib/dutySchedule.ts`（稼働時間・必要人数の定義。単一の情報源）、\n> `src/lib/autoAssign.ts`（ロジック本体）、`src/app/api/schedule/auto-assign/route.ts`（API）、\n> `src/app/schedule/[date]/page.tsx`（「配置状況」表示。`dutySchedule.ts`を共有する）。\n> このファイルは自動アサインを改修するAI/開発者が**最初に読むべき**ドキュメント。\n> 2026-08 の業務ルール改訂（v2）、優先順位・夜勤休憩バグの修正（v3）、\n> 休憩の確実性・タイミング精度・持ち場交代の改善（v4）、優先順位の全面見直し（v5）、\n> 業務ローテーションを現場的に自然な勤務にするための交代条件の見直し（v6）、\n> パート/アルバイトの「空欄」防止（v7）、休憩ルール全面改訂・責任者ロール追加・\n> INC/責任者のOFFICE優先（v8）を反映済み。\n> 改訂前の実装との差分は CHANGELOG.md 参照。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:1-優先順位-最重要:0",
  "title": "1. 優先順位（最重要）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "```\n① 休憩\n② WHILL関連業務（準備・片づけ）\n③ 業務A/B/全\n④ 事務時間（OFFICE）\n```\n\n（v5で変更: v4までは①A②B③全④WHILL⑤休憩⑥事務時間だった。休憩は勤務条件として\n最初に確保すべきものであり、業務A/B/全より先に配置する。詳細は CHANGELOG.md 参照。）\n\n「最優先」＝「必ず人数不足をゼロにする」ではない。スタッフ人数・勤務時間・休憩条件により\n不足が生じるのは許容する。重要なのは **他の業務より休憩・WHILL・A/B/全を優先して埋める順序**。\n事務時間を確保するために他の業務の配置を削減してはいけない。\n\n`buildAutoAssignPlan()` の処理順序はこの優先順位をそのまま反映しており、\n1) 休憩 → 2) WHILL → 3) 業務A/B/全 → 4) 事務時間 の順に、前段で使われていない\n「空きスロット」だけを次の段が使う設計になっている。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:2-時間の表現方法:0",
  "title": "2. 時間の表現方法",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "`slotIndex` は 0〜23 の整数で、**4:00始まりの営業日インデックス**（`src/lib/timeSlots.ts` の\n`operatingIndex()`）。例: `slotIndex=0` は4:00〜5:00、`slotIndex=23` は翌3:00〜4:00。\n\n業務A/B/全の稼働時間はこのインデックスに変換して `DUTY_WINDOW` に保持している\n（`windowFromClock(startHour, endHourExclusive)` で実時刻から自動計算）。\n\n| 業務 | 実時刻 | 内部表現 (startIdx, endIdx) |\n|---|---|---|\n| A | 5:00〜26:00 | (1, 22) |\n| B | 6:00〜24:00 | (2, 20) |\n| 全 | 5:00〜25:00 | (1, 21) |"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:3-業務A-B-全の割当てロジック:0",
  "title": "3. 業務A/B/全の割当てロジック",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- **v5で変更**: 各時間帯（1時間）ごとに、A→B→全の順で埋める（「時間帯ごとに全業務を処理する」\n  構成。v4の「業務ごとに全時間帯を通しで埋める」構成から戻した）。理由: 業務ごとに丸ごと\n  処理すると、ある業務の処理中は他の業務の割当て履歴がまだ存在しないため、「直前は別の\n  持ち場だった人を優先する」という交代の方向性判定が時系列的に機能しなかった\n  （＝「A→B→全→A」のようなローテーションが実質的に機能しない不具合の原因だった）。\n  時間帯ごとに処理することで、ある時間にAから外れた人がその同じ時間のBや全の候補に\n  自然に回るようになる。\n- **持ち場交代**（v6で交代条件を「必要な場合のみ」に見直し）:\n  - 直前スロットの担当者の連続担当時間が**2時間未満**なら、そのまま継続する\n    （1時間ごとに毎回交代するのは不自然なため）。\n  - **前任者がそのスロットで稼働していない、または休憩・WHILLなど他の業務にすでに\n    割り当て済みの場合**は、連続担当時間に関わらず新しい候補を選ぶ（BREAK・WHILL・\n    勤務時間の都合による必然的な交代であり、「交代が必要かどうか」を判断するまでもない）。\n  - **v6で変更**: 連続担当時間が**2時間以上3時間未満**の間は、「交代してもよいが\n    必須ではない」中間ゾーンとして扱う。v5までは2時間に達した瞬間、交代候補さえいれば\n    無条件に交代していたため、1時間だけA→別の業務→1時間だけB、のような現場的に\n    不自然な細かい業務変更が起こりうる不具合があった。v6では、このゾーンで実際に\n    交代するのは**他スタッフとの当日の業務時間の偏りが`REBALANCE_HOUR_GAP`（2時間）\n    以上ある場合のみ**とし、それ以外は同じ人がそのまま継続する\n    （＝「可能な限り2〜3時間まとめて担当する」という要件の実装）。\n  - **連続担当時間が3時間に達したら（ハード上限、v5から変更なし）、交代候補の有無に\n    関わらず必ず交代する**。交代候補がいなければ、その枠は**空欄（不足として表示）**の\n    ままにする。v4は候補が誰もいない場合に限り4時間・5時間…と際限なく延長を許容していたが、\n    v5以降は「同じ人物を同じ持ち場に3時間を超えて連続配置することは禁止」という要件を\n    ハード制約として実装している（要件7「不足を無理に埋めない」を優先するため）。\n  - **交代の方向性**: 交代先の候補を選ぶ際、直前に**同じ業務**を担当していた人より、\n    **別の業務**を担当していた人を優先する（例: 直前にAをやっていた人がBに回るのを優先し、\n    Aから空いた直後にまたAへ、という「行ったり来たり」を避ける）。v5では時間帯ごとの\n    処理により、この判定が実際に機能するようになった。\n- **v7で追加: パート/アルバイトの優先配置と「空欄」防止セーフティネット**（要件根拠:\n  実際の完成イメージ例（Excel）を分析した結果、パート/アルバイトの勤務時間には\n  事務時間(OFFICE)も空欄も一切なく、常に実業務(A/B/全)で隙間なく埋まっていることを確認した）。\n  - パート/アルバイトは事務時間(OFFICE)の対象外という既存ルールがあるため、業務A/B/全の\n    候補選定（`sortCandidates`）では、ロール優先順位より先に「パート/アルバイトかどうか」で\n    並べ、常に最優先で実業務へ回るようにした。正社員等（事務時間に回せる人）が必要人数の\n    枠を先に埋めてしまい、パート/アルバイトが「勤務時間中なのに何も割り当てられない」\n    状態になることを防ぐため。\n  - それでも同一時間帯にパート/アルバイトがその時間の必要人数(cap)を超えて重なる場合に\n    備え、各時間帯の通常の割当て処理の最後に、まだ何も割り当てられていないパート/\n    アルバイトを、その時間帯に稼働中の業務(A/B/全)のいずれかへ必要人数を超えてでも\n    追加配置するセーフティネットを追加した。これは不足数の計算（`computeShortageCount`）\n    には影響しない（あくまで本人を空欄にしないための追加配置であり、必要人数を満たす\n    ためのものではない）。\n- **交代する場合の選び方**: ①パートタイムかどうか（実業務のみ担当可能なため最優先）→\n  ②INC・責任者かどうか（v8で追加。OFFICE優先のため実業務では最後尾）→\n  ③`RolePriority`（管理画面 `/role-priorities` で設定するロール優先順位。小さいほど優先。\n  デフォルトはINC→責任者→STAFF→CONTRACT→PARTTIME→OJT）→ ④直前と別の業務かどうか\n  （交代の方向性）→ ⑤その日すでに割り当てられた業務時間数が少ない人、の順で選ぶ\n  （`sortCandidates()`）。優先順位が未設定のロールはフォールバック値`999`（最低優先）\n  として扱う。`autoBackfill.ts`の`priorityOf()`と同じ考え方。\n- 必要人数（`cap`）に対して割り当てられる人がいない場合は、その枠は空白のまま\n  （`AUTO_ASSIGN_DEBUG=1` 環境変数を設定するとログに出力される）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:4-WHILL関連業務の割当てロジック:0",
  "title": "4. WHILL関連業務の割当てロジック",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "固定時刻・固定必要人数のイベントとして `WHILL_EVENTS` にハードコードしている\n（`docs/BUSINESS_RULES.md` の表と同じ内容）。**v5で優先度2に変更**（v4は優先度4だった。\n休憩の次、業務A/B/全より先にWHILLの必要人数を確保する）。\n\n- 対象スロットで、**休憩に入っていない人**（優先度1が先に確定済み）かつ\n  **パートスタッフではない人**の中から、業務A/B/全と同じ`sortCandidates()`（ロール優先順位→\n  業務時間数の少なさ）の順で必要人数だけ選ぶ。\n- 必要人数を満たせない場合は許容し、ログに残す。\n\n⚠️ 実装メモ: WHILL準備・片づけの「必要人数」は現状ハードコード（`TaskRequirement`テーブルは\n参照していない）。将来的に管理画面から人数を変更したい場合は、`TaskRequirement` から\n`WHILL_ARRIVAL_PREP` 等のコードで検索して上書きする形に拡張するとよい（今回は「DB schemaも\n既存API構造も変更しない」という要件のため、既存のCartPosition/TaskRequirementモデルを\nそのまま使いつつ、値は要件書通りの固定値としている）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:5-休憩の割当てロジック-v3で-経過時間ベース-に-v5で-最優先-Phase:0",
  "title": "5. 休憩の割当てロジック（v3で「経過時間ベース」に、v5で「最優先（Phase 2）」に、v8で条件を全面変更）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "**v5で変更**: 休憩は優先度1（Phase 2）として、業務A/B/全・WHILLより先に配置する。\n\n**v8で変更（旧ルールを完全に置き換え）**: 休憩の要否は「7時間以上勤務＝休憩1時間、\n6時間以下＝休憩なし」（6時間超7時間未満のシフトは運用上存在しない前提）。**パートタイム除外は撤廃**し、\nパートタイムも7時間以上勤務する場合は他の従業員と同じく休憩1時間を付与する\n（`MANDATORY_BREAK_MIN_SHIFT_HOURS = 7`）。夜勤（明番）は従来通り2時間連続。\n\n休憩は時間をずらして重ならないよう配置することを優先するが、それによって業務A/B/全の\n必要人数を満たせなくなる場合は、①まず休憩開始時刻を調整する→②それでも避けられなければ\n複数人の同時休憩を許容する→③最終的には休憩の分散よりも業務A/B/全の維持を優先する、\nという段階的な考え方をとる（実装上は、時間帯ごとの稼働人数(slack)が多いタイミングを\n優先するランキングでこの方向性を実現している）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:休憩の確実性の原則:0",
  "title": "休憩の確実性の原則",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "> 従業員の休憩の権利 > 不足ゼロ\n\n休憩を最初（何も割り当てられていない状態）に配置するため、v4にあった「空きが無ければ\n業務A/B/全の枠を1つ明け渡す（bump）」処理は不要になった（常に空きスロットに配置できる）。\n休憩を業務の後に配置していたv4までは、8時間以上勤務するスタッフが業務A/B/全の配置で\n時間帯を埋め尽くされてしまい休憩が取れない不具合があったが、v5の処理順序変更により\nこの問題は構造的に解消されている。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:タイミング:0",
  "title": "タイミング",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 最優先: **経過4時間**（`BREAK_ANCHOR_OFFSET`）に最も近いスロット。\n- 許容範囲: **経過3〜5時間**（`BREAK_ACCEPTABLE_MIN_OFFSET`〜`BREAK_ACCEPTABLE_MAX_OFFSET`）を\n  優先範囲とし、見つからなければシフト全体で「最初の1時間・最後の1時間を除いた範囲」\n  （＝勤務開始直後・終了直前を禁止する要件3の実装）まで探索を広げる。\n- 明け番（`isNightShift`）は**必ず2時間連続**。3時間以上には絶対に延長しない\n  （2時間連続が確保できない場合のみ1時間に妥協する。3時間になることはない）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:日をまたぐ夜勤の二重休憩を防ぐ-責任断片-の仕組み-重要・v5でも維持:0",
  "title": "日をまたぐ夜勤の二重休憩を防ぐ「責任断片」の仕組み（重要・v5でも維持）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "`buildAutoAssignPlan()`は1日（1シート）単位で呼び出される純粋関数であり、日をまたぐ夜勤\n（明け番）は当日側の断片・翌日側（引き継ぎ）の断片という**2回の別々の呼び出し**で処理される\n（`docs/ARCHITECTURE.md`参照）。休憩の必要性判定を単純に「この断片だけで4時間/8時間以上か」で\n行うと、**両方の断片が独立に「休憩が必要」と判断し、休憩が二重に入ってしまう**\n不具合があった（テストで確認済み。例: 22:00〜08:00の10時間夜勤で、本来2時間のはずの休憩が\n当日側1〜2時間＋翌日側1〜2時間＝最大4時間になっていた）。\n\nv4では、シフト全体（両断片の合計）の**中間時点**（`totalShiftHours / 2` 経過時点）が\nどちらの断片に属するかを決定的に計算し（`ownsBreakResponsibility`）、**その断片だけが\n休憩配置の責任を持つ**ようにした。中間時点は2つの断片の経過時間レンジ\n（`[hoursElapsedBeforeSheet, hoursElapsedBeforeSheet + fragmentLength)`）のどちらか片方にのみ\n含まれるため、責任が重複することはない。責任を持たない側の断片は、ベストエフォートの\n休憩配置すら行わない（ログに「このシートの断片は休憩配置の責任を持たない」と出力される）。\n日をまたがない通常のシフトは断片が1つしかないため、常にその断片が責任を持つ\n（＝挙動は変わらない）。\n\n`hoursElapsedBeforeSheet`（このシートに入る前にシフト開始から何時間経過していたか）の\n求め方は v3 から変更なし: 日をまたがない断片・当日側の断片は0。翌日側の引き継ぎ断片は\n`(4 - 開始時刻の時 + 24) % 24`（例: 22:00開始なら6時間）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:日をまたぐ夜勤の二重休憩を防ぐ-責任断片-の仕組み-重要・v5でも維持:1",
  "title": "日をまたぐ夜勤の二重休憩を防ぐ「責任断片」の仕組み（重要・v5でも維持）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- `breakOccupiedSlots` という共有のSetで「そのスロットで誰か休憩中か」を管理し、休憩の\n  時間をずらす（全員同時休憩の防止）。これは同一の`buildAutoAssignPlan()`呼び出し内\n  （＝同じ日のシート内）でのみ有効なスコープであることに注意。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:6-事務時間-OFFICE-の割当てロジック:0",
  "title": "6. 事務時間（OFFICE）の割当てロジック",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "すべての処理が終わったあと、**パートスタッフを除く**各従業員について、まだ何も入っていない\n稼働時間帯のスロットを `OFFICE` として埋める。これ以上の条件（必要人数など）はない\n（「余った時間だけ使う」というルールのため、事務時間には上限も下限もない）。\n\n**v8で追加: INC・責任者(RESPONSIBLE)のOFFICE優先**。INCは元々プロジェクトに存在するロールで、\n今回新設したのは「責任者」ロールのみ。通常時はINC・責任者をOFFICEに優先的に配置したいが、\nOFFICE自体は「残り時間を埋めるだけ」で必要人数の概念がないため、OFFICEフェーズ自体には\n手を加えていない。代わりに、業務A/B/全（Phase 4）・WHILL（Phase 3）の候補選定\n（`sortCandidates`）で、INC・責任者を「他に候補がいない場合のみ選ばれる最後尾」に\n位置づけている（`OFFICE_RESERVED_ROLES`）。これにより、業務A/B/全の必要人数を他の\nロールで満たせる限りINC・責任者はそちらに回らず、結果としてPhase 5で空いている時間が\n自動的にOFFICEとして埋まる。業務A/B/全の必要人数を現有スタッフだけでは満たせない\n場合は、INC・責任者も他の従業員と同様の扱いで業務A/B/全に回る（「INCはOFFICE専任」\nという制限は設けていない）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:7-型・関数のシグネチャ-呼び出し側との互換性:0",
  "title": "7. 型・関数のシグネチャ（呼び出し側との互換性）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "```ts\n// src/lib/dutySchedule.ts（Prisma非依存。稼働時間・必要人数の単一の情報源）\nexport type DutyCode = \"A\" | \"B\" | \"全\";\nexport type WhillCode = \"WHILL_ARRIVAL_PREP\" | \"WHILL_ARRIVAL_CLEANUP\"\n                       | \"WHILL_DEPARTURE_PREP\" | \"WHILL_DEPARTURE_CLEANUP\";\nexport const DUTY_WINDOW: Record<DutyCode, { startIdx: number; endIdx: number }>;\nexport const WHILL_EVENTS: { code: WhillCode; slotIndex: number; requiredCount: number; label: string }[];\nexport const PRODUCTIVE_CODES: readonly DutyCode[]; // [\"A\", \"B\", \"全\"]\nexport function isDutyActiveAtSlot(code: DutyCode, slot: number): boolean;\nexport function requiredCountAtSlot(code: DutyCode | WhillCode, slot: number, demandByCode?: Partial<Record<DutyCode, number>>): number;"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:7-型・関数のシグネチャ-呼び出し側との互換性:1",
  "title": "7. 型・関数のシグネチャ（呼び出し側との互換性）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "// src/lib/autoAssign.ts\nexport type SpecialCode = \"BREAK\" | \"OFFICE\";\nexport type AutoAssignEntry = {\n  employeeId: string;\n  slotIndex: number; // 0-23\n  code: DutyCode | WhillCode | SpecialCode;\n};\nexport type DemandByCode = Partial<Record<DutyCode, number>>;\nexport type PriorityByRole = Partial<Record<string, number>>; // role -> priorityOrder（小さいほど優先。未設定は999）\n\nexport function buildAutoAssignPlan(\n  rosterItems: DailyRosterItem[],\n  demandByCode?: DemandByCode,\n  priorityByRole?: PriorityByRole   // v3で追加。省略時は{}（優先順位なし＝従来通り）\n): AutoAssignEntry[];\n\nexport function computeShortageCount(\n  entries: AutoAssignEntry[],\n  activeSlotIndexes: Set<number>\n): number;\n```"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:7-型・関数のシグネチャ-呼び出し側との互換性:2",
  "title": "7. 型・関数のシグネチャ（呼び出し側との互換性）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "`priorityByRole` は**追加した3番目の引数**（末尾に追加、デフォルト値`{}`）であり、\n既存の2引数での呼び出し（`buildAutoAssignPlan(rosterItems, demandByCode)`）はそのまま動作する\n後方互換な変更。呼び出し元の `route.ts` では `prisma.rolePriority.findMany()` の結果から\n`{ [role]: priorityOrder }` の形にして渡している。\n\n`buildAutoAssignPlan` / `computeShortageCount` / `PRODUCTIVE_CODES` のシグネチャは\n2026-08改訂の前後で変更していない（`src/lib/autoBackfill.ts` が `PRODUCTIVE_CODES` を\nimportしているため、これを壊すと欠勤時の自動代替配置が動かなくなる）。\n\n`AutoAssignEntry.code` の型に新しいリテラル（`WhillCode`の一部、`OFFICE`）を追加しているが、\nこれは型の**拡張**であり、既存のコード（`\"A\" | \"B\" | \"全\" | \"BREAK\" | \"WHILL_DEPARTURE_PREP\" |\n\"WHILL_DEPARTURE_CLEANUP\"`）はすべてそのまま含まれている。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:8-API側の変更点-src-app-api-schedule-auto-ass:0",
  "title": "8. API側の変更点（`src/app/api/schedule/auto-assign/route.ts`）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- `positions` を取得する `cartPosition.findMany` の `code: { in: [...] }` に、新しく使うようになった\n  `\"OFFICE\"`, `\"WHILL_ARRIVAL_PREP\"`, `\"WHILL_ARRIVAL_CLEANUP\"` を追加した\n  （`\"WHILL_DEPARTURE_PREP\"` / `\"WHILL_DEPARTURE_CLEANUP\"` はもともと含まれていた）。\n- これら業務コードは `prisma/seed.ts` の `positions` 配列に**既に定義済み**だったため、\n  Prisma schemaの変更や新しいマイグレーションは不要（`CartPosition.code` は自由文字列の\n  `String @unique` であり、enumではない）。\n- `prisma.rolePriority.findMany()` を追加で呼び出し、結果を`priorityByRole`として\n  `buildAutoAssignPlan()`に渡すようにした（v3）。`RolePriority`モデル自体は元々存在しており、\n  今回はその「未使用だった既存データ」を自動アサインでも参照するようにしただけで、\n  schemaの変更は伴わない。\n- POST/GETのリクエスト・レスポンス形式（`{ date }` → `{ success, shortageCount, assignedCount }`、\n  `?month=` → `{ existingCount }`）は変更していない。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:11-日別スケジュール画面-src-app-schedule-date-page:0",
  "title": "11. 日別スケジュール画面（`src/app/schedule/[date]/page.tsx`）との連携",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 画面の「配置状況」行（不足表示）は、サーバー側の自動アサインと**同じ**\n  `src/lib/dutySchedule.ts` の稼働時間・WHILL定義を参照する（クライアントコンポーネントから\n  Prisma依存のファイルを直接importしないよう、稼働時間の定義だけをPrisma非依存の別ファイルに\n  切り出してある）。A/B/全の必要人数は `GET /api/task-requirements` から取得し、自動アサインAPI\n  （`route.ts`）と同じロジック（`appliesToAllRoles`の要件を優先、なければ先頭の要件、未設定なら1）\n  で算出している。\n- 画面の社員表示順（`buildDailyRosterView()`が返す並び順）は role/yakuwari では決めず、\n  「勤務開始時刻→勤務終了時刻→氏名」の順に統一した（詳細は `src/lib/dailyRoster.ts` および\n  BUSINESS_RULES.md）。\n- 画面から「シフト」列を削除した（`shiftTypeCode`自体やDBの`ShiftType`関連ロジックは削除しておらず、\n  表示のみの変更）。Excel/PDF出力（`src/app/api/export/schedule-excel`, `schedule-pdf`）には\n  シフト列がまだ残っている。今回のスコープは「日別スケジュール画面」のみだったため、\n  出力ファイル側は意図的に変更していない（TODO.md参照）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:9-デバッグ方法:0",
  "title": "9. デバッグ方法",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "環境変数 `AUTO_ASSIGN_DEBUG=1` を設定して自動アサインを実行すると、以下のようなケースで\n`console.log(\"[autoAssign]\", ...)` によるログが出力される（「なぜその配置になったか」の追跡用）。\n\n- 業務A/B/全のある時間帯・ある枠に配置できる人がいなかった場合\n- WHILL業務で必要人数を満たせなかった場合\n- 明け番の2時間連続休憩を確保できず1時間に妥協した場合\n- 休憩を入れる空きスロットが1つもなかった場合"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:10-意図的に変更しなかったこと:0",
  "title": "10. 意図的に変更しなかったこと",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 既存の業務コード名・DB schema・API入出力形式は変更していない。\n- パートスタッフの週20時間上限（`weeklyHours.ts`）はそのまま利用（変更なし）。\n- `autoBackfill.ts`（欠勤時の自動代替配置）は今回の改修対象外（`PRODUCTIVE_CODES` の\n  互換性のみ維持）。`autoBackfill.ts`は元々`RolePriority`を使っており、今回の\n  優先順位バグ修正はこのファイルの既存ロジックと同じ考え方に自動アサイン側を合わせた形になる。\n  ただし`autoBackfill.ts`はA/B/全のみを対象としており、WHILL関連業務・休憩・事務時間の優先順位\n  ルール（本ドキュメント冒頭）には対応していない。必要であれば別途改修を検討すること（TODO.md参照）。\n- `src/lib/dailyStaffing.ts`（`getDailyStaffingStatus()`）は**別の指標**であり、今回の\n  「配置状況（時間帯ごとの不足）」修正の対象外。こちらは「1日の必要合計人数 vs 出勤予定人数」を\n  時間帯を区別せずに比較する日単位の粗い指標で、`ShiftClaimRequest`（勤務希望申請）機能が\n  「今後30日で人員が足りなそうな日」を一覧するために使っている。時間帯別の考慮がないという\n  設計自体は今回のバグとは異なる（元々「日単位」の指標として設計されている）ため、変更していない。\n  時間帯を考慮した不足判定が欲しい場合は、`dutySchedule.ts`を使って作り直す必要がある\n  （TODO.mdに記載）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:11-サンプルExcel-完成イメージ例-との照合で見つかった2件の差異-意図的:0",
  "title": "11. サンプルExcel（完成イメージ例）との照合で見つかった2件の差異（意図的に据え置き）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "サンプルExcelを時間帯単位に分解して現在の実装と照合した際、以下の2点は現在の実装と\n一致しなかったが、**単日分のExcelだけでは正しい仕様と断定できない**ため、あえて修正せず\n既存の実装を維持した。将来、複数日分のサンプルや業務側の明確な追加要件が得られた場合に\n再検討する（TODO.md参照）。\n\n1. **日をまたぐ夜勤（明け番）の引き継ぎ断片でのBREAK**: サンプルでは4:00〜5:00\n   （経過6〜7時間相当）にBREAKが入っている例が1件あったが、これは現在の\n   `BREAK_ACCEPTABLE_MIN_OFFSET`〜`MAX_OFFSET`（経過3〜5時間）にも、\n   `ownsBreakResponsibility`（シフト中間点に基づく担当判定）にも当てはまらない。\n   前日側の断片（Excelに含まれない）で本来休憩が確保されるべきケースであり、\n   単日分のExcelだけでは「前日側で休憩を確保できなかった場合の埋め合わせ」なのか\n   「サンプル作成時のデータの揺らぎ」なのか判別できない。二重休憩防止の仕組み\n   （セクション5参照）は複数日にまたがる整合性を守るための重要な安全機構のため、\n   確証のないまま緩めることはしなかった。\n2. **時間帯の境界での30分単位の切り替え**: サンプルの一部（明け番の最終コマ）に\n   1時間ちょうどではなく30分単位の切り替わりが見られたが、`slotIndex`は1時間単位\n   （0〜23）で設計されており、30分粒度への変更はAPI・DB・画面表示を含む大規模な\n   アーキテクチャ変更になる。単発の1件のみで、業務要件として明示されていないため、\n   サンプル作成時の表記ゆれとみなし、1時間単位の設計を維持した。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:12-1-業務-全-の工程ローテーション-src-lib-autoAssign-:0",
  "title": "12-1. 業務「全」の工程ローテーション（`src/lib/autoAssign.ts` Phase 4）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 対象は業務「全」のみ。A・Bのロジックは変更していない。\n- 同じ人が「全」を2時間連続したら、交代できる人がいれば交代する（交代候補は空いている人。INC・責任者は\n  事務時間優先のため、この任意の交代の候補には含めない）。\n- 交代できる人がいない場合のみ3時間目まで継続を許可する。\n- 3時間に達したら必ず交代。**4時間以上は絶対に配置しない**（交代候補がいなければ空欄＝人員不足として残す）。\n- 注意: 「全」の交代が変わると、後続コマで誰が空くかが変わるため、A/Bの担当者の並びが変わることがある\n  （A/Bのルール・必要人数は同じ）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:12-2-22時勤務-3人-4人-のBreak開始時間とバッテリー交換-src-:0",
  "title": "12-2. 22時勤務（3人/4人）のBreak開始時間とバッテリー交換（`src/lib/nightCrewPlan.ts` / Phase 2-N）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- Breakの長さは120分のまま。変更するのは**開始時間のみ**。日勤のBreakロジック（Phase 2）は変更なし。\n- 開始候補は1:00 / 2:00 / 3:00。希望パターン: 4人=1:00×1・2:00×2・3:00×1、3人=2:00×2・3:00×1。\n  ただし120分のままだと同時に3人がBreakになるため、**同時Break最大2人**を優先し、希望との差が最小に\n  なるよう自動調整する（結果: 4人=1:00×2・3:00×2、3人=1:00・2:00・3:00に1人ずつ）。\n- バッテリー交換（業務コード `BATTERY_EXCHANGE`、必要人数1人、60分）:\n  - 対象は22時勤務のみ（日勤には自動割当てしない）。パート・アルバイトは対象外（WHILLと同じ扱い）。\n  - 1回目: 1:00または2:00のどちらか（範囲外には変更しない）。Break・他業務と重ならず、人員不足が出ない\n    時刻を自動選択する。2回目: 4:00固定（翌日シートの明番メンバーが担当）。\n- 選択の優先順位: ①他業務の人員不足なし ②バッテリー未配置なし ③3時間連続の交代要員が不足しない\n  ④Break開始時間の希望との差 ⑤同一人物が2回担当しない ⑥余裕の大きい時刻 ⑦決定的な順序。\n- 3:00開始のBreak(3:00〜5:00)の後半と4:00のバッテリー交換は翌日シートに現れる。夜勤メンバー一覧と\n  必要人数設定だけで決まる純粋関数のため、当日シートと翌日シートが同じ計画を再現する（DBの他日データに依存しない）。\n- 22時勤務が3人・4人以外の場合は従来ロジック（Phase 2）でBreakを配置し、バッテリー交換は自動割当てしない\n  （自動割当て完了時に注意メッセージを返す）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:12-3-人員不足の数え方:0",
  "title": "12-3. 人員不足の数え方",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 旧 `computeShortageCount` は削除。稼働時間・必要人数を見ずに「業務が1件も無いコマ」を数えていたため、\n  必要人数が埋まっていても不足と表示されていた（22時勤務がいる日は毎日13件になる）。\n- 現在は `computeShortageCells`（`src/lib/dutySchedule.ts`）で、**保存後の実際の割当て(DailyAssignment)**から\n  稼働中のA/B/全とWHILL固定イベントについて「必要人数 > 実配置人数」のコマだけを数える。\n  日別スケジュール画面の赤表示と同じ関数を使うため、件数と画面が必ず一致する。\n- バッテリー交換は必要人数の集計対象外（夜勤がいない日に不足表示が出ないため）。未配置の場合は\n  API応答の `warnings` で知らせる。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:12-4-60分業務:0",
  "title": "12-4. 60分業務",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- WHILL到着片づけ/到着準備/出発片づけ/出発準備/バッテリー交換は60分単位（`SIXTY_MINUTE_CODES`）。\n  日別スケジュール画面では1つのセルにまとめて表示し、30分に分割しない。別の業務(空欄含む)に変更すると\n  その1時間全体が置き換わる。60分業務を30分セルに選んだ場合もその1時間分として保存される。\n- 通常業務は従来どおり30分単位（自動割当ての1時間レコードを片側だけ編集すると2つの30分レコードに分割）。"
 },
 {
  "id": "docs-AUTO_ASSIGN_RULES-md:12-5-API-POST-api-schedule-auto-assign:0",
  "title": "12-5. API（`POST /api/schedule/auto-assign`）",
  "source": "docs/AUTO_ASSIGN_RULES.md",
  "keywords": [],
  "text": "- 応答に `shortageCells`（不足のコマ詳細）、`warnings`、`droppedCount`（業務マスタに無く保存できなかった件数）を追加。\n  `shortageCount` は上記の再計算値。\n- 実行時に業務「バッテリー交換」が無ければ自動で業務マスタに追加する（`ensureBatteryPosition`）。"
 },
 {
  "id": "docs-DATABASE-md:DATABASE-md-Prisma-Schema-解説:0",
  "title": "DATABASE.md — Prisma Schema 解説",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "> ソース: `prisma/schema.prisma`（全14モデル + 補助enum）。PostgreSQL + Prisma 5.20.0。\n> このファイルの内容を変更する場合は必ずマイグレーションを作成し、`docs/CHANGELOG.md` に記録すること。"
 },
 {
  "id": "docs-DATABASE-md:モデル一覧と役割:0",
  "title": "モデル一覧と役割",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "| モデル | 役割 |\n|---|---|\n| `ClaimRegistrationHold` | 月別の勤務希望登録の停止状態（`month`ユニーク、`isStopped`、`updatedBy`）。行がない月は受付中。 |\n| `User` | ログインアカウント（ADMIN/INC/EMPLOYEE）。`Employee` と1:1で紐付け可能。 |\n| `Employee` | 従業員マスタ。氏名・役割・通勤方法・基本勤務時間など。 |\n| `ShiftType` | シフト種別マスタ（明番/早番/中番/遅番/超早/超遅/午前番）。`requiredCount`=基本必要人数（INCが「スケジュール設定」→「勤務時間設定」タブで設定。旧：人数設定 /shift-settings）。 |\n| `ShiftTimeBand` | シフト内の時間帯別必要人数（`startTime`/`endTime`/`requiredCount`）。設定がある時間帯は基本必要人数より優先。 |\n| `MonthRoster` | **月間**の出退勤ステータス（WORK/OFF/PAID_LEAVE/ADJUST_LEAVE）+ シフト種別 + その日だけの例外時間。 |\n| `CartPosition` | 業務マスタ（A/B/全/BF/休憩/移動/WHILL関連/事務時間/MTG）。 |\n| `TaskRequirement` | 業務ごとの必要人数・対象ロール。 |\n| `RolePriority` | 自動バックフィル時にどの`EmployeeRole`を優先するか。 |\n| `CartOperatingHours` | 業務の稼働時間テンプレート（曜日区分ごと）。 |\n| `DemandTemplate` | 30分スロット単位の契約人員需要テンプレート。 |\n| `DailyAssignment` | **日別**の実際の割当て（1時間スロット×業務×従業員）。自動アサインが書き込む中心テーブル。 |\n| `Break` | 休憩時間の記録。 |\n| `RotationPattern` / `EmployeeRotationPattern` | 勤務ローテーションパターン（4勤2休など）とその適用。 |\n| `PersonalConstraint` | 従業員ごとのNG/OK制約。 |\n| `IncidentFlag` | 遅刻・遅延・早退・残業などの実績フラグ。 |\n| `ShiftClaimRequest` | 人員不足日への出勤希望申請（EMPLOYEE申請→INC/管理者承認）。 |\n| `ShiftAdjustmentConfirmation` | 「人員不足を確定」のスナップショット（月ごと1件）。2026-10: 1回目メール送信記録 `notifiedAt` / `notifiedBy` / `notifyResult(Json)` を追加（nullable）。 |\n| `MonthRosterConfirmation` | 月ごとの「調整中／確定」状態（`status`）。メール配信が全員成功した月だけ `CONFIRMED`。`revision`（シフト修正で加算）・`revisedAfterConfirm`（再配信が必要）・`lastDelivery*`（直近の配信結果。再送時に送信済みの人を飛ばすため）を持つ。行なし＝調整中。一般従業員が勤務表を閲覧できるかの判定に使う。 |\n| `RosterAuditLog` | 変更履歴（汎用の監査ログ）。 |"
 },
 {
  "id": "docs-DATABASE-md:主要なリレーション:0",
  "title": "主要なリレーション",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "```\nUser 1─1 Employee\nEmployee 1─N MonthRoster, DailyAssignment, Break, PersonalConstraint,\n             IncidentFlag, EmployeeRotationPattern, ShiftClaimRequest\nMonthRoster N─1 ShiftType\nCartPosition 1─N TaskRequirement, CartOperatingHours, DemandTemplate, DailyAssignment\nRotationPattern 1─N EmployeeRotationPattern N─1 Employee\n```"
 },
 {
  "id": "docs-DATABASE-md:Employee:0",
  "title": "`Employee`",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `role: EmployeeRole`（`STAFF`/`CONTRACT`/`PARTTIME`/`OJT`/`INC`/`RESPONSIBLE`）— **業務上の役割**\n  （`RESPONSIBLE`＝責任者、2026-09 v8で追加）。\n  自動アサインのパート制限判定（WHILL・事務時間禁止）はこのフィールドを見る。\n- `baseStartTime` / `baseEndTime` — 従業員固有の基本勤務時間（`workTime.ts`のフォールバック）。\n- `contactEmail` — 月間スケジュール確定通知の送信先。"
 },
 {
  "id": "docs-DATABASE-md:MonthRoster:0",
  "title": "`MonthRoster`",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `@@unique([employeeId, workDate])` — 1人1日1レコード。\n- `overrideStartTime` / `overrideEndTime` — その日だけの例外的な勤務時間。設定されていれば\n  `ShiftType`や`baseStartTime`より優先される（`resolveWorkTime()`の優先順位）。\n- `status`: `WORK`のみが「出勤」として扱われ、`autoAssign`や`dailyStaffing`の集計対象になる。"
 },
 {
  "id": "docs-DATABASE-md:CartPosition:0",
  "title": "`CartPosition`",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `code: String @unique` — **enumではなく自由文字列**。新しい業務を追加する際にPrisma\n  schemaの変更は不要（`prisma/seed.ts`にレコードを追加するだけでよい）。今回のWHILL関連業務・\n  事務時間もこの仕組みで追加済み。\n- `category`: `CART`（A/B/全のような乗車業務）と`SPECIAL`（休憩・WHILL・事務時間など）を区別。"
 },
 {
  "id": "docs-DATABASE-md:TaskRequirement:0",
  "title": "`TaskRequirement`",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `requiredCount` — 自動アサインの`demandByCode`（時間帯あたり必要人数）の元データ。\n- `appliesToAllRoles` / `targetRoles` — 特定ロール限定の要件を将来的に表現できる設計だが、\n  現状の自動アサインロジックは`appliesToAllRoles`の要件（または先頭の要件）のみ参照する\n  （`route.ts`の`demandByCode`算出部分）。"
 },
 {
  "id": "docs-DATABASE-md:DailyAssignment:0",
  "title": "`DailyAssignment`",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `slotStart` / `slotEnd` — `\"HH:00\"`形式の文字列（自動アサインは1時間スロット単位）。\n- `source`: `\"AUTO\"`（自動アサイン由来）/ `\"MANUAL\"`（手動編集）。\n- `@@index([workDate, slotStart])`, `@@index([employeeId, workDate])` — 日別ビュー表示・\n  自動アサインの一括削除/作成で使われるインデックス。"
 },
 {
  "id": "docs-DATABASE-md:AiMemory-v20・追加のみ:0",
  "title": "`AiMemory`（v20・追加のみ）",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "AI依頼の整理済みメモ。`scope`=対象月(`2026-11`)、`note`=依頼と結果の要点(160文字程度)、`createdBy`=操作者メール、`createdAt`。月ごと最大20件を超えた古いメモは自動削除。会話の全文は保存しない。"
 },
 {
  "id": "docs-DATABASE-md:RotationPattern-patternDefinition-Json:0",
  "title": "`RotationPattern.patternDefinition`（Json）",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "固定フォーマット:\n```json\n{ \"cycleDays\": 6, \"pattern\": [\"WORK\",\"WORK\",\"WORK\",\"WORK\",\"OFF\",\"OFF\"] }\n```\n正社員・契約社員向けにはシフト種別も含めた拡張形式:\n```json\n{ \"cycleDays\": 12, \"pattern\": [...], \"shiftCodes\": [\"早番\",\"早番\",\"早番\",\"早番\",null,null,\"遅番\",...] }\n```\n`shiftCodes`が無い場合は従来通り出勤/公休のみを設定する（後方互換）。"
 },
 {
  "id": "docs-DATABASE-md:むやみに変更してはいけないフィールド:0",
  "title": "むやみに変更してはいけないフィールド",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `CartPosition.code` — 自動アサインエンジン（`autoAssign.ts`）や各種UIがこの文字列を\n  直接参照しているため、既存コードの意味を変えるリネームは既存データ・ロジックを壊す。\n- `MonthRoster` / `DailyAssignment` の `@@unique` / `@@index` 制約 — 自動アサインの\n  「削除→一括作成」処理やUIの一意性前提に依存している。\n- `EmployeeRole` / `RosterStatus` / `ConstraintType` などのenum値 — 表示ラベルや\n  ロジック分岐（`STATUS_LABEL`、パート判定など）にハードコードされている箇所が複数ある。"
 },
 {
  "id": "docs-DATABASE-md:未確認・要確認事項:0",
  "title": "⚠️ 未確認・要確認事項",
  "source": "docs/DATABASE.md",
  "keywords": [],
  "text": "- `IncidentType`（LATE/DELAY/EARLY_LEAVE/OVERTIME/BF_FEE_CUT/OWN_CAR_COMMUTE/ONE_WAY_TAXI）を\n  実際にどの画面から記録するかは、今回確認した範囲のAPI/画面一覧には見当たらなかった\n  （schema上は定義済みだが、利用箇所は未確認）。"
 },
 {
  "id": "docs-ARCHITECTURE-md:全体像:0",
  "title": "全体像",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "WHILL Scheduler は、パシフィック・クルー株式会社の勤務表（月間ローテーション + 日別の業務配置）を\nExcel手入力から置き換えるための社内向けWebアプリケーション。単一の Next.js アプリが\nフロントエンド（ページ）とバックエンド（APIルート）の両方を兼ねる、いわゆるモノリシック構成。\n\n```\n[ブラウザ]\n   │  React (Client Components) — 画面操作・入力\n   ▼\n[Next.js App Router]\n   ├─ src/app/<page>/page.tsx   … 画面（フロントエンド）\n   └─ src/app/api/**/route.ts  … APIルート（バックエンド）\n        │\n        ▼\n[src/lib/*.ts]                 … ビジネスロジック（自動アサイン、勤務時間解決、週間上限チェック等）\n        │\n        ▼\n[Prisma Client] ──▶ [PostgreSQL]  … 永続化層（prisma/schema.prisma が唯一の正）\n```\n\nデプロイは Vercel（Next.jsをそのままホスティング）、DBはNeon/Supabaseなどの外部PostgreSQLを\n`DATABASE_URL` 環境変数で接続する構成（README.md参照）。"
 },
 {
  "id": "docs-ARCHITECTURE-md:1-フロントエンド-src-app-page-page-tsx:0",
  "title": "1. フロントエンド（`src/app/<page>/page.tsx`）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "- 全画面が日本語UI。管理者（ADMIN）は全機能、EMPLOYEEは自分の勤務閲覧のみ、INCは監督役割。\n- 主要画面: ホーム / アカウント設定（旧：従業員管理・アカウント管理）/ スケジュール設定（旧：業務管理＋人数設定）/ 月間勤務表（Master Roster）/\n  日別スケジュール（Daily Assignment）/ 業務・業務要件管理 / 勤務希望申請。\n- 認証必須ページは `src/middleware.ts` で保護される。"
 },
 {
  "id": "docs-ARCHITECTURE-md:2-API-src-app-api-route-ts:0",
  "title": "2. API（`src/app/api/**/route.ts`）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "- Next.js の Route Handler（GET/POST/PATCH/DELETE を個別にexport）。\n- すべてのAPIで `getServerSession(authOptions)` によりログイン必須、多くは `role === \"ADMIN\"` の\n  チェックを行う（詳細は API.md）。\n- 入力バリデーションは `zod` を使用。"
 },
 {
  "id": "docs-ARCHITECTURE-md:3-ビジネスロジック-src-lib-ts:0",
  "title": "3. ビジネスロジック（`src/lib/*.ts`）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "APIルートから呼ばれる、DBアクセスを含む純粋なロジック層。"
 },
 {
  "id": "docs-ARCHITECTURE-md:3-ビジネスロジック-src-lib-ts:1",
  "title": "3. ビジネスロジック（`src/lib/*.ts`）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "| ファイル | 役割 |\n|---|---|\n| `dutySchedule.ts` | 業務A/B/全・WHILL関連業務の稼働時間・必要人数の定義（Prisma非依存）。`autoAssign.ts`（サーバー）と日別スケジュール画面（クライアント）の両方が同じ定義を参照する単一の情報源。 |\n| `autoAssign.ts` | **自動アサインエンジン本体。** 1日分のスタッフ一覧から、業務A/B/全・WHILL関連業務・休憩・事務時間の割当てプランを計算する（DB非依存の純粋関数）。詳細は AUTO_ASSIGN_RULES.md。 |\n| `dailyRoster.ts` | MonthRoster（月間）から、指定日の出勤スタッフ一覧＋各自の実稼働時間帯（営業日インデックス）を構築する。前日22:00開始の夜勤（明け番）の引き継ぎ表示もここで処理。 |\n| `dailyStaffing.ts` | その日の必要人数（TaskRequirement合算）と出勤予定人数を比較し、不足人数を返す。 |\n| `autoBackfill.ts` | 従業員が急に休み（公休/有休/調整休）になった際、その人が担当していた業務A/B/全の枠を、優先順位（RolePriority）に従って他の出勤者で自動的に埋め直す。 |\n| `weeklyHours.ts` | 週（日〜土）の合計勤務時間を計算。パートスタッフの週20時間上限チェックに使用。 |\n| `workTime.ts` | 1日の勤務時間を「その日の例外時間 > ShiftType > 従業員の基本勤務時間」の優先順位で解決する。 |\n| `timeSlots.ts` | 4:00始まり24時間の「営業日インデックス」と実時刻の相互変換。 |\n| `auth.ts` | NextAuthのCredentials Provider設定（email/password + bcrypt）。 |\n| `mailer.ts` | 月間スケジュール確定時などのメール通知（nodemailer）。 |\n| `prisma.ts` | PrismaClientのシングルトンインスタンス。 |"
 },
 {
  "id": "docs-ARCHITECTURE-md:4-データベース-prisma-schema-prisma:0",
  "title": "4. データベース（`prisma/schema.prisma`）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "PostgreSQL + Prisma。詳細は DATABASE.md。"
 },
 {
  "id": "docs-ARCHITECTURE-md:時間-の扱い方-重要・複数ファイルにまたがる設計:0",
  "title": "「時間」の扱い方（重要・複数ファイルにまたがる設計）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "このプロジェクト全体で、営業日を **4:00始まり・24個の1時間スロット（インデックス0〜23）** として\n扱う設計が一貫している（`timeSlots.ts`）。\n\n- `operatingIndex(hour)`: 実時刻（0-23時）→ 営業日インデックスに変換。例: 4時→0, 5時→1, 3時→23。\n- 22:00開始のような夜勤（明番）は、当日シートでは「4:00〜シフト終了時刻」の**引き継ぎ**として、\n  翌日側の `dailyRoster.ts` の処理で別途表示される（`isCarryOver: true`）。\n- `autoAssign.ts` の `slotIndex` もこのインデックスに準拠しており、`WHILL_EVENTS` の固定時刻\n  （例: 10:00〜11:00）もすべて `operatingIndex()` を通して変換している。\n\nこの設計を無視して「0時始まりの24時間」として実装すると、夜勤の引き継ぎやWHILL業務の時刻が\nズレるため、時間まわりを触る際は必ず `timeSlots.ts` を経由すること。"
 },
 {
  "id": "docs-ARCHITECTURE-md:データの流れ-自動アサインの例:0",
  "title": "データの流れ（自動アサインの例）",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "```\n[管理者が「自動割当」ボタンを押す]\n        │\n        ▼\nPOST /api/schedule/auto-assign { date }\n        │\n        ├─ buildDailyRosterView(date)         … その日の出勤者一覧＋実稼働時間帯を取得\n        ├─ CartPosition + TaskRequirement取得  … 業務A/B/全の時間帯あたり必要人数(demandByCode)\n        │\n        ▼\nbuildAutoAssignPlan(rosterItems, demandByCode)  … src/lib/autoAssign.ts（DB非依存の純粋関数）\n        │  優先順位: 業務A→業務B→業務全→WHILL→休憩→事務時間\n        ▼\nAutoAssignEntry[]（employeeId, slotIndex, code）\n        │\n        ▼\nDailyAssignment テーブルへ一括保存（削除→createMany のトランザクション）\n        │\n        ▼\ncomputeShortageCount() で不足数を計算し、APIレスポンスとして返す\n```"
 },
 {
  "id": "docs-ARCHITECTURE-md:認証・認可:0",
  "title": "認証・認可",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "- NextAuth（Credentials Provider）+ JWT セッション。JWTに `id / role / employeeId` を格納\n  （`src/types/next-auth.d.ts` で型拡張）。\n- `UserRole`: `ADMIN`（全権限）/ `INC`（現状未使用、将来の管理職拡張用）/ `EMPLOYEE`（閲覧のみ）。\n- `EmployeeRole`（業務上の役割。UserRoleとは別軸）: `STAFF` / `CONTRACT` / `PARTTIME` / `OJT` /\n  `INC` / `RESPONSIBLE`（責任者。2026-09 v8で追加）。自動アサインのパート制限\n  （WHILL・事務時間禁止）、およびINC・責任者のOFFICE優先ルールはこちらの `EmployeeRole` を見る\n  （`src/lib/autoAssign.ts`、docs/AUTO_ASSIGN_RULES.md参照）。\n- `src/middleware.ts` が保護対象ページへの未ログインアクセスをブロックする。"
 },
 {
  "id": "docs-ARCHITECTURE-md:外部連携:0",
  "title": "外部連携",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "- **メール**: `nodemailer` 経由（`src/lib/mailer.ts`）。月間スケジュール確定時の通知等。\n- **AI機能**: `openai` を使った `POST /api/roster/ai-assist`（月間ローテーションのAI提案）と\n  `POST /api/roster/apply-ai-changes` / `POST /api/ai-confirm`（提案の適用）。これは\n  **自動アサインエンジン（`autoAssign.ts`）とは別の独立した機能**であることに注意。月間ローテーション\n  （出勤/公休パターン）向けのAI支援であり、日別の業務配置（A/B/全/WHILL等）は関与しない。\n- **Excel/PDF出力**: `exceljs`（Excel）、`pdfkit`（PDF）。`src/app/api/export/*` 配下。"
 },
 {
  "id": "docs-ARCHITECTURE-md:未確認・要確認事項:0",
  "title": "⚠️ 未確認・要確認事項",
  "source": "docs/ARCHITECTURE.md",
  "keywords": [],
  "text": "- `INC` ロール（UserRole/EmployeeRole双方に存在）の権限設計は AI_CONTEXT.md にも記載の通り\n  「実装が必要」というコメントがコード上に残っており、現状の挙動は完全には確定していない。"
 },
 {
  "id": "schema:0",
  "title": "DBスキーマ（Prisma）",
  "source": "prisma/schema.prisma",
  "keywords": [
   "DB",
   "テーブル",
   "データベース",
   "モデル",
   "スキーマ",
   "項目"
  ],
  "text": "ShiftAdjustmentConfirmation(id:String, month:String, shortagesByDate:Json, confirmedAt:DateTime, confirmedBy:String?, notifiedAt:DateTime?, notifiedBy:String?, notifyResult:Json?)\nMonthRosterConfirmation(id:String, month:String, status:RosterMonthStatus, confirmedAt:DateTime?, confirmedBy:String?, revisedAfterConfirm:Boolean, revisedAt:DateTime?, revisedBy:String?, revision:Int, lastDeliveryAt:DateTime?, lastDeliveryRevision:Int?, lastDeliveryResult:Json?, updatedAt:DateTime)\nUser(id:String, email:String, passwordHash:String, name:String, role:UserRole, employeeId:String?, createdAt:DateTime, employee:Employee?)\nEmployee(id:String, fullName:String, role:EmployeeRole, commuteType:CommuteType?, isActive:Boolean, note:String?, createdAt:DateTime, updatedAt:DateTime, baseEndTime:String?, baseStartTime:String?, contactEmail:String?, priorityOrder:Int, user:User?)\n"
 },
 {
  "id": "schema:1",
  "title": "DBスキーマ（Prisma）",
  "source": "prisma/schema.prisma",
  "keywords": [
   "DB",
   "テーブル",
   "データベース",
   "モデル",
   "スキーマ",
   "項目"
  ],
  "text": "ShiftType(id:String, code:String, name:String, defaultStartTime:String, defaultEndTime:String, spansMidnight:Boolean, requiredCount:Int?)\nShiftTimeBand(id:String, shiftTypeId:String, startTime:String, endTime:String, requiredCount:Int, shiftType:ShiftType)\nMonthRoster(id:String, employeeId:String, workDate:DateTime, shiftTypeId:String?, status:RosterStatus, createdBy:String?, updatedBy:String?, updatedAt:DateTime, createdAt:DateTime, overrideEndTime:String?, overrideStartTime:String?, employee:Employee, shiftType:ShiftType?)\nCartPosition(id:String, code:String, name:String, category:PositionCategory, description:String?, isActive:Boolean, operatingEndTime:String?, operatingStartTime:String?, color:String?)\n"
 },
 {
  "id": "schema:2",
  "title": "DBスキーマ（Prisma）",
  "source": "prisma/schema.prisma",
  "keywords": [
   "DB",
   "テーブル",
   "データベース",
   "モデル",
   "スキーマ",
   "項目"
  ],
  "text": "TaskRequirement(id:String, cartPositionId:String, appliesToAllRoles:Boolean, requiredCount:Int, note:String?, isActive:Boolean, createdAt:DateTime, updatedAt:DateTime, cartPosition:CartPosition)\nRolePriority(id:String, role:EmployeeRole, priorityOrder:Int, updatedAt:DateTime)\nCartOperatingHours(id:String, cartPositionId:String, dayTemplate:String, startTime:String, endTime:String, cartPosition:CartPosition)\nDemandTemplate(id:String, cartPositionId:String, dayTemplate:String, timeSlot:String, requiredCount:Int, cartPosition:CartPosition)\nDailyAssignment(id:String, employeeId:String, workDate:DateTime, slotStart:String, slotEnd:String, cartPositionId:String, source:String, createdAt:DateTime, updatedAt:DateTime, cartPosition:CartPosition, employee:Employee)\n"
 },
 {
  "id": "schema:3",
  "title": "DBスキーマ（Prisma）",
  "source": "prisma/schema.prisma",
  "keywords": [
   "DB",
   "テーブル",
   "データベース",
   "モデル",
   "スキーマ",
   "項目"
  ],
  "text": "Break(id:String, employeeId:String, workDate:DateTime, breakStart:String, breakEnd:String, requiredMinutes:Int, actualMinutes:Int?, employee:Employee)\nRotationPattern(id:String, code:String, name:String, patternDefinition:Json, isActive:Boolean)\nEmployeeRotationPattern(id:String, employeeId:String, rotationPatternId:String, anchorDate:DateTime, createdAt:DateTime, isCurrent:Boolean, employee:Employee, rotationPattern:RotationPattern)\nPersonalConstraint(id:String, employeeId:String, workDate:DateTime, rangeStart:String?, rangeEnd:String?, constraintType:ConstraintType, note:String?, employee:Employee)\nIncidentFlag(id:String, employeeId:String, workDate:DateTime, flagType:IncidentType, note:String?, recordedBy:String?, recordedAt:DateTime, employee:Employee)\n"
 },
 {
  "id": "schema:4",
  "title": "DBスキーマ（Prisma）",
  "source": "prisma/schema.prisma",
  "keywords": [
   "DB",
   "テーブル",
   "データベース",
   "モデル",
   "スキーマ",
   "項目"
  ],
  "text": "ShiftClaimRequest(id:String, employeeId:String, workDate:DateTime, status:ShiftClaimStatus, requestedAt:DateTime, decidedAt:DateTime?, decidedBy:String?, shiftTypeId:String?, requestedStartTime:String?, requestedEndTime:String?, cancelRequestedAt:DateTime?, employee:Employee, shiftType:ShiftType?)\nShortageMailLog(id:String, month:String, employeeId:String, employeeName:String, status:String, mode:String?, reason:String?, attempts:Int, sentAt:DateTime?, sentBy:String?, updatedAt:DateTime, createdAt:DateTime)\nRosterAuditLog(id:String, tableName:String, recordId:String, action:String, changedBy:String?, changedAt:DateTime, oldValue:Json?, newValue:Json?)\nClaimRegistrationHold(id:String, month:String, isStopped:Boolean, updatedBy:String?, updatedAt:DateTime)\nAiMemory(id:String, scope:String, note:String, createdBy:String?, createdAt:DateTime)\n"
 },
 {
  "id": "api:0",
  "title": "APIと権限",
  "source": "src/app/api",
  "keywords": [
   "API",
   "権限",
   "エンドポイント",
   "認証"
  ],
  "text": " /api/auth/[...nextauth] — 公開\nDELETE/PATCH /api/cart-positions/[id] — ADMIN/INC\nGET /api/export/roster-excel — ログイン必須\nGET /api/export/schedule-excel — ADMIN/INC\nGET /api/export/schedule-pdf — ADMIN/INC\nGET /api/roster/month-status — ADMIN/INC\nGET /api/roster/shift-adjustment — ADMIN/INC\nGET /api/rotation-patterns — ログイン必須\nGET /api/schedule/required-headcount — ログイン必須\nGET /api/shift-claims/my-month — ログイン必須\nGET /api/shortage/preview — ADMIN/INC\nGET/PATCH /api/role-priorities — ADMIN/INC\nGET/POST /api/cart-positions — ADMIN/INC\nGET/POST /api/employees — ADMIN/INC\nGET/POST /api/roster — ADMIN/INC\nGET/POST /api/roster/confirm-month — ADMIN/INC\nGET/POST /api/roster/shift-adjustment/confirm — ADMIN/INC\nGET/POST /api/schedule — ADMIN/INC\nGET/POST /api/shift-claims — ADMIN/INC\nGET/POST /api/shift-claims/registration-hold — ADMIN/INC\nGET/POST /api/shift-types — ADMIN/INC\n"
 },
 {
  "id": "api:1",
  "title": "APIと権限",
  "source": "src/app/api",
  "keywords": [
   "API",
   "権限",
   "エンドポイント",
   "認証"
  ],
  "text": "GET/POST /api/task-requirements — ADMIN/INC\nGET/POST /api/users — ADMINのみ\nPATCH /api/employees/reorder — ADMIN/INC\nPATCH /api/shift-claims/[id] — ADMIN/INC\nPATCH /api/users/change-password — ログイン必須\nPATCH/DELETE /api/employees/[id] — ADMIN/INC\nPATCH/DELETE /api/shift-types/[id] — ADMIN/INC\nPATCH/DELETE /api/task-requirements/[id] — ADMIN/INC\nPATCH/DELETE /api/users/[id] — ADMINのみ\nPOST /api/ai-confirm — ADMIN/INC\nPOST /api/roster/ai-assist — ADMIN/INC\nPOST /api/roster/apply-ai-changes — ADMIN/INC\nPOST /api/roster/apply-pattern — ADMIN/INC\nPOST /api/roster/shift-adjustment/send-emails — ADMIN/INC\nPOST /api/schedule/ai-assist — ADMIN/INC\nPOST /api/shift-claims/[id]/cancel — ログイン必須\nPOST /api/shift-claims/ai-confirm — ADMIN/INC\nPOST /api/shift-claims/bulk-confirm — ADMIN/INC\nPOST /api/shortage/confirm — ADMIN/INC\nPOST/GET /api/schedule/auto-assign — ADMIN/INC\n"
 },
 {
  "id": "code:aiAssist.ts",
  "title": "コード: src/lib/aiAssist.ts",
  "source": "src/lib/aiAssist.ts",
  "keywords": [
   "aiAssist"
  ],
  "text": "月間勤務表の「AI追加」と日別スケジュールの「AI追加」で共通のAI呼び出し処理。 モデル・JSON解析・エラーメッセージを1か所に集約し、2つの画面で動作が食い違わないようにする。 AIは「変更案」を返すだけで、DBを直接変更することはない（適用は管理者が画面で押した時のみ）。  改善点（v20）:  - プロジェクト知識（docs・DBスキーマ・API権限・コード地図）から、依頼内容に関連する部分だけを検索してプロンプトに加える（aiKnowledge.ts）。"
 },
 {
  "id": "code:aiConfirm.ts",
  "title": "コード: src/lib/aiConfirm.ts",
  "source": "src/lib/aiConfirm.ts",
  "keywords": [
   "aiConfirm"
  ],
  "text": "「AI依頼」から勤務希望（応募）を確定する処理。  - AIは Function Calling で「対象月・従業員・期間」を決め、サーバーの確定プラン作成関数を呼ぶ。  - 実際の選定と確定は既存の一括確定（bulkConfirm / fairAssignment）をそのまま使う。    → 週20時間（バイト）・同日重複・必要人数・公平な並び・トランザクション・監査ログの各ルールは従来どおり。  - AIの文章だけで「確定した」とは言わせない。結果はDBを読み直して確認した内容だけを返す。  - 2段階: ① preview（何も保存しない）→ ② execute（管理者が「確定する」を押した時だけ。プレビューの署名が一致する場合のみ）。"
 },
 {
  "id": "code:aiKnowledge.ts",
  "title": "コード: src/lib/aiKnowledge.ts",
  "source": "src/lib/aiKnowledge.ts",
  "keywords": [
   "aiKnowledge"
  ],
  "text": "AIへ渡すプロジェクト知識の検索（外部サービス・埋め込みなし。キーワード一致の軽量な検索で、速く・決定的）。 知識の中身は `npm run ai:knowledge` で docs/・コード・DBスキーマから自動生成する（aiKnowledge.generated.ts）。 常にAIへ渡す基本情報（短く固定）。権限・禁止事項など、どの質問でも守るべきこと。 日本語は2文字の組、英数字は単語で分割する 質問に関連する知識を、文字数の上限内で上位から返す システムプロンプトに足す知識ブロック（基本情報＋質問に関連する資料。出典のファイル名つき）"
 },
 {
  "id": "code:aiMemory.ts",
  "title": "コード: src/lib/aiMemory.ts",
  "source": "src/lib/aiMemory.ts",
  "keywords": [
   "aiMemory"
  ],
  "text": "AI依頼の「整理済みメモ」。会話の全文は保存せず、管理者の依頼の要点と結果の要約だけを月ごとに少数保持し、次回の依頼で再利用する。  - 既定の依頼文（空の依頼）や短すぎる依頼は保存しない（重要でないため）。  - 同じ内容は重複して保存しない。月ごとに最新 MAX_NOTES 件だけ残し、古いものは削除する。  - メモの保存・読み出しに失敗しても（テーブル未作成など）AI依頼自体は止めない。 メモは補助機能。保存できなくてもAI依頼の結果には影響させない"
 },
 {
  "id": "code:auditLog.ts",
  "title": "コード: src/lib/auditLog.ts",
  "source": "src/lib/auditLog.ts",
  "keywords": [
   "auditLog"
  ],
  "text": "操作ログ（確定・変更・取消・メール送信）。どのアカウントが、いつ（changedAt は自動）実行したかを残す。"
 },
 {
  "id": "code:auth.ts",
  "title": "コード: src/lib/auth.ts",
  "source": "src/lib/auth.ts",
  "keywords": [
   "auth"
  ],
  "text": "Cấu hình đăng nhập bằng email + mật khẩu, 2 role: ADMIN / INC DB接続エラー等。「パスワード不一致」と区別できるよう、原因をサーバーログに残して別のエラーとして返す 管理者がアカウントを削除した場合、発行済みのセッションも無効にする （エラーを投げるとNextAuthがセッションを破棄し、未ログイン扱いになる）。 DB一時障害時は既存の挙動を維持（ログアウトさせない）"
 },
 {
  "id": "code:autoAssign.ts",
  "title": "コード: src/lib/autoAssign.ts",
  "source": "src/lib/autoAssign.ts",
  "keywords": [
   "autoAssign"
  ],
  "text": "============================================================================ 自動スケジュール作成ロジック v8（休憩ルール全面変更・責任者ロール追加・INC/責任者のOFFICE優先） ============================================================================  v8での変更点（2026-09、業務指示に基づく全面置き換え。旧ルールとの混在はしない）:   - 【休憩】旧ルール（4時間以上勤務で休憩、パートタイムは対象外）を破棄し、"
 },
 {
  "id": "code:autoBackfill.ts",
  "title": "コード: src/lib/autoBackfill.ts",
  "source": "src/lib/autoBackfill.ts",
  "keywords": [
   "autoBackfill"
  ],
  "text": "従業員が特定の日に「出勤しない」状態（公休/有休/調整休）に変更された際に呼び出す。 1) その日のその従業員の割り当てをすべて削除する 2) 削除した中で車A/車B/全（人員が必要な業務）だった枠は、優先順位に従って他の出勤者から    代わりの人を自動的に探して割り当てる（見つからなければ空欄のまま＝既存の不足ハイライトで表示される） その日出勤中の他の従業員（本人を除く） 削除済み（isActive=false）の従業員を代わりの担当者に選ばない（日別スケジュールに表示されない人への配置を防ぐ）"
 },
 {
  "id": "code:bulkConfirm.ts",
  "title": "コード: src/lib/bulkConfirm.ts",
  "source": "src/lib/bulkConfirm.ts",
  "keywords": [
   "bulkConfirm"
  ],
  "text": "確定の対象を絞り込む条件（AI依頼から使う。指定なし＝その月の全員・全日）。 案そのものは必ず「その月の全申請」で作る（枠の定員・公平な並びを崩さないため）。絞り込みは結果の適用範囲だけに効く。 案を絞り込み条件で切り出す（純粋関数）。署名は切り出し後の内容で作り直す。 保留・不採用は氏名しか持たないため、申請IDから従業員を引いて判定する 指定月の「申請中(PENDING)」の勤務希望を集めて、公平な割り当て案を作る（何も保存しない）。 2回目メール経由で登録された PENDING も同じ対象（同じ ShiftClaimRequest）。"
 },
 {
  "id": "code:claimAdmin.ts",
  "title": "コード: src/lib/claimAdmin.ts",
  "source": "src/lib/claimAdmin.ts",
  "keywords": [
   "claimAdmin"
  ],
  "text": "INC用: 指定月の勤務希望すべて（全ステータス）＋募集枠（人員不足）の状況。 各応募者に「当月の確定済み実労働時間（休憩控除後）」「優先順位」「募集枠の条件を満たすか」を付ける（選定理由が分かるように）。 勤務希望人数（申請中）は選択したシフト基準で集計し、勤務確定人数（current）とは別に表示する 確定前に従業員が即時キャンセルした勤務希望は、INC側の一覧・応募状況・集計には出さない（DBには履歴として残る）"
 },
 {
  "id": "code:claimHold.ts",
  "title": "コード: src/lib/claimHold.ts",
  "source": "src/lib/claimHold.ts",
  "keywords": [
   "claimHold"
  ],
  "text": "対象月ごとの勤務希望の「登録停止／再開」。行がない月は受付中。月は勤務日の属する月（\"YYYY-MM\"）。 日付・月の判定はJST基準（勤務日は日付文字列のまま扱い、UTC/JSTのずれを持ち込まない）。"
 },
 {
  "id": "code:claimRules.ts",
  "title": "コード: src/lib/claimRules.ts",
  "source": "src/lib/claimRules.ts",
  "keywords": [
   "claimRules"
  ],
  "text": "勤務希望（応募）の時間が募集枠（シフト）の条件を満たすかの判定。純粋関数（DBに触れない）。  - 希望時間が未指定 → シフト全体を勤務できるものとして扱う  - シフトに「受け付け条件」がある（8:00〜17:00 / 13:00〜22:00）→ その条件の時間帯を含んでいればOK    （例: 13:00〜22:00 の枠は 16:00〜22:00 を勤務できれば条件を満たす）  - 上記以外のシフト → シフト全体を含んでいる必要がある 希望時間を、枠（日跨ぎ含む）と同じ分単位の軸に直す"
 },
 {
  "id": "code:claimStatus.ts",
  "title": "コード: src/lib/claimStatus.ts",
  "source": "src/lib/claimStatus.ts",
  "keywords": [
   "claimStatus"
  ],
  "text": "勤務希望（ShiftClaimRequest）の状態に関する純粋関数（DBに触れない）。 INCの確定前に、従業員が自分で即時キャンセルした勤務希望か。  - 確定前の取消は status=CANCELED のまま cancelRequestedAt が空（INCの承認を経ていない）  - 確定後の取消は「取消申請（cancelRequestedAt が入る）→ INCが承認」で CANCELED になる＝INCの処理履歴なので別扱い 即時キャンセル分は、INC側の一覧・応募状況・集計・ASK②の依頼済み表示には出さない（データは削除せず、履歴・操作ログに残す）。 「勤務希望人数」に数える状態: 本人が登録済みでINCの確定待ち（PENDING）だけ。"
 },
 {
  "id": "code:dailyRoster.ts",
  "title": "コード: src/lib/dailyRoster.ts",
  "source": "src/lib/dailyRoster.ts",
  "keywords": [
   "dailyRoster"
  ],
  "text": "1日分のスタッフ一覧を構築する（UI表示とExcel/PDF出力の両方から共通で使う）  ルール: - 表示順は role/yakuwari（従業員の役割）では決めない。role と表示順は分離する。   ① 勤務開始時刻（営業日インデックス）が早い順   ② 開始時刻が同じ場合は、勤務終了時刻が早い順"
 },
 {
  "id": "code:dailyStaffing.ts",
  "title": "コード: src/lib/dailyStaffing.ts",
  "source": "src/lib/dailyStaffing.ts",
  "keywords": [
   "dailyStaffing"
  ],
  "text": "その日に必要な合計人数（業務要件 TaskRequirement の requiredCount を合算）と、 実際に出勤予定の人数（MonthRoster status=WORK の人数）を比較し、不足人数を算出する。 例: Aカート4名 + Bカート4名 + 全カート4名 → 1日の必要人数12名。 業務要件が未設定の場合は、A/B/全それぞれ4名を暫定デフォルトとして扱う。 業務要件が未設定の場合の暫定デフォルト（A/B/全 各4名 = 合計12名）"
 },
 {
  "id": "code:dutySchedule.ts",
  "title": "コード: src/lib/dutySchedule.ts",
  "source": "src/lib/dutySchedule.ts",
  "keywords": [
   "dutySchedule"
  ],
  "text": "============================================================================ 業務A/B/全・WHILL関連業務の「稼働時間・必要人数」定義（単一の情報源） ============================================================================  このファイルは Prisma（DBアクセス）に依存しない純粋な定数・関数のみを含む。 そのため src/lib/autoAssign.ts（サーバー）だけでなく、"
 },
 {
  "id": "code:excelStyle.ts",
  "title": "コード: src/lib/excelStyle.ts",
  "source": "src/lib/excelStyle.ts",
  "keywords": [
   "excelStyle"
  ],
  "text": "Excel出力の共通スタイル。Web画面のデザイントークン（globals.css）に合わせる。 土=青、日=赤（Web画面の曜日色と同じ） A4横・1ページ幅に収める・見出し行/列を各ページに繰り返す"
 },
 {
  "id": "code:fairAssignment.ts",
  "title": "コード: src/lib/fairAssignment.ts",
  "source": "src/lib/fairAssignment.ts",
  "keywords": [
   "fairAssignment"
  ],
  "text": "勤務者の一括確定: 公平な割り当て（純粋関数。DBには触れない）  処理順: 日付の昇順 → 同日はシフト開始時刻の昇順 → shiftTypeId。 各枠では、条件を満たす応募者を次の順で並べ、必要人数（不足人数）まで採用する。   ① 当月の合計実労働時間（休憩控除後・確定済み＋この処理で既に割り当てた分）が少ない人   ② 従業員管理の「優先順位」（数値が小さいほど優先）"
 },
 {
  "id": "code:jst.ts",
  "title": "コード: src/lib/jst.ts",
  "source": "src/lib/jst.ts",
  "keywords": [
   "jst"
  ],
  "text": "日付・期限・月の判定はすべてJST（日本時間）で行う。"
 },
 {
  "id": "code:mailTemplates.ts",
  "title": "コード: src/lib/mailTemplates.ts",
  "source": "src/lib/mailTemplates.ts",
  "keywords": [
   "mailTemplates"
  ],
  "text": "「勤務シフト確定」メールの文面。ASK②のプレビューと実際の送信で同じ関数を使い、表示と送信内容がずれないようにする。 純粋関数（DB・環境変数に依存しない）。"
 },
 {
  "id": "code:mailer.ts",
  "title": "コード: src/lib/mailer.ts",
  "source": "src/lib/mailer.ts",
  "keywords": [
   "mailer"
  ],
  "text": "月次シフト調整で、対象従業員に「対応可能なシフト一覧」を通知するメール。 各従業員には、その人が実際に対応可能なシフトだけを記載する（全員に同じ内容を送らない）。 勤務シフト確定メール（ASK②の「メール配信」）。送信モード（MAIL_MODE）に従う: 開発・テストでは dry-run（ログ出力のみ・実送信しない）。戻り値の ok=true は「送信（またはdry-run）成功」。 ============================================================ 勤務希望登録フロー用メール（2026-10追加）"
 },
 {
  "id": "code:monthStatus.ts",
  "title": "コード: src/lib/monthStatus.ts",
  "source": "src/lib/monthStatus.ts",
  "keywords": [
   "monthStatus"
  ],
  "text": "月ごとの勤務スケジュールの「調整中／確定」の管理（DB: MonthRosterConfirmation.status）。    調整中 … 行がない、または status = ADJUSTING。従業員にはシフト内容を一切返さない。   確定   … status = CONFIRMED。「メール配信」が正常に完了した月だけ。  状態が変わるのは次の3か所だけ（メール送信ログからの推測はしない）。"
 },
 {
  "id": "code:monthStatusShared.ts",
  "title": "コード: src/lib/monthStatusShared.ts",
  "source": "src/lib/monthStatusShared.ts",
  "keywords": [
   "monthStatusShared"
  ],
  "text": "月ごとの勤務スケジュール状態（調整中／確定）の、サーバー・画面で共通に使う型と純粋関数。 DBには依存しない（クライアントからも import できる）。DBを触る処理は monthStatus.ts。 直近の「メール配信」の記録（管理者・INCにだけ返す） 確定後にシフトが修正され、再度「メール配信」が必要な状態 以下は管理者・INCにだけ返す 日付（DBのdate列はUTC 0時で保持される）→ \"YYYY-MM\""
 },
 {
  "id": "code:monthlyShiftGap.ts",
  "title": "コード: src/lib/monthlyShiftGap.ts",
  "source": "src/lib/monthlyShiftGap.ts",
  "keywords": [
   "monthlyShiftGap"
  ],
  "text": "月次シフト調整で対象とするシフトと必要人数は、INCが /shift-settings（ShiftType.requiredCount と ShiftTimeBand）で設定した値を使う（コード固定はしない）。基本必要人数が1以上、または時間帯別に 1人以上の設定があるシフトが集計対象。計算の中身は src/lib/shiftRequirements.ts。 既に依頼・申請済み（招待メール送信済みで未回答のものを含む）の従業員と、その回答状況 指定した月について、必要人数が設定されている全シフト×全日をチェックし、不足しているシフトの一覧を返す。 「22:00〜08:00」のような日跨ぎシフトは開始日1日分のシフトとして扱う（既存のMonthRosterの記録方法と"
 },
 {
  "id": "code:nightCrewPlan.ts",
  "title": "コード: src/lib/nightCrewPlan.ts",
  "source": "src/lib/nightCrewPlan.ts",
  "keywords": [
   "nightCrewPlan"
  ],
  "text": "============================================================================ 22時勤務（夜勤）のBreak開始時間・バッテリー交換の割当て計画 ============================================================================ 22時勤務の3人/4人だけを対象に、次を「人員の組み合わせ全探索」で決める純粋関数。   - Break（120分のまま）の開始時間: 1:00 / 2:00 / 3:00 のどれか。同時Breakは最大2人。   - バッテリー交換 1回目: 1:00 または 2:00 の範囲内で自動選択（範囲外にはしない）"
 },
 {
  "id": "code:pdfFont.ts",
  "title": "コード: src/lib/pdfFont.ts",
  "source": "src/lib/pdfFont.ts",
  "keywords": [
   "pdfFont"
  ],
  "text": "PDF出力用の日本語フォントを探す。pdfkit標準のHelveticaは日本語を描画できないため、 日本語（業務名・氏名）が空白や文字化けになってしまう。 探す順番: ①環境変数 PDF_FONT_PATH ②プロジェクト同梱の fonts/ipag.ttf（IPAゴシック）           ③サーバーにインストールされている代表的な日本語フォント"
 },
 {
  "id": "code:positionColors.ts",
  "title": "コード: src/lib/positionColors.ts",
  "source": "src/lib/positionColors.ts",
  "keywords": [
   "positionColors"
  ],
  "text": "業務（CartPosition）の既定の表示色。Web画面・Excel・PDFで同じ色を使う（業務管理で色を設定していれば、そちらが優先）。"
 },
 {
  "id": "code:prisma.ts",
  "title": "コード: src/lib/prisma.ts",
  "source": "src/lib/prisma.ts",
  "keywords": [
   "prisma"
  ],
  "text": "Tránh tạo nhiều PrismaClient khi Next.js hot-reload lúc dev"
 },
 {
  "id": "code:roles.ts",
  "title": "コード: src/lib/roles.ts",
  "source": "src/lib/roles.ts",
  "keywords": [
   "roles"
  ],
  "text": "権限判定の共通関数。 ADMIN（システム管理者）と INC（シフト管理者）は、勤務表・勤務希望・人員不足確定などの 運用操作を同じ権限で行える。アカウント管理（/api/users 系）だけは ADMIN 専用のまま。"
 },
 {
  "id": "code:rosterAccess.ts",
  "title": "コード: src/lib/rosterAccess.ts",
  "source": "src/lib/rosterAccess.ts",
  "keywords": [
   "rosterAccess"
  ],
  "text": "月間勤務表（MonthRoster）の閲覧範囲を決める（UIだけでなくAPI・クエリ側で保証するための共通関数）。  - 管理者・INC: 常に全員分（調整中の月も含む）  - 一般従業員: 月の状態が「確定」（メール配信が正常に完了した月）のときだけ、全員分のシフト情報を閲覧できる。               「調整中」の月はシフトデータを一切返さない（自分の分も含めて返さない）。  他人の勤務希望（ShiftClaimRequest）はここでは扱わない（常に非公開）。 従業員向けにシフトデータを返してよいか（= 一般従業員がその月を閲覧できるか）を判定する簡易ヘルパー。"
 },
 {
  "id": "code:scheduleDemand.ts",
  "title": "コード: src/lib/scheduleDemand.ts",
  "source": "src/lib/scheduleDemand.ts",
  "keywords": [
   "scheduleDemand"
  ],
  "text": "業務A/B/全の「時間帯あたり必要人数」を業務管理の設定（有効な業務要件のみ）から求める。 自動割当てAPI（/api/schedule/auto-assign）と同じ算出方法。全役割対象の要件を優先し、未設定なら1名。"
 },
 {
  "id": "code:scheduleGrid.ts",
  "title": "コード: src/lib/scheduleGrid.ts",
  "source": "src/lib/scheduleGrid.ts",
  "keywords": [
   "scheduleGrid"
  ],
  "text": "日別スケジュールの「表示グリッド」（30分刻み・60分業務は2コマ結合）を組み立てる共通ロジック。 Web画面(src/app/schedule/[date]/page.tsx)・Excel出力・PDF出力が必ず同じ関数を使うことで、 画面と出力の内容（誰がどの業務を何時に担当しているか）がズレないようにする。 DBの構造・自動割当てのロジック（1時間=1インデックス）には一切影響しない。 指定した従業員の割り当ての中から、このスロット開始時刻を含む（＝カバーしている）ものを探す。 カバーしている割り当ての長さ（分）"
 },
 {
  "id": "code:shiftHeadcount.ts",
  "title": "コード: src/lib/shiftHeadcount.ts",
  "source": "src/lib/shiftHeadcount.ts",
  "keywords": [
   "shiftHeadcount"
  ],
  "text": "============================================================================ シフト人数の集計ルール（純粋関数。DBに触れないので単体テストできる）   - 人数は「登録時に選択したシフト」を基準に数える。勤務時間がシフト全体と一致しなくても、そのシフトの1人。    例: 13:00〜22:00 のシフトを選び 16:00〜22:00 で登録 → 13:00〜22:00 のシフトに1人。  - 時間帯（開始・終了）からシフトを逆算しない。シフトが未選択（shiftTypeId なし）のものは、ここでは数えない。"
 },
 {
  "id": "code:shiftRequirements.ts",
  "title": "コード: src/lib/shiftRequirements.ts",
  "source": "src/lib/shiftRequirements.ts",
  "keywords": [
   "shiftRequirements"
  ],
  "text": "============================================================================ シフトの必要人数（INCが /shift-settings で設定）の共通ロジック    基本必要人数 : ShiftType.requiredCount   時間帯別人数 : ShiftTimeBand（設定がある時間帯は基本必要人数より優先。無い時間帯は基本人数） "
 },
 {
  "id": "code:shortageMail.ts",
  "title": "コード: src/lib/shortageMail.ts",
  "source": "src/lib/shortageMail.ts",
  "keywords": [
   "shortageMail"
  ],
  "text": "\"2026-11\" → { year: 2026, mon: 11 } 勤務希望の登録締切 = 対象月の前月10日（例: 2026-11 → 2026-10-10）。締切後も登録は可能（禁止しない）。 \"2026-11-03\" → \"11月3日(月)\" 保存済みスナップショット → 1回目メールの「人員不足の日程」行 1回目メールの送信対象: 役割が「バイト」(PARTTIME) の在籍中の従業員のみ。 正社員・契約社員など、バイト以外には送らない。メール未登録者は skipped として返す（送信はしない）。"
 },
 {
  "id": "code:shortageNotice.ts",
  "title": "コード: src/lib/shortageNotice.ts",
  "source": "src/lib/shortageNotice.ts",
  "keywords": [
   "shortageNotice"
  ],
  "text": "アルバイトのシフト登録で人員不足が発生した場合に表示・保存する注意事項。 不足しているシフトの勤務時間（開始時刻）に応じて内容を切り替える。   8:00〜17:00 のシフトが不足  → 8:00から勤務できる方のみ受け付け   13:00〜22:00 のシフトが不足 → 16:00から勤務できる方のみ受け付け シフト名（早番・遅番など）には依存せず、勤務時間だけで判定する（既存の勤務時間データは変更しない）。 勤務時間の開始・終了から注意事項（2行: 本文＋例）を返す。該当しないシフトは空配列。"
 },
 {
  "id": "code:systemPositionCodes.ts",
  "title": "コード: src/lib/systemPositionCodes.ts",
  "source": "src/lib/systemPositionCodes.ts",
  "keywords": [
   "systemPositionCodes"
  ],
  "text": "Prismaに依存しない純粋な定義（クライアントコンポーネントからも利用できる） システム（自動割当て・不足判定・画面）が code 文字列を直接参照している業務コード。 業務管理画面ではこれらの code の変更を禁止する（名称・色・説明・稼働状態は変更可能）。"
 },
 {
  "id": "code:systemPositions.ts",
  "title": "コード: src/lib/systemPositions.ts",
  "source": "src/lib/systemPositions.ts",
  "keywords": [
   "systemPositions"
  ],
  "text": "「バッテリー交換」を業務マスタに用意する（無ければ作成。既にあれば何も変更しない）。 prisma/seed.ts は既存DBでは再実行されないことがあるため、業務一覧の取得時と 自動割当て時に呼び出して、既存DBにも確実に反映する。 同時実行で他方が先に作成した場合(P2002)は問題なし"
 },
 {
  "id": "code:timeSlots.ts",
  "title": "コード: src/lib/timeSlots.ts",
  "source": "src/lib/timeSlots.ts",
  "keywords": [
   "timeSlots"
  ],
  "text": "Trục thời gian vận hành: 04:00 hôm nay -> 03:00-04:00 hôm sau, mỗi slot 1 TIẾNG (24 slot/ngày) Đổi từ 30 phút -> 1 tiếng theo yêu cầu thực tế sử dụng 実時刻(0-23時)を「営業日インデックス」(0=4:00, ..., 23=3:00-4:00)に変換 \"08:00\" 等の文字列から時（0-23）を取り出す 表示用（日別スケジュール画面）の30分刻みスロット。48スロット/日。 ⚠️ buildOperatingDaySlots() / operatingIndex() は自動割当てロジック（dutySchedule.ts,"
 },
 {
  "id": "code:useKeepInViewport.ts",
  "title": "コード: src/lib/useKeepInViewport.ts",
  "source": "src/lib/useKeepInViewport.ts",
  "keywords": [
   "useKeepInViewport"
  ],
  "text": "いったん元の位置に戻してから測り直す"
 },
 {
  "id": "code:useRefetchOnFocus.ts",
  "title": "コード: src/lib/useRefetchOnFocus.ts",
  "source": "src/lib/useRefetchOnFocus.ts",
  "keywords": [
   "useRefetchOnFocus"
  ],
  "text": "タブに戻ってきた時（別タブ・別画面で従業員/業務を追加・削除・変更した直後など）に、 画面のデータを自動で再取得する。編集中の入力内容には触れない（load関数のみ呼ぶ）。"
 },
 {
  "id": "code:userEmployeeLink.ts",
  "title": "コード: src/lib/userEmployeeLink.ts",
  "source": "src/lib/userEmployeeLink.ts",
  "keywords": [
   "userEmployeeLink"
  ],
  "text": "アカウントに紐付けようとしている従業員が有効かを確認する（問題なければ null を返す）。 - 存在しない／削除済み（isActive=false）の従業員は紐付けできない - すでに別のアカウントに紐付いている従業員は紐付けできない（User.employeeId は一意） 氏名の「正のデータ」は Employee.fullName。従業員に紐付いているログインアカウントの表示名（User.name）は、 常にこの値に合わせる（紐付け時・従業員の氏名変更時に呼ぶ）。紐付けのないアカウントは User.name が正のまま。"
 },
 {
  "id": "code:weeklyHours.ts",
  "title": "コード: src/lib/weeklyHours.ts",
  "source": "src/lib/weeklyHours.ts",
  "keywords": [
   "weeklyHours"
  ],
  "text": "週の範囲（日曜〜土曜）を計算する。dateが週の途中でもその週全体を返す。 指定した日を含む週（日〜土）に、その従業員が既に登録されている合計勤務時間を計算する。 アルバイト（PARTTIME）の週20時間上限チェックに使用。 アルバイトが、指定日に追加でshiftHours時間の勤務を新たに割り当てても週20時間を超えないか確認する。 アルバイト以外は常にtrue（上限なし）。"
 },
 {
  "id": "code:workTime.ts",
  "title": "コード: src/lib/workTime.ts",
  "source": "src/lib/workTime.ts",
  "keywords": [
   "workTime"
  ],
  "text": "勤務時間の解決ロジック（優先順位）: 1) その日の例外時間（overrideStartTime/overrideEndTime）があれば最優先 2) なければ、その日に選択されているShiftTypeの時間 3) それもなければ、従業員の基本勤務時間（baseStartTime/baseEndTime） いずれも無ければ null（時間未設定＝表示は空欄） 表示用フォーマット: \"08:00\"〜\"17:00\" -> \"8-17\"（勤務表の慣習表記に合わせる）"
 },
 {
  "id": "code:workedHours.ts",
  "title": "コード: src/lib/workedHours.ts",
  "source": "src/lib/workedHours.ts",
  "keywords": [
   "workedHours"
  ],
  "text": "月間の「確定済み実労働時間」（休憩を差し引いた時間）の計算。  休憩の求め方（優先順）:  1) その従業員・その勤務日に日別スケジュールの割り当て(DailyAssignment)が1件でもあれば、     業務コード BREAK の割り当ての合計時間を休憩とする（実際に配置された休憩）。日跨ぎ勤務は翌日の明け側も含める。  2) 日別スケジュール未作成なら、自動割当てと同じルールで見積もる:"
 }
];
