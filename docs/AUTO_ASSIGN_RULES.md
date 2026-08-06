# AUTO_ASSIGN_RULES.md — 自動アサインエンジンの詳細仕様

> 対象ファイル: `src/lib/autoAssign.ts`（ロジック本体）、`src/app/api/schedule/auto-assign/route.ts`（API）。
> このファイルは自動アサインを改修するAI/開発者が**最初に読むべき**ドキュメント。
> 2026-08 の業務ルール改訂（v2）を反映済み。改訂前の実装との差分は CHANGELOG.md 参照。

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
- **交代する場合の選び方**: その時間帯に稼働中で、まだ他の業務に割り当てられておらず、
  「その日すでに割り当てられた業務時間数」が最も少ない人を選ぶ（`dutyHoursSoFar` による
  負荷の平準化）。
- 必要人数（`cap`）に対して割り当てられる人がいない場合は、その枠は空白のまま
  （`AUTO_ASSIGN_DEBUG=1` 環境変数を設定するとログに出力される）。

## 4. WHILL関連業務の割当てロジック

固定時刻・固定必要人数のイベントとして `WHILL_EVENTS` にハードコードしている
（`docs/BUSINESS_RULES.md` の表と同じ内容）。

- 対象スロットで、**すでに業務A/B/全に割り当てられていない人**（＝優先順位上位を削らない）かつ
  **パートスタッフではない人**の中から、業務時間数が少ない順に必要人数だけ選ぶ。
- 必要人数を満たせない場合は許容し、ログに残す。

⚠️ 実装メモ: WHILL準備・片づけの「必要人数」は現状ハードコード（`TaskRequirement`テーブルは
参照していない）。将来的に管理画面から人数を変更したい場合は、`TaskRequirement` から
`WHILL_ARRIVAL_PREP` 等のコードで検索して上書きする形に拡張するとよい（今回は「DB schemaも
既存API構造も変更しない」という要件のため、既存のCartPosition/TaskRequirementモデルを
そのまま使いつつ、値は要件書通りの固定値としている）。

## 5. 休憩の割当てロジック

業務A/B/全・WHILLをすべて配置し終えたあと、**まだ何も割り当てられていない空きスロット**
だけを対象に休憩を配置する（＝休憩のために既存の業務配置を上書きしない）。

- 4時間未満勤務: 休憩なし。
- 明け番（`isCarryOver === true` または開始時刻が22:00）: **2時間連続**の空きスロットを探す。
  他スタッフの休憩とできるだけ重ならない開始位置を優先するが、2時間目は重複を許容する
  （旧実装から踏襲したルール）。2時間連続の空きが取れない場合は1時間のみで妥協する。
- 通常勤務: 勤務開始から **3〜5時間後** の範囲内で、他スタッフの休憩と重ならない空きスロットを
  優先して1時間だけ配置する。範囲内に空きがなければ、勤務時間全体から空きを探す。
- `breakOccupiedSlots` という共有のSetで「そのスロットで誰か休憩中か」を管理し、休憩の
  時間をずらす（全員同時休憩の防止）。

## 6. 事務時間（OFFICE）の割当てロジック

すべての処理が終わったあと、**パートスタッフを除く**各従業員について、まだ何も入っていない
稼働時間帯のスロットを `OFFICE` として埋める。これ以上の条件（必要人数など）はない
（「余った時間だけ使う」というルールのため、事務時間には上限も下限もない）。

## 7. 型・関数のシグネチャ（呼び出し側との互換性）

```ts
export type DutyCode = "A" | "B" | "全";
export type WhillCode = "WHILL_ARRIVAL_PREP" | "WHILL_ARRIVAL_CLEANUP"
                       | "WHILL_DEPARTURE_PREP" | "WHILL_DEPARTURE_CLEANUP";
export type SpecialCode = "BREAK" | "OFFICE";

export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23
  code: DutyCode | WhillCode | SpecialCode;
};

export type DemandByCode = Partial<Record<DutyCode, number>>;

export function buildAutoAssignPlan(
  rosterItems: DailyRosterItem[],
  demandByCode?: DemandByCode
): AutoAssignEntry[];

export function computeShortageCount(
  entries: AutoAssignEntry[],
  activeSlotIndexes: Set<number>
): number;

export const PRODUCTIVE_CODES: readonly DutyCode[]; // ["A", "B", "全"]
```

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
- POST/GETのリクエスト・レスポンス形式（`{ date }` → `{ success, shortageCount, assignedCount }`、
  `?month=` → `{ existingCount }`）は変更していない。

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
  互換性のみ維持）。今回の優先順位・休憩ルールの変更が `autoBackfill.ts` 側の代替配置ロジックに
  波及していない点は、必要であれば別途改修を検討すること（TODO.md参照）。
