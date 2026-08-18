# DATABASE.md — Prisma Schema 解説

> ソース: `prisma/schema.prisma`（全14モデル + 補助enum）。PostgreSQL + Prisma 5.20.0。
> このファイルの内容を変更する場合は必ずマイグレーションを作成し、`docs/CHANGELOG.md` に記録すること。

## モデル一覧と役割

| モデル | 役割 |
|---|---|
| `User` | ログインアカウント（ADMIN/INC/EMPLOYEE）。`Employee` と1:1で紐付け可能。 |
| `Employee` | 従業員マスタ。氏名・役割・通勤方法・基本勤務時間など。 |
| `ShiftType` | シフト種別マスタ（明番/早番/中番/遅番/超早/超遅）。 |
| `MonthRoster` | **月間**の出退勤ステータス（WORK/OFF/PAID_LEAVE/ADJUST_LEAVE）+ シフト種別 + その日だけの例外時間。 |
| `CartPosition` | 業務マスタ（A/B/全/BF/休憩/移動/WHILL関連/事務時間/MTG）。 |
| `TaskRequirement` | 業務ごとの必要人数・対象ロール。 |
| `RolePriority` | 自動バックフィル時にどの`EmployeeRole`を優先するか。 |
| `CartOperatingHours` | 業務の稼働時間テンプレート（曜日区分ごと）。 |
| `DemandTemplate` | 30分スロット単位の契約人員需要テンプレート。 |
| `DailyAssignment` | **日別**の実際の割当て（1時間スロット×業務×従業員）。自動アサインが書き込む中心テーブル。 |
| `Break` | 休憩時間の記録。 |
| `RotationPattern` / `EmployeeRotationPattern` | 勤務ローテーションパターン（4勤2休など）とその適用。 |
| `PersonalConstraint` | 従業員ごとのNG/OK制約。 |
| `IncidentFlag` | 遅刻・遅延・早退・残業などの実績フラグ。 |
| `ShiftClaimRequest` | 人員不足日への出勤希望申請（EMPLOYEE申請→INC/管理者承認）。2026-08〜「希望勤務(KIBO)」の時間帯指定にも対応（`desiredStartTime`/`desiredEndTime`）。 |
| `EmployeePriority` | 従業員個人の優先順位（2026-08追加）。`RolePriority`（役割単位）とは独立。人員不足時に同じ役割の中で誰を優先的に検討するかにのみ使う。 |
| `RosterAuditLog` | 変更履歴（汎用の監査ログ）。 |

## 主要なリレーション

```
User 1─1 Employee
Employee 1─N MonthRoster, DailyAssignment, Break, PersonalConstraint,
             IncidentFlag, EmployeeRotationPattern, ShiftClaimRequest
MonthRoster N─1 ShiftType
CartPosition 1─N TaskRequirement, CartOperatingHours, DemandTemplate, DailyAssignment
RotationPattern 1─N EmployeeRotationPattern N─1 Employee
```

## 重要なフィールド・値の意味

### `Employee`
- `role: EmployeeRole`（`STAFF`/`CONTRACT`/`PARTTIME`/`OJT`/`INC`）— **業務上の役割**。
  自動アサインのパート制限判定（WHILL・事務時間禁止）はこのフィールドを見る。
- `baseStartTime` / `baseEndTime` — 従業員固有の基本勤務時間（`workTime.ts`のフォールバック）。
- `contactEmail` — 月間スケジュール確定通知の送信先。

### `MonthRoster`
- `@@unique([employeeId, workDate])` — 1人1日1レコード。
- `overrideStartTime` / `overrideEndTime` — その日だけの例外的な勤務時間。設定されていれば
  `ShiftType`や`baseStartTime`より優先される（`resolveWorkTime()`の優先順位）。
- `status`: `WORK`のみが「出勤」として扱われ、`autoAssign`や`dailyStaffing`の集計対象になる。

### `CartPosition`
- `code: String @unique` — **enumではなく自由文字列**。新しい業務を追加する際にPrisma
  schemaの変更は不要（`prisma/seed.ts`にレコードを追加するだけでよい）。今回のWHILL関連業務・
  事務時間もこの仕組みで追加済み。
- `slotUnitMinutes`（2026-08追加、デフォルト60）— 日別スケジュールの手動編集で、この業務を
  30分単位のコマとしても配置できるかどうか。既存業務はすべて60（＝従来通り1時間単位）。
  自動アサイン（`autoAssign.ts`）は引き続き1時間粒度のみで動作し、この値は関与しない。
- `category`: `CART`（A/B/全のような乗車業務）と`SPECIAL`（休憩・WHILL・事務時間など）を区別。

### `TaskRequirement`
- `requiredCount` — 自動アサインの`demandByCode`（時間帯あたり必要人数）の元データ。
- `appliesToAllRoles` / `targetRoles` — 特定ロール限定の要件を将来的に表現できる設計だが、
  現状の自動アサインロジックは`appliesToAllRoles`の要件（または先頭の要件）のみ参照する
  （`route.ts`の`demandByCode`算出部分）。

### `DailyAssignment`
- `slotStart` / `slotEnd` — `"HH:00"`形式の文字列（自動アサインは1時間スロット単位）。
- `source`: `"AUTO"`（自動アサイン由来）/ `"MANUAL"`（手動編集）。
- `@@index([workDate, slotStart])`, `@@index([employeeId, workDate])` — 日別ビュー表示・
  自動アサインの一括削除/作成で使われるインデックス。

### `RotationPattern.patternDefinition`（Json）
固定フォーマット:
```json
{ "cycleDays": 6, "pattern": ["WORK","WORK","WORK","WORK","OFF","OFF"] }
```
正社員・契約社員向けにはシフト種別も含めた拡張形式:
```json
{ "cycleDays": 12, "pattern": [...], "shiftCodes": ["早番","早番","早番","早番",null,null,"遅番",...] }
```
`shiftCodes`が無い場合は従来通り出勤/公休のみを設定する（後方互換）。

### `ShiftClaimRequest`（2026-08〜「希望勤務(KIBO)」対応）
- `desiredStartTime`/`desiredEndTime` — 希望する勤務時間帯（"08:00"/"17:00"など）。
  両方nullの場合は従来通り「その日ならいつでも」という人員不足日への申請として扱われる
  （既存の挙動を壊さないための設計。詳細は`src/lib/kiboWindow.ts`, `docs/BUSINESS_RULES.md`）。
- 登録可能な期間は「翌月分のみ・当月10日まで」（`isWithinKiboWindow()`で検証）。ただし
  この制限は`desiredStartTime`/`desiredEndTime`を指定した場合のみ適用される。

### `EmployeePriority`（2026-08追加）
- `RolePriority`（役割単位の優先順位。自動アサインで使用）とは完全に独立した別モデル。
- 用途は「シフト調整」機能で人員不足時に、同じ`Employee.role`グループの中で誰を優先的に
  候補として並べるか（`src/lib/shiftWindowStaffing.ts`の`findEligibleEmployeesForWindow`）のみ。
  担当業務(A/B/全/WHILL等)の決定には一切使わない。



- `CartPosition.code` — 自動アサインエンジン（`autoAssign.ts`）や各種UIがこの文字列を
  直接参照しているため、既存コードの意味を変えるリネームは既存データ・ロジックを壊す。
- `MonthRoster` / `DailyAssignment` の `@@unique` / `@@index` 制約 — 自動アサインの
  「削除→一括作成」処理やUIの一意性前提に依存している。
- `EmployeeRole` / `RosterStatus` / `ConstraintType` などのenum値 — 表示ラベルや
  ロジック分岐（`STATUS_LABEL`、パート判定など）にハードコードされている箇所が複数ある。

## ⚠️ 未確認・要確認事項
- `IncidentType`（LATE/DELAY/EARLY_LEAVE/OVERTIME/BF_FEE_CUT/OWN_CAR_COMMUTE/ONE_WAY_TAXI）を
  実際にどの画面から記録するかは、今回確認した範囲のAPI/画面一覧には見当たらなかった
  （schema上は定義済みだが、利用箇所は未確認）。
