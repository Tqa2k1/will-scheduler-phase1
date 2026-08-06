# ARCHITECTURE.md — WHILL Scheduler

## 全体像

WHILL Scheduler は、パシフィック・クルー株式会社の勤務表（月間ローテーション + 日別の業務配置）を
Excel手入力から置き換えるための社内向けWebアプリケーション。単一の Next.js アプリが
フロントエンド（ページ）とバックエンド（APIルート）の両方を兼ねる、いわゆるモノリシック構成。

```
[ブラウザ]
   │  React (Client Components) — 画面操作・入力
   ▼
[Next.js App Router]
   ├─ src/app/<page>/page.tsx   … 画面（フロントエンド）
   └─ src/app/api/**/route.ts  … APIルート（バックエンド）
        │
        ▼
[src/lib/*.ts]                 … ビジネスロジック（自動アサイン、勤務時間解決、週間上限チェック等）
        │
        ▼
[Prisma Client] ──▶ [PostgreSQL]  … 永続化層（prisma/schema.prisma が唯一の正）
```

デプロイは Vercel（Next.jsをそのままホスティング）、DBはNeon/Supabaseなどの外部PostgreSQLを
`DATABASE_URL` 環境変数で接続する構成（README.md参照）。

## レイヤー構成

### 1. フロントエンド（`src/app/<page>/page.tsx`）
- 全画面が日本語UI。管理者（ADMIN）は全機能、EMPLOYEEは自分の勤務閲覧のみ、INCは監督役割。
- 主要画面: ダッシュボード / 従業員管理 / アカウント管理 / 月間勤務表（Master Roster）/
  日別スケジュール（Daily Assignment）/ 業務・業務要件管理 / 勤務希望申請。
- 認証必須ページは `src/middleware.ts` で保護される。

### 2. API（`src/app/api/**/route.ts`）
- Next.js の Route Handler（GET/POST/PATCH/DELETE を個別にexport）。
- すべてのAPIで `getServerSession(authOptions)` によりログイン必須、多くは `role === "ADMIN"` の
  チェックを行う（詳細は API.md）。
- 入力バリデーションは `zod` を使用。

### 3. ビジネスロジック（`src/lib/*.ts`）
APIルートから呼ばれる、DBアクセスを含む純粋なロジック層。

| ファイル | 役割 |
|---|---|
| `autoAssign.ts` | **自動アサインエンジン本体。** 1日分のスタッフ一覧から、業務A/B/全・WHILL関連業務・休憩・事務時間の割当てプランを計算する（DB非依存の純粋関数）。詳細は AUTO_ASSIGN_RULES.md。 |
| `dailyRoster.ts` | MonthRoster（月間）から、指定日の出勤スタッフ一覧＋各自の実稼働時間帯（営業日インデックス）を構築する。前日22:00開始の夜勤（明け番）の引き継ぎ表示もここで処理。 |
| `dailyStaffing.ts` | その日の必要人数（TaskRequirement合算）と出勤予定人数を比較し、不足人数を返す。 |
| `autoBackfill.ts` | 従業員が急に休み（公休/有休/調整休）になった際、その人が担当していた業務A/B/全の枠を、優先順位（RolePriority）に従って他の出勤者で自動的に埋め直す。 |
| `weeklyHours.ts` | 週（日〜土）の合計勤務時間を計算。パートスタッフの週20時間上限チェックに使用。 |
| `workTime.ts` | 1日の勤務時間を「その日の例外時間 > ShiftType > 従業員の基本勤務時間」の優先順位で解決する。 |
| `timeSlots.ts` | 4:00始まり24時間の「営業日インデックス」と実時刻の相互変換。 |
| `auth.ts` | NextAuthのCredentials Provider設定（email/password + bcrypt）。 |
| `mailer.ts` | 月間スケジュール確定時などのメール通知（nodemailer）。 |
| `prisma.ts` | PrismaClientのシングルトンインスタンス。 |

### 4. データベース（`prisma/schema.prisma`）
PostgreSQL + Prisma。詳細は DATABASE.md。

## 「時間」の扱い方（重要・複数ファイルにまたがる設計）

このプロジェクト全体で、営業日を **4:00始まり・24個の1時間スロット（インデックス0〜23）** として
扱う設計が一貫している（`timeSlots.ts`）。

- `operatingIndex(hour)`: 実時刻（0-23時）→ 営業日インデックスに変換。例: 4時→0, 5時→1, 3時→23。
- 22:00開始のような夜勤（明番）は、当日シートでは「4:00〜シフト終了時刻」の**引き継ぎ**として、
  翌日側の `dailyRoster.ts` の処理で別途表示される（`isCarryOver: true`）。
- `autoAssign.ts` の `slotIndex` もこのインデックスに準拠しており、`WHILL_EVENTS` の固定時刻
  （例: 10:00〜11:00）もすべて `operatingIndex()` を通して変換している。

この設計を無視して「0時始まりの24時間」として実装すると、夜勤の引き継ぎやWHILL業務の時刻が
ズレるため、時間まわりを触る際は必ず `timeSlots.ts` を経由すること。

## データの流れ（自動アサインの例）

```
[管理者が「自動割当」ボタンを押す]
        │
        ▼
POST /api/schedule/auto-assign { date }
        │
        ├─ buildDailyRosterView(date)         … その日の出勤者一覧＋実稼働時間帯を取得
        ├─ CartPosition + TaskRequirement取得  … 業務A/B/全の時間帯あたり必要人数(demandByCode)
        │
        ▼
buildAutoAssignPlan(rosterItems, demandByCode)  … src/lib/autoAssign.ts（DB非依存の純粋関数）
        │  優先順位: 業務A→業務B→業務全→WHILL→休憩→事務時間
        ▼
AutoAssignEntry[]（employeeId, slotIndex, code）
        │
        ▼
DailyAssignment テーブルへ一括保存（削除→createMany のトランザクション）
        │
        ▼
computeShortageCount() で不足数を計算し、APIレスポンスとして返す
```

## 認証・認可

- NextAuth（Credentials Provider）+ JWT セッション。JWTに `id / role / employeeId` を格納
  （`src/types/next-auth.d.ts` で型拡張）。
- `UserRole`: `ADMIN`（全権限）/ `INC`（現状未使用、将来の管理職拡張用）/ `EMPLOYEE`（閲覧のみ）。
- `EmployeeRole`（業務上の役割。UserRoleとは別軸）: `STAFF` / `CONTRACT` / `PARTTIME` / `OJT` / `INC`。
  自動アサインのパート制限（WHILL・事務時間禁止）はこちらの `EmployeeRole` を見る。
- `src/middleware.ts` が保護対象ページへの未ログインアクセスをブロックする。

## 外部連携

- **メール**: `nodemailer` 経由（`src/lib/mailer.ts`）。月間スケジュール確定時の通知等。
- **AI機能**: `groq-sdk` を使った `POST /api/roster/ai-assist`（月間ローテーションのAI提案）と
  `POST /api/roster/apply-ai-changes` / `POST /api/ai-confirm`（提案の適用）。これは
  **自動アサインエンジン（`autoAssign.ts`）とは別の独立した機能**であることに注意。月間ローテーション
  （出勤/公休パターン）向けのAI支援であり、日別の業務配置（A/B/全/WHILL等）は関与しない。
- **Excel/PDF出力**: `exceljs`（Excel）、`pdfkit`（PDF）。`src/app/api/export/*` 配下。

## ⚠️ 未確認・要確認事項
- `INC` ロール（UserRole/EmployeeRole双方に存在）の権限設計は AI_CONTEXT.md にも記載の通り
  「実装が必要」というコメントがコード上に残っており、現状の挙動は完全には確定していない。
