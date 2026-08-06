# PROJECT_STRUCTURE.md — WHILL Scheduler

> このファイルはプロジェクトのディレクトリ構成と各フォルダの役割を説明する。
> 実際に `find` で確認した内容のみを記載している（推測での記載なし）。

```
whill-scheduler/
├── prisma/
│   ├── schema.prisma        # DBスキーマ定義（唯一の正）。詳細は DATABASE.md
│   └── seed.ts               # 初期データ投入スクリプト（管理者アカウント・ShiftType・
│                              #   CartPosition・RolePriority・RotationPatternなど）
├── src/
│   ├── app/                  # Next.js App Router（ページ + APIルート）
│   │   ├── api/               # バックエンドAPI（詳細は API.md）
│   │   ├── dashboard/          page.tsx  — ダッシュボード
│   │   ├── employees/          page.tsx  — 従業員管理
│   │   ├── users/               page.tsx  — アカウント管理
│   │   ├── roster/              page.tsx  — 月間勤務表（Master Roster）
│   │   ├── schedule/[date]/     page.tsx  — 日別スケジュール（Daily Assignment）
│   │   ├── shift-requests/      page.tsx  — 勤務希望申請（ShiftClaimRequest）
│   │   ├── tasks/               page.tsx  — 業務（CartPosition）・業務要件管理
│   │   ├── login/               page.tsx  — ログイン画面
│   │   ├── layout.tsx, page.tsx, providers.tsx, globals.css
│   ├── components/            # 共通UIコンポーネント（現状ほぼ未使用/空）
│   ├── lib/                   # サーバーサイドの共通ロジック（詳細は ARCHITECTURE.md）
│   │   ├── autoAssign.ts        # 自動アサインエンジン（本プロジェクトの中核ロジック）
│   │   ├── autoBackfill.ts      # 欠勤発生時の自動代替配置
│   │   ├── dailyRoster.ts       # 1日分のスタッフ一覧構築（UI/Excel/PDF共通）
│   │   ├── dailyStaffing.ts     # 1日の必要人数 vs 出勤人数の集計
│   │   ├── weeklyHours.ts       # 週間勤務時間集計・パート週20時間上限チェック
│   │   ├── workTime.ts          # 勤務時間の解決ロジック（override > ShiftType > 基本勤務時間）
│   │   ├── timeSlots.ts         # 24時間・4:00始まりの営業日インデックス変換
│   │   ├── auth.ts              # NextAuth設定（Credentials Provider）
│   │   ├── mailer.ts            # メール通知（nodemailer）
│   │   └── prisma.ts            # PrismaClientのシングルトン
│   ├── middleware.ts          # 認証必須ページの保護（/dashboard /employees /roster /schedule /tasks /users）
│   └── types/next-auth.d.ts   # NextAuthのSession/JWT型拡張（role, employeeId）
├── docs/                      # このドキュメント一式（AIが最初に読むべき場所）
├── .env / .env.example        # 環境変数（DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, GROQ_API_KEY等）
├── package.json / package-lock.json
├── tsconfig.json / next.config.js
└── README.md                  # デプロイ手順（Vercel + Neon/Supabase）中心のセットアップガイド
```

## 各フォルダの役割（要約）

| フォルダ | 役割 |
|---|---|
| `prisma/` | DBスキーマとseedデータ。スキーマ変更は必ずここを起点に行う。 |
| `src/app/api/` | すべてのバックエンドAPI。Next.js App RouterのRoute Handler形式。 |
| `src/app/<page>/` | 各画面のUI（Reactコンポーネント、Client/Server混在）。 |
| `src/lib/` | DBアクセスやビジネスロジックを画面から独立させた共通関数群。**自動アサインの改修時はまずここを見る。** |
| `src/components/` | 現状ほぼ空。共通UI部品を追加する場合はここに置く想定。 |
| `docs/` | AIや新しい開発者向けのプロジェクト説明書一式。 |

## 命名・配置の慣習

- APIルートは `src/app/api/<resource>/route.ts`（一覧・作成）と `src/app/api/<resource>/[id]/route.ts`（個別の更新・削除）に分かれている。
- ビジネスロジックはできる限り `src/lib/*.ts` に切り出し、APIルートやページからimportして使う（`autoAssign.ts` を `route.ts` から呼ぶ構成が典型例）。
- 日本語のカラム値（業務コード `A`/`B`/`全`、シフトコード `早番`/`遅番`など）はDBに実データとして保存されており、コード上の識別子としてそのまま使われている。表示名との対応は `prisma/seed.ts` を参照。
