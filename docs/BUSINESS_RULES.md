# BUSINESS_RULES.md — WHILL Scheduler

> このファイルは、コード（`prisma/schema.prisma`, `src/lib/*.ts`, `prisma/seed.ts`）と、
> 2026-08 に確定した業務ルール指示（`docs/AUTO_ASSIGN_RULES.md` のもとになった要件）から
> 判明している業務ルールをまとめたもの。自動アサイン固有の詳細ルールは
> AUTO_ASSIGN_RULES.md に分離しているので、そちらも合わせて読むこと。

## 用語（業務コード）

| コード (DB `CartPosition.code`) | 名称 | 分類 |
|---|---|---|
| `A` | Aカート（業務A） | CART |
| `B` | Bカート（業務B） | CART |
| `全` | 全カート（業務全） | CART |
| `BF` | BF | SPECIAL |
| `BREAK` | 休憩 | SPECIAL |
| `MOVE` | 移動 | SPECIAL |
| `WHILL_ARRIVAL_PREP` | WHILL到着準備 | SPECIAL |
| `WHILL_ARRIVAL_CLEANUP` | WHILL到着片づけ | SPECIAL |
| `WHILL_DEPARTURE_PREP` | WHILL出発準備 | SPECIAL |
| `WHILL_DEPARTURE_CLEANUP` | WHILL出発片づけ | SPECIAL |
| `OFFICE` | 事務時間 | SPECIAL |
| `MTG` | 会議 | SPECIAL |

（出典: `prisma/seed.ts` の `positions` 配列。これが実際にDBへ投入される業務マスタ。）

## 業務A・業務B・業務全

- 業務A: 稼働時間 **5:00〜26:00（=翌2:00）**。
- 業務B: 稼働時間 **6:00〜24:00**。
- 業務全: 稼働時間 **5:00〜25:00（=翌1:00）**。
- 時間帯あたりの必要人数は `TaskRequirement.requiredCount`（管理画面 `/tasks` で設定）で決まる。
  未設定の場合、自動アサインのフォールバック値は1名（`src/lib/autoAssign.ts` の `capFor`）。
  ただし `prisma/seed.ts` は初回投入時にA/B/全それぞれ requiredCount=4 をデフォルトとして
  設定している（⚠️ 要確認: 実運用でこの値が「1名」相当を想定しているのか「4名（4台のカート）」を
  想定しているのかはDB/管理画面側の設定次第であり、コードからは断定できない）。
- 優先順位は 業務A > 業務B > 業務全 > WHILL関連業務 > 休憩 > 事務時間（AUTO_ASSIGN_RULES.md参照）。

## WHILL関連業務

固定の時刻・固定の必要人数を持つ、1日4つのイベント（`src/lib/autoAssign.ts` の `WHILL_EVENTS`）。

| 業務 | 時間 | 必要人数 |
|---|---|---|
| WHILL（到）片づけ | 10:00〜11:00 | 1名 |
| WHILL（出）準備 | 11:00〜12:00 | 2名 |
| WHILL（出）片づけ | 18:00〜19:00 | 2名 |
| WHILL（到）準備 | 19:00〜20:00 | 1名 |

- パートスタッフ（`EmployeeRole.PARTTIME`）はWHILL業務に配置禁止。
- WHILL業務のために業務A/B/全の人員を削らない（優先順位が低いため、A/B/全に必要な人を
  奪ってはいけない）。

## 明け番（夜勤引き継ぎ）

- `ShiftType` の `明番`（22:00〜08:00, `spansMidnight: true`）で勤務するスタッフ。
- 当日シート上では、前日から続く夜勤として **4:00〜シフト終了時刻** の部分だけが
  「引き継ぎ（`isCarryOver: true`）」として表示される（`src/lib/dailyRoster.ts`）。
- 休憩は **2時間連続**。ただし全員を同時に休憩へ入れない。業務A/B/全の稼働時間内では、
  他スタッフの配置状況を見ながら順番に休憩を設定する（業務A/B/全の稼働時間外はこの制限なし）。

## 休憩ルール（通常勤務）

- 4時間未満の勤務には休憩を配置しない。
- 4時間以上勤務した場合、勤務開始から **3〜5時間程度** を目安に休憩を配置する。
- スタッフ全員を同時に休憩に入れない（時間をずらす）。
- 休憩よりも業務A/B/全の運営を優先する＝休憩によって業務A/B/全の枠が空白になるくらいなら、
  休憩の配置を後回しにする。

## 事務時間（OFFICE）

- **最初から事務時間を配置しない。** 業務A/B/全・WHILL関連業務・休憩をすべて配置したあとに
  余った時間だけを使う。
- パートスタッフは事務時間に配置禁止。

## パートスタッフ（`EmployeeRole.PARTTIME`）のルール

- 配置可能: 業務A / 業務B / 業務全（乗車業務のみ）。
- 配置禁止: WHILL準備・WHILL片づけ・事務時間・その他業務。
- 勤務時間の上限: **週20時間**（`src/lib/weeklyHours.ts` の `PARTTIME_WEEKLY_HOUR_LIMIT`）。
  この上限は既存のプロジェクトルールであり、今回の業務ルール改訂でも変更していない。

## 持ち場交代ルール

- 業務A/B/全について、同じスタッフが長時間同じ持ち場を担当し続けないようにする。
- 目安: **1〜3時間程度**で担当を交代する。

## ロールと権限（勤務系ロールとログイン系ロールは別軸）

- `EmployeeRole`（従業員としての役割）: `STAFF`（社員）/ `CONTRACT`（契約社員）/
  `PARTTIME`（バイト）/ `OJT` / `INC`（現状未使用、将来拡張用）。
- `UserRole`（ログインアカウントの権限）: `ADMIN` / `INC` / `EMPLOYEE`。
  `EmployeeRole.INC` と `UserRole.INC` は名前が同じだが別のenumであることに注意。

## ⚠️ 未確認・要確認事項

- WHILL業務の「到（到着）」「出（出発）」がそれぞれ何を指すか（WHILLの到着便・出発便の対応と
  推測されるが、業務仕様書等の一次情報での確認はできていない）。
- `RolePriority`（自動バックフィル時の優先順位: INC→STAFF→CONTRACT→PARTTIME→OJT）と、
  今回のAUTO_ASSIGN_RULES.mdの優先順位（A→B→全→WHILL→休憩→事務時間）は「何を優先するか」の
  軸が異なる（前者は「誰を優先するか」、後者は「どの業務を優先するか」）。両者は独立したルールとして
  共存している。
