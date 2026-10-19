# AGENTS.md — AI（Claude / ChatGPT / Gemini など）が作業するときのルール

## 最重要ルール
**修正の前に、必ず関連ドキュメントとコードを先に確認し、影響範囲を把握してから、必要最小限の変更を行うこと。**

1. `PROJECT_OVERVIEW.md` と `docs/` の該当ファイル（下の対応表）を読む。
2. 変更対象の画面・API・`src/lib` のロジック・DB（`prisma/schema.prisma`）・権限・テストを grep して、影響範囲を洗い出す。
3. 仕様が不明な点は推測で実装せず、採用した仮定を明記して報告する。
4. 要件に関係のない箇所は変更しない。環境変数・DB設定・APIキーは必要な確認なしに変更しない。
5. 変更したらドキュメント（`docs/`、`docs/CHANGELOG.md`）を実コードに合わせて更新する。
6. 完了前に `npx tsc --noEmit`、`npm run lint`、`npm test` を実行する。実行できなかった項目は「未実施」と明記する（実施したことにしない）。

## どの資料を読むか
| 変更内容 | 読む資料 |
|---|---|
| 勤務希望・キャンセル・登録停止・確定 | `docs/WORKFLOWS.md`、`docs/BUSINESS_RULES.md` |
| 人数集計・不足判定 | `docs/HEADCOUNT_RULES.md`（`src/lib/shiftHeadcount.ts`, `monthlyShiftGap.ts`） |
| 権限・ロール | `docs/PERMISSIONS.md` |
| DB | `docs/DATABASE.md`（変更時はマイグレーションSQLも `prisma/sql/` に追加） |
| API | `docs/API.md` |
| データの流れ | `docs/DATA_FLOW.md` |
| テスト | `docs/TESTING.md` |
| 画面の名称・メニュー構成 | `docs/CHANGELOG.md` の「名称変更の対応表」 |

## 守るべき業務フロー（変更禁止の骨格）
ASK①（`/shortage`: 人員不足を確定→1回目メール）→ 従業員が勤務希望を登録（`/shift-requests/register`）→ INC「応募者の確認・勤務者の確定」（`/shift-requests`）→ ASK②（`/roster/shift-adjustment`: 調整→確定メール配信）。UIの改善はよいが、この順序と各処理の内容は変えない。

## 画面名の注意（v19）
画面上の名称と内部名が異なる: 人数設定→勤務時間設定、業務管理→スケジュール設定、アカウント管理＋従業員管理→アカウント設定、月次自動割当て→アサイン作成、パターン適用→パターン設定。コード名・APIパス・DB名は旧名のまま。氏名の正のデータは `Employee.fullName`（`User.name` はサーバーで同期）。

## AIの知識（v20）
docs/・`prisma/schema.prisma`・API・`src/lib` の先頭コメントを変えたら `npm run ai:knowledge` で `src/lib/aiKnowledge.generated.ts` を再生成する（手で編集しない。`npm test` が古さを検出する）。AIには管理者のみ。APIキー・秘密情報は docs に書かない。

## 実装上の注意
- 権限チェックは画面だけでなく必ずAPI側でも行う（`isManagerRole`＝ADMIN/INC）。
- 従業員向けAPIは他人の情報・個人情報（メール・電話・メモ）を返さない。
- メールは `MAIL_MODE`（live/dry-run/test）と `MAIL_ALLOWLIST` に従う。テストで実送信しない。
- 勤務希望は物理削除しない（論理削除=ステータス）。月の判定はJST（`src/lib/jst.ts`）。
- ZIP化・共有時は `node_modules`、`.next`、`.git`、`.env*`（`.env.example` は可）、ログを含めない。
