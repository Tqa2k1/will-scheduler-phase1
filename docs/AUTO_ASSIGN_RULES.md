# AUTO_ASSIGN_RULES.md — 自動アサインエンジンの詳細仕様

> 対象ファイル: `src/lib/dutySchedule.ts`（稼働時間・必要人数の定義。単一の情報源）、
> `src/lib/autoAssign.ts`（ロジック本体）、`src/app/api/schedule/auto-assign/route.ts`（API）、
> `src/app/schedule/[date]/page.tsx`（「配置状況」表示。`dutySchedule.ts`を共有する）。
> このファイルは自動アサインを改修するAI/開発者が**最初に読むべき**ドキュメント。
> 2026-08 の業務ルール改訂（v2）と、優先順位・夜勤休憩バグの修正（v3）を反映済み。
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

- 各スロット（時間帯）ごとに、優先順位 A→B→全 の順で、`demandByCode`（呼び出し元がDBの
  `TaskRequirement.requiredCount` から算出して渡す。未設定時は1名）の人数分だけ埋める。
- **継続 or 交代の判定**: 直前のスロットで同じ業務を担当していた人がいて、かつ連続担当時間が
  `MAX_CONSECUTIVE_HOURS_ON_DUTY`（=3時間）未満なら、その人を優先的に継続させる。
  3時間に達したら別の人に交代する（＝「1〜3時間程度で交代」ルールの実装）。
- **交代する場合の選び方**: その時間帯に稼働中で、まだ他の業務に割り当てられていない人の中から、
  ①`RolePriority`（管理画面 `/role-priorities` で設定するロール優先順位。小さいほど優先）
  → ②「その日すでに割り当てられた業務時間数」が最も少ない人、の順で選ぶ
  （`sortCandidates()`）。①が同点のスタッフ間でのみ②による負荷平準化を行う。
  優先順位が未設定のロールはフォールバック値`999`（最低優先）として扱う。これは
  `src/lib/autoBackfill.ts`の`priorityOf()`と同じ考え方・同じフォールバック値であり、
  プロジェクト内で一貫している。
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

## 5. 休憩の割当てロジック（v3で「経過時間ベース」に修正）

業務A/B/全・WHILLをすべて配置し終えたあと、**まだ何も割り当てられていない空きスロット**
だけを対象に休憩を配置する（＝休憩のために既存の業務配置を上書きしない）。

### v2までの問題点

v2までは、休憩位置を「そのシート（当日 or 翌日）の見た目上のインデックス」基準で計算していた。
これには2つの問題があった。

1. 日付をまたぐ夜勤（例: 22:00〜翌5:00）は `buildDailyRosterView()` によって
   「当日シート側の断片（22:00〜24:00）」と「翌日シート側の断片＝引き継ぎ（4:00〜5:00）」に
   分割される（`DailyRosterItem.isCarryOver`）。v2はこの2つの断片それぞれを独立に見て
   「4時間以上ならこの断片単独で休憩が必要」と判定していたため、本来は連続した1つの勤務
   なのに、条件次第で休憩が二重に入ったり、シート境界（4:00）付近に不自然な休憩が
   計算されたりする不具合があった。
2. 「勤務開始から3〜5時間」という基準を、シートの見た目上の開始スロット
   （`activeStartIdx`。夜勤の引き継ぎ断片では常に0＝4:00になる）からの経過として計算していた
   ため、実際のシフト開始時刻（例: 22:00）を無視した位置に休憩が計算されるケースがあった。

### v3の修正方針

休憩の判定基準を「**実際のシフト開始時刻（`resolvedStart`）からの経過時間**」に統一した。

- `totalShiftHours`: `resolvedStart`と`resolvedEnd`から求めた**シフト全体**（2つの断片に
  分かれる場合はその合計）の実労働時間。4時間未満なら休憩なし。
- `hoursElapsedBeforeSheet`: 「このシート（断片）に入る前に、シフト開始から何時間経過して
  いたか」。日をまたがない断片・当日側の断片は0。翌日側の引き継ぎ断片は
  `(4 - 開始時刻の時 + 24) % 24`（例: 22:00開始なら6時間）。
- 各スロットの「シフト開始からの経過時間」= `hoursElapsedBeforeSheet + (slot - activeStartIdx)`。
- 許容範囲: シフト全体の**最初の1時間・最後の1時間を除いた範囲**
  （＝「勤務開始直後」「勤務終了直前」を禁止するルールの実装）。
- 優先範囲: 経過3〜5時間（通常勤務・明け番とも同じ基準を使う。明け番だけ休憩の長さが2時間に
  なる点が異なる）。
- 対象スロットが「このシートの断片」に含まれない場合は何もしない
  （＝もう一方の断片側の実行で正しく処理されるため、二重に休憩が入らない）。

この設計により、22:00〜翌5:00のような夜勤でも、休憩は実際の経過時間を基準に1回だけ、
シフト全体の中間あたりに正しく配置されるようになった（旧実装で報告されていた
「2:00〜5:00に不自然な3時間休憩」のような問題を修正）。

- 明け番判定: `shiftTypeCode === "明番"`、またはフォールバックとして開始時刻が22:00。
  明け番は**2時間連続**の空きスロットを、他スタッフの休憩とできるだけ重ならない位置・
  優先範囲（経過3〜5時間）に近い位置から探す。取れない場合は1時間のみで妥協する
  （2時間目のみ他スタッフの休憩との重複を許容する、という旧実装のルールを踏襲）。
- 通常勤務: 優先範囲（経過3〜5時間）内で、他スタッフの休憩と重ならない空きスロットを
  1時間だけ配置する。優先範囲に空きがなければ、許容範囲全体から探す。
- `breakOccupiedSlots` という共有のSetで「そのスロットで誰か休憩中か」を管理し、休憩の
  時間をずらす（全員同時休憩の防止）。

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
