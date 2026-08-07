# CHANGELOG - WHILL Scheduler


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

## Future Changes

New changes should be added above this section.

Format:

## YYYY-MM-DD

### Feature name

- What was added
- What was changed
- What problem was fixed