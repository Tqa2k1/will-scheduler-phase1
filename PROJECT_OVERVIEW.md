# PROJECT_OVERVIEW.md — Assign（whill-scheduler-lv2）

パシフィック・クルーのシフト管理システム。月間勤務表・日別アサイン表・人員不足の確定とメール（ASK①/②）・勤務希望の登録と確定を扱う。

## 技術スタック
Next.js 14.2.5（App Router）/ React 18 / TypeScript / Prisma 5.22 + PostgreSQL / NextAuth（JWT, ロール ADMIN・INC・EMPLOYEE）/ zod / nodemailer（Gmail）/ exceljs（Excel）/ pdfkit + IPAフォント（PDF）/ eslint / tsx テスト。

## ディレクトリ
- `src/app/` 画面とAPI（`src/app/api/**/route.ts`）
- `src/lib/` 業務ロジック（人数集計 `shiftHeadcount.ts`、不足判定 `monthlyShiftGap.ts`、勤務希望 `claim*.ts`、月の状態 `monthStatus*.ts`、Excelスタイル `excelStyle.ts`）
- `src/components/` 共通UI（`ui/`、`ask/AskSteps.tsx`、`AiAssistModal.tsx`）
- `prisma/schema.prisma`、`prisma/sql/`（手動適用用SQL）
- `tests/` 単体・統合テスト（インメモリDB）
- `docs/` 詳細ドキュメント

## 主な機能
| 機能 | 画面 | 備考 |
|---|---|---|
| 月間勤務表 | `/roster` | INC/ADMINは編集。ボタン: ASK①・ASK②・アサイン作成・Excel出力・AI依頼・パターン設定、メール配信は右下。従業員は「確定」月のみ全員分を閲覧（自分の行が先頭） |
| 日別アサイン表 | `/schedule/[date]` | 自動アサイン、Excel/PDF出力 |
| ASK① 人員不足の確定 | `/shortage` | 不足を確定し1回目メール |
| 勤務希望登録 | `/shift-requests/register` | 従業員。停止中は登録・変更不可 |
| 応募者の確認・勤務者の確定（ホーム「勤務希望確認」から） | `/shift-requests` | INC/ADMIN。月・日付・シフト・従業員・状態で絞り込み。月別の登録停止/再開、AI依頼、一括確定 |
| ASK② シフト調整・配信 | `/roster/shift-adjustment` | 調整、確定メール配信 |
| AI依頼 | ASK②画面・応募者の確認画面 | `/api/roster/ai-assist`。提案は確認後に適用 |
| スケジュール設定 | `/tasks`（タブ: スケジュール／勤務時間設定） | 旧「業務管理」＋旧「人数設定」。旧 `/shift-settings` はリダイレクト |
| アカウント設定 | `/users` | 旧「従業員管理」＋旧「アカウント管理」。氏名の正は `Employee.fullName`。旧 `/employees` はリダイレクト |
| パスワード変更 | `/account/password` | 全ロール共通 |
| エクスポート | 各画面 | `/api/export/roster-excel`, `schedule-excel`, `schedule-pdf` |

## 起動
`.env.example` を `.env` にコピーし値を設定 → `npm install` → `npx prisma generate && npx prisma db push` → `npm run dev`。テストは `npm test`。
