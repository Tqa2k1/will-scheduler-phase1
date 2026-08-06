# AI_CONTEXT.md — WHILL Scheduler

> **これは、この後このプロジェクトを触るAI（ChatGPT/Claude/Gemini/Kimi/Qwenなど）が
> ソースコード全体を読まなくても短時間で状況を把握できるようにするための入り口ファイル。**
> より詳しい内容は同じ`docs/`フォルダの各ファイルに分割してある。まずこのファイルを読み、
> 必要に応じて該当ドキュメントに進むこと。

## プロジェクトの目的

`whill-scheduler` は、パシフィック・クルー株式会社の**シフト管理・自動作成システム**。
これまでExcelで手作業していた「月間の出勤/公休ローテーション」と「日別の業務配置
（誰がAカート/Bカート/全カート/WHILL関連業務/休憩/事務時間のどれを何時に担当するか）」を、
Webアプリ + 自動アサインエンジンに置き換えることが目的。

## このプロジェクトが解決している課題

1. 月間の勤務パターン（4勤2休など）を手入力せず、ローテーションパターンから自動生成する。
2. 1日の業務配置（誰がいつ何を担当するか）を、決まった優先順位・業務ルールに従って
   **自動アサインエンジン**（`src/lib/autoAssign.ts`）で自動計算する。
3. 急な欠勤が出た際に、他のスタッフで自動的に穴埋め（バックフィル）する
   （`src/lib/autoBackfill.ts`）。
4. Excel/PDFでの出力（既存の帳票フォーマットに近い形）に対応する。

## 技術スタック

- Frontend: Next.js 14.2.5 (App Router) + React 18.3.1 + TypeScript 5.5.4
- Backend: Next.js Route Handlers（同一アプリ内）
- Database: PostgreSQL + Prisma 5.20.0
- 認証: NextAuth 4.24.7（Credentials Provider、JWTセッション）+ bcrypt
- その他: zod（バリデーション）、exceljs / pdfkit（出力）、nodemailer（通知メール）、
  groq-sdk（AIによる月間ローテーション提案機能）
- デプロイ: Vercel + Neon/Supabase（PostgreSQL）

## 全体アーキテクチャ（詳細は ARCHITECTURE.md）

```
ブラウザ(React) → Next.js App Router
  ├─ src/app/<page>/page.tsx   … 画面
  └─ src/app/api/**/route.ts  … API
       └─ src/lib/*.ts        … ビジネスロジック
            └─ Prisma → PostgreSQL
```

## ディレクトリ構成（詳細は PROJECT_STRUCTURE.md）

```
prisma/          … schema.prisma（DB）, seed.ts（初期データ）
src/app/         … ページ + APIルート
src/lib/         … ビジネスロジック（自動アサインの中心はここ）
src/components/  … 共通UI（現状ほぼ空）
docs/            … このドキュメント一式
```

## 最も重要なファイル

| ファイル | 理由 |
|---|---|
| `src/lib/autoAssign.ts` | 自動アサインエンジンの本体。業務ロジックの中核。改修依頼が最も多い箇所。 |
| `prisma/schema.prisma` | DBの唯一の正。ここを見ずにモデルを推測しない。 |
| `prisma/seed.ts` | `CartPosition`（業務コード一覧）など、実際にDBへ入る「マスタデータ」の正。 |
| `src/lib/dailyRoster.ts` / `src/lib/timeSlots.ts` / `src/lib/workTime.ts` | 「時間」の扱い方の基盤。ここを理解せずに時間まわりを触ると夜勤・WHILL時刻がズレる。 |
| `src/app/api/schedule/auto-assign/route.ts` | 自動アサインを呼び出すAPI。入出力の契約はここ。 |

## 迂闊に変更してはいけないもの

- `prisma/schema.prisma` の既存フィールド・enum値のリネームや削除（本番データが壊れる）。
- `CartPosition.code`、`EmployeeRole`、`RosterStatus`などの**文字列値そのもの**
  （UIやロジックにハードコードされて参照されている）。
- `buildAutoAssignPlan()` / `computeShortageCount()` / `PRODUCTIVE_CODES` のシグネチャ
  （`autoBackfill.ts`など他ファイルから直接importされている）。
- `POST /api/schedule/auto-assign` の入出力形式（`{date}` → `{success, shortageCount, assignedCount}`）。

## コード変更時の必須ルール

1. 既存の関数を確認なしに削除しない。
2. DBを変更する前に必ず `prisma/schema.prisma` を確認する（`CartPosition.code`のように、
   schemaを変えずに**データ追加だけ**で対応できるケースが多いので、まず確認する）。
3. 変更後はTypeScriptの型エラーがないか確認する
   （`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`）。
4. データを返すAPIを変更・追加する際は、権限チェック（`getServerSession` + role確認）が
   入っているか確認する（`/api/ai-confirm`, `/api/roster/apply-ai-changes` は現状抜けている。
   API.md参照）。
5. 変更内容を説明してからコードを書く（本ドキュメント一式もその一部）。
6. 新しいタスクや既知の課題を見つけたら `docs/TODO.md` を更新する。
7. 変更が完了したら `docs/CHANGELOG.md` に追記する。

## 続けて開発する際の注意点

- **自動アサインの優先順位ルール**（業務A→業務B→業務全→WHILL→休憩→事務時間）は
  2026-08に確定した最新仕様であり、`docs/AUTO_ASSIGN_RULES.md` に詳細を分離してある。
  自動アサインを触る前に必ずそちらを読むこと。
- 「時間」は常に **4:00始まり24スロット（`operatingIndex`）** で扱う。0時始まりの通常の
  24時間として実装するとバグる。
- パートスタッフ（`EmployeeRole.PARTTIME`）は業務A/B/全のみ担当可能で、週20時間の
  勤務時間上限がある（`weeklyHours.ts`）。WHILL業務・事務時間は禁止。
- `EmployeeRole`（従業員としての役割）と `UserRole`（ログインアカウントの権限）は別のenum。
  どちらも`INC`という値を持つが別物なので混同しないこと。

## 現在の開発タスク（詳細は TODO.md）

- セキュリティ: `/api/ai-confirm` と `/api/roster/apply-ai-changes` に認証・権限チェックがない。
- INC権限（管理職ロール）の実装が未確定。
- EMPLOYEEロールが本当に自分のデータしか見られないかの全API横断チェックが未実施。

## 変更履歴

このドキュメント含む`docs/`一式の更新履歴は `docs/CHANGELOG.md` を参照。
