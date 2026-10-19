# DATA_FLOW.md — データの流れ

```
ShiftType/ShiftTimeBand(必要人数) + MonthRoster(確定勤務)
   └─ getMonthShiftGaps ─→ 不足(日×シフト)
        ├─ ASK① /api/shortage(preview/confirm) → ShiftAdjustmentConfirmation(スナップショット) → 1回目メール(ShortageMailLog)
        ├─ 従業員 /api/shift-claims/my-month ← スナップショット + ClaimRegistrationHold(停止中か)
        ├─ 従業員 POST /api/shift-claims → ShiftClaimRequest(PENDING)   ※停止中は403
        ├─ 従業員 cancel → 確定前: CANCELED(即時) / 確定後: CANCEL_REQUESTED
        ├─ INC /api/shift-claims?month → buildAdminClaimList(自己キャンセルを除外, 希望人数=countRequestedByShift)
        ├─ INC 承認/一括確定 → MonthRoster(WORK) + markMonthsRevised → 月は「調整中」
        └─ ASK② 配信成功 → MonthRosterConfirmation.status = CONFIRMED
```
エクスポートは `/api/roster`・`/api/schedule` と同じ閲覧範囲・同じロジックで生成（`src/lib/excelStyle.ts` で配色・罫線・印刷設定）。
