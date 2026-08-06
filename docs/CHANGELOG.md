# CHANGELOG - WHILL Scheduler


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

## Future Changes

New changes should be added above this section.

Format:

## YYYY-MM-DD

### Feature name

- What was added
- What was changed
- What problem was fixed