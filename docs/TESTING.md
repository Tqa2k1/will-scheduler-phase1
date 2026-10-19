# TESTING.md — テスト方法

- `npm test` = `tests/logic.test.ts`（純粋ロジック: 人数集計・キャンセル種別・公平割当など）→ `tests/integration.test.ts`（月の状態・権限・配信・Excel）→ `tests/claims.test.ts`（キャンセル・登録停止/再開・希望人数）→ `tests/ui-structure.test.ts`（ホームのメニュー構成・旧URLリダイレクト・氏名同期・アカウント/従業員APIの権限）→ `tests/ai-confirm.test.ts`（AI依頼による勤務希望の確定: 関数呼び出し→プレビュー→確定、DB状態、週20時間、絞り込み、権限、失敗時の表示）→ `tests/ai.test.ts`（AI知識の検索・メモ・APIキーのマスク・OpenAIモック・AI APIの権限）。`npm test` の先頭で知識ファイルの鮮度も確認。
- インメモリDB（`tests/helpers/fakePrisma.ts`）とメールのスタブ化（`tests/helpers/setup.ts`）で、DB・実メール不要。
- 型: `npx tsc --noEmit` / lint: `npm run lint`。
- 未カバー（手動確認が必要）: 実PostgreSQLでの `prisma db push`、実際のGmail送信、ブラウザ上の見た目、PDF/Excelをアプリで開いた見た目。
- PDF: `next.config.js` の `serverComponentsExternalPackages`（pdfkit, fontkit）が必須。外すとビルド後 `Helvetica.afm` が見つからず500になる。
