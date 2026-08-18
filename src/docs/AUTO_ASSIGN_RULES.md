# AUTO_ASSIGN_RULES.md — 自動アサインエンジンの詳細仕様

> 対象ファイル: `src/lib/dutySchedule.ts`（稼働時間・必要人数の定義。単一の情報源）、
> `src/lib/autoAssign.ts`（ロジック本体）、`src/app/api/schedule/auto-assign/route.ts`（API）、
> `src/app/schedule/[date]/page.tsx`（「配置状況」表示。`dutySchedule.ts`を共有する）。
> このファイルは自動アサインを改修するAI/開発者が**最初に読むべき**ドキュメント。
> 2026-08 の業務ルール改訂（v2）、優先順位・夜勤休憩バグの修正（v3）、
> 休憩の確実性・タイミング精度・持ち場交代の改善（v4）を反映済み。
> 改訂前の実装との差分は CHANGELOG.md 参照。

## 1. 優先順位（最重要）

```
① 業務A
② 業務B
③ 業務全
④ WHILL関連業務（準備・片づけ）
⑤ 休憩
⑥ 事務時間（OFFICE）
```

「最優先」＝「必ず人数不足をゼロにする」ではない。スタッフ人数・勤務時間・休憩条件により
不足が生じるのは許容する。重要なのは **他の業務よりA/B/全を優先して埋める順序**。
WHILL業務や事務時間を確保するために業務A/B/全の配置を削減してはいけない。

`buildAutoAssignPlan()` の処理順序はこの優先順位をそのまま反映しており、
1) 業務A/B/全 → 2) WHILL → 3) 休憩 → 4) 事務時間 の順に、前段で使われていない
「空きスロット」だけを次の段が使う設計になっている。

## 2. 時間の表現方法

`slotIndex` は 0〜23 の整数で、**4:00始まりの営業日インデックス**（`src/lib/timeSlots.ts` の
`operatingIndex()`）。例: `slotIndex=0` は4:00〜5:00、`slotIndex=23` は翌3:00〜4:00。

業務A/B/全の稼働時間はこのインデックスに変換して `DUTY_WINDOW` に保持している
（`windowFromClock(startHour, endHourExclusive)` で実時刻から自動計算）。

| 業務 | 実時刻 | 内部表現 (startIdx, endIdx) |
|---|---|---|
| A | 5:00〜26:00 | (1, 22) |
| B | 6:00〜24:00 | (2, 20) |
| 全 | 5:00〜25:00 | (1, 21) |

## 3. 業務A/B/全の割当てロジック

- 各業務ごとに、稼働時間の全スロットを先頭から順に処理する（Phase 2: 業務A全体 → Phase 3: 業務B全体
  → Phase 4: 業務全全体、という「業務ごとに全時間帯を通しで埋める」構成。v3までの
  「スロットごとにA→B→全を処理する」構成から、優先順位の意味をより素直に表す構成に変更した。
  結果として生成される配置自体はほぼ同じだが、コードの意図が明確になっている）。
- **持ち場交代（v4で「2時間を優先・3時間まで許容」に変更）**:
  - 直前スロットの担当者の連続担当時間が**2時間未満**なら、そのまま継続する
    （1時間ごとに毎回交代するのは不自然なため）。
  - **2時間に達したら、まず交代を試みる**。その時間に稼働中で、まだ他の業務に
    割り当てられていない**別の**候補がいれば、その人に交代する。
  - 交代候補がいない場合（例: その時間に稼働しているのがその1人だけ）は、
    **3時間、4時間…と延長してでも同じ人が継続する**（「運用の安定 > 強制的な交代」という
    要件7の原則）。交代を強制して欠員（不足）を作ることはしない。
  - **交代の方向性**: 交代先の候補を選ぶ際、直前に**同じ業務**を担当していた人より、
    **別の業務**を担当していた人を優先する（例: 直前にAをやっていた人がBに回るのを優先し、
    Aから空いた直後にまたAへ、という「行ったり来たり」を避ける）。
- **交代する場合の選び方**: ①`RolePriority`（管理画面 `/role-priorities` で設定するロール優先順位。
  小さいほど優先）→ ②直前と別の業務かどうか（交代の方向性）→ ③その日すでに割り当てられた
  業務時間数が少ない人、の順で選ぶ（`sortCandidates()`）。優先順位が未設定のロールは
  フォールバック値`999`（最低優先）として扱う。`autoBackfill.ts`の`priorityOf()`と同じ考え方。
- 必要人数（`cap`）に対して割り当てられる人がいない場合は、その枠は空白のまま
  （`AUTO_ASSIGN_DEBUG=1` 環境変数を設定するとログに出力される）。

## 4. WHILL関連業務の割当てロジック

固定時刻・固定必要人数のイベントとして `WHILL_EVENTS` にハードコードしている
（`docs/BUSINESS_RULES.md` の表と同じ内容）。

- 対象スロットで、**すでに業務A/B/全に割り当てられていない人**（＝優先順位上位を削らない）かつ
  **パートスタッフではない人**の中から、業務A/B/全と同じ`sortCandidates()`（ロール優先順位→
  業務時間数の少なさ）の順で必要人数だけ選ぶ。
- 必要人数を満たせない場合は許容し、ログに残す。

⚠️ 実装メモ: WHILL準備・片づけの「必要人数」は現状ハードコード（`TaskRequirement`テーブルは
参照していない）。将来的に管理画面から人数を変更したい場合は、`TaskRequirement` から
`WHILL_ARRIVAL_PREP` 等のコードで検索して上書きする形に拡張するとよい（今回は「DB schemaも
既存API構造も変更しない」という要件のため、既存のCartPosition/TaskRequirementモデルを
そのまま使いつつ、値は要件書通りの固定値としている）。

## 5. 休憩の割当てロジック（v3で「経過時間ベース」に、v4で「確実性」を追加）

業務A/B/全・WHILLを配置した後（Phase 7）、休憩を配置する。**パートスタッフは対象外**
（v4で明確化: パートスタッフには一切休憩を付与しない。既存のパート運用条件をそのまま使う）。

### v4で追加した「休憩の確実性」の原則

> 従業員の休憩の権利 > 不足ゼロ

4時間以上勤務するスタッフ（特に8時間以上勤務するスタッフ）が、業務A/B/全の配置で
時間帯が埋め尽くされてしまい**休憩が1つも取れない**、という不具合があった
（`buildAutoAssignPlan`がduty割当てを優先しすぎて、休憩用の空きスロットが残らないケース）。

v4では、休憩を配置する際にまず**空いているスロット**を探すのは従来通りだが、
空きが見つからない場合は、**業務A/B/全に割り当て済みのスロットを1つ（明け番は2つ）
取り消して休憩に置き換える**（WHILL・事務時間・他の休憩は取り消さない）。これにより
不足数（`computeShortageCount`の値）が増える可能性があるが、要件通り「休憩を優先し、
不足はごまかさず表示する」という原則を実装している。ログには
`休憩を確保するため業務◯の割当てを取り消しました` と出力される。

### タイミング

- 最優先: **経過4時間**（`BREAK_ANCHOR_OFFSET`）に最も近いスロット。
- 許容範囲: **経過3〜5時間**（`BREAK_ACCEPTABLE_MIN_OFFSET`〜`BREAK_ACCEPTABLE_MAX_OFFSET`）を
  優先範囲とし、見つからなければシフト全体で「最初の1時間・最後の1時間を除いた範囲」
  （＝勤務開始直後・終了直前を禁止する要件3の実装）まで探索を広げる。
- 明け番（`isNightShift`）は**必ず2時間連続**。3時間以上には絶対に延長しない
  （2時間連続が確保できない場合のみ1時間に妥協する。3時間になることはない）。

### 日をまたぐ夜勤の二重休憩を防ぐ「責任断片」の仕組み（v4で追加・重要）

`buildAutoAssignPlan()`は1日（1シート）単位で呼び出される純粋関数であり、日をまたぐ夜勤
（明け番）は当日側の断片・翌日側（引き継ぎ）の断片という**2回の別々の呼び出し**で処理される
（`docs/ARCHITECTURE.md`参照）。休憩の必要性判定を単純に「この断片だけで4時間/8時間以上か」で
行うと、**両方の断片が独立に「休憩が必要」と判断し、休憩が二重に入ってしまう**
不具合があった（テストで確認済み。例: 22:00〜08:00の10時間夜勤で、本来2時間のはずの休憩が
当日側1〜2時間＋翌日側1〜2時間＝最大4時間になっていた）。

v4では、シフト全体（両断片の合計）の**中間時点**（`totalShiftHours / 2` 経過時点）が
どちらの断片に属するかを決定的に計算し（`ownsBreakResponsibility`）、**その断片だけが
休憩配置の責任を持つ**ようにした。中間時点は2つの断片の経過時間レンジ
（`[hoursElapsedBeforeSheet, hoursElapsedBeforeSheet + fragmentLength)`）のどちらか片方にのみ
含まれるため、責任が重複することはない。責任を持たない側の断片は、ベストエフォートの
休憩配置すら行わない（ログに「このシートの断片は休憩配置の責任を持たない」と出力される）。
日をまたがない通常のシフトは断片が1つしかないため、常にその断片が責任を持つ
（＝挙動は変わらない）。

`hoursElapsedBeforeSheet`（このシートに入る前にシフト開始から何時間経過していたか）の
求め方は v3 から変更なし: 日をまたがない断片・当日側の断片は0。翌日側の引き継ぎ断片は
`(4 - 開始時刻の時 + 24) % 24`（例: 22:00開始なら6時間）。

- `breakOccupiedSlots` という共有のSetで「そのスロットで誰か休憩中か」を管理し、休憩の
  時間をずらす（全員同時休憩の防止）。これは同一の`buildAutoAssignPlan()`呼び出し内
  （＝同じ日のシート内）でのみ有効なスコープであることに注意。

## 6. 事務時間（OFFICE）の割当てロジック

すべての処理が終わったあと、**パートスタッフを除く**各従業員について、まだ何も入っていない
稼働時間帯のスロットを `OFFICE` として埋める。これ以上の条件（必要人数など）はない
（「余った時間だけ使う」というルールのため、事務時間には上限も下限もない）。

## 7. 型・関数のシグネチャ（呼び出し側との互換性）

```ts
// src/lib/dutySchedule.ts（Prisma非依存。稼働時間・必要人数の単一の情報源）
export type DutyCode = "A" | "B" | "全";
export type WhillCode = "WHILL_ARRIVAL_PREP" | "WHILL_ARRIVAL_CLEANUP"
                       | "WHILL_DEPARTURE_PREP" | "WHILL_DEPARTURE_CLEANUP";
export const DUTY_WINDOW: Record<DutyCode, { startIdx: number; endIdx: number }>;
export const WHILL_EVENTS: { code: WhillCode; slotIndex: number; requiredCount: number; label: string }[];
export const PRODUCTIVE_CODES: readonly DutyCode[]; // ["A", "B", "全"]
export function isDutyActiveAtSlot(code: DutyCode, slot: number): boolean;
export function requiredCountAtSlot(code: DutyCode | WhillCode, slot: number, demandByCode?: Partial<Record<DutyCode, number>>): number;

// src/lib/autoAssign.ts
export type SpecialCode = "BREAK" | "OFFICE";
export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23
  code: DutyCode | WhillCode | SpecialCode;
};
export type DemandByCode = Partial<Record<DutyCode, number>>;
export type PriorityByRole = Partial<Record<string, number>>; // role -> priorityOrder（小さいほど優先。未設定は999）

export function buildAutoAssignPlan(
  rosterItems: DailyRosterItem[],
  demandByCode?: DemandByCode,
  priorityByRole?: PriorityByRole   // v3で追加。省略時は{}（優先順位なし＝従来通り）
): AutoAssignEntry[];

export function computeShortageCount(
  entries: AutoAssignEntry[],
  activeSlotIndexes: Set<number>
): number;
```

`priorityByRole` は**追加した3番目の引数**（末尾に追加、デフォルト値`{}`）であり、
既存の2引数での呼び出し（`buildAutoAssignPlan(rosterItems, demandByCode)`）はそのまま動作する
後方互換な変更。呼び出し元の `route.ts` では `prisma.rolePriority.findMany()` の結果から
`{ [role]: priorityOrder }` の形にして渡している。

`buildAutoAssignPlan` / `computeShortageCount` / `PRODUCTIVE_CODES` のシグネチャは
2026-08改訂の前後で変更していない（`src/lib/autoBackfill.ts` が `PRODUCTIVE_CODES` を
importしているため、これを壊すと欠勤時の自動代替配置が動かなくなる）。

`AutoAssignEntry.code` の型に新しいリテラル（`WhillCode`の一部、`OFFICE`）を追加しているが、
これは型の**拡張**であり、既存のコード（`"A" | "B" | "全" | "BREAK" | "WHILL_DEPARTURE_PREP" |
"WHILL_DEPARTURE_CLEANUP"`）はすべてそのまま含まれている。

## 8. API側の変更点（`src/app/api/schedule/auto-assign/route.ts`）

- `positions` を取得する `cartPosition.findMany` の `code: { in: [...] }` に、新しく使うようになった
  `"OFFICE"`, `"WHILL_ARRIVAL_PREP"`, `"WHILL_ARRIVAL_CLEANUP"` を追加した
  （`"WHILL_DEPARTURE_PREP"` / `"WHILL_DEPARTURE_CLEANUP"` はもともと含まれていた）。
- これら業務コードは `prisma/seed.ts` の `positions` 配列に**既に定義済み**だったため、
  Prisma schemaの変更や新しいマイグレーションは不要（`CartPosition.code` は自由文字列の
  `String @unique` であり、enumではない）。
- `prisma.rolePriority.findMany()` を追加で呼び出し、結果を`priorityByRole`として
  `buildAutoAssignPlan()`に渡すようにした（v3）。`RolePriority`モデル自体は元々存在しており、
  今回はその「未使用だった既存データ」を自動アサインでも参照するようにしただけで、
  schemaの変更は伴わない。
- POST/GETのリクエスト・レスポンス形式（`{ date }` → `{ success, shortageCount, assignedCount }`、
  `?month=` → `{ existingCount }`）は変更していない。

## 11. 日別スケジュール画面（`src/app/schedule/[date]/page.tsx`）との連携

- 画面の「配置状況」行（不足表示）は、サーバー側の自動アサインと**同じ**
  `src/lib/dutySchedule.ts` の稼働時間・WHILL定義を参照する（クライアントコンポーネントから
  Prisma依存のファイルを直接importしないよう、稼働時間の定義だけをPrisma非依存の別ファイルに
  切り出してある）。A/B/全の必要人数は `GET /api/task-requirements` から取得し、自動アサインAPI
  （`route.ts`）と同じロジック（`appliesToAllRoles`の要件を優先、なければ先頭の要件、未設定なら1）
  で算出している。
- 画面の社員表示順（`buildDailyRosterView()`が返す並び順）は role/yakuwari では決めず、
  「勤務開始時刻→勤務終了時刻→氏名」の順に統一した（詳細は `src/lib/dailyRoster.ts` および
  BUSINESS_RULES.md）。
- 画面から「シフト」列を削除した（`shiftTypeCode`自体やDBの`ShiftType`関連ロジックは削除しておらず、
  表示のみの変更）。Excel/PDF出力（`src/app/api/export/schedule-excel`, `schedule-pdf`）には
  シフト列がまだ残っている。今回のスコープは「日別スケジュール画面」のみだったため、
  出力ファイル側は意図的に変更していない（TODO.md参照）。

## 9. デバッグ方法

環境変数 `AUTO_ASSIGN_DEBUG=1` を設定して自動アサインを実行すると、以下のようなケースで
`console.log("[autoAssign]", ...)` によるログが出力される（「なぜその配置になったか」の追跡用）。

- 業務A/B/全のある時間帯・ある枠に配置できる人がいなかった場合
- WHILL業務で必要人数を満たせなかった場合
- 明け番の2時間連続休憩を確保できず1時間に妥協した場合
- 休憩を入れる空きスロットが1つもなかった場合

## 10. 意図的に変更しなかったこと

- 既存の業務コード名・DB schema・API入出力形式は変更していない。
- パートスタッフの週20時間上限（`weeklyHours.ts`）はそのまま利用（変更なし）。
- `autoBackfill.ts`（欠勤時の自動代替配置）は今回の改修対象外（`PRODUCTIVE_CODES` の
  互換性のみ維持）。`autoBackfill.ts`は元々`RolePriority`を使っており、今回の
  優先順位バグ修正はこのファイルの既存ロジックと同じ考え方に自動アサイン側を合わせた形になる。
  ただし`autoBackfill.ts`はA/B/全のみを対象としており、WHILL関連業務・休憩・事務時間の優先順位
  ルール（本ドキュメント冒頭）には対応していない。必要であれば別途改修を検討すること（TODO.md参照）。
- `src/lib/dailyStaffing.ts`（`getDailyStaffingStatus()`）は**別の指標**であり、今回の
  「配置状況（時間帯ごとの不足）」修正の対象外。こちらは「1日の必要合計人数 vs 出勤予定人数」を
  時間帯を区別せずに比較する日単位の粗い指標で、`ShiftClaimRequest`（勤務希望申請）機能が
  「今後30日で人員が足りなそうな日」を一覧するために使っている。時間帯別の考慮がないという
  設計自体は今回のバグとは異なる（元々「日単位」の指標として設計されている）ため、変更していない。
  時間帯を考慮した不足判定が欲しい場合は、`dutySchedule.ts`を使って作り直す必要がある
  （TODO.mdに記載）。
