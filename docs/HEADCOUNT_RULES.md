# HEADCOUNT_RULES.md — シフト人数の集計ルール

実装: `src/lib/shiftHeadcount.ts`（純粋関数）、`src/lib/monthlyShiftGap.ts`（不足判定）。テスト: `tests/logic.test.ts`、`tests/claims.test.ts`。

- 主なシフト: 第1シフト 08:00–17:00 / 第2シフト 13:00–22:00（`ShiftType`）。
- 人数は**登録時に選択したシフト（`shiftTypeId`）基準**。勤務時間がシフト全体と違っても（例: 第2シフトで16:00–22:00）そのシフトの1人。**時間帯からシフトを逆算しない**。
- 登録時間は選択シフトの枠内に収まること（`requestInsideSlot`、APIで検証）。
- 同じ従業員・同日・同シフトは重複して数えない（`employeeId_workDate` ユニーク制約＋集計時の重複排除）。
- キャンセル・却下・不採用・招待中は数えない。
- **勤務希望人数**（PENDINGのみ、`countRequestedByShift`）と**勤務確定人数**（勤務表のWORK、`countConfirmedByShift`/`getMonthShiftGaps.current`）を別々に集計・表示。不足は確定人数基準（`summarizeSlot`）。希望が全て確定した場合の不足は `shortageAfterRequests`。
- 表示: 応募者の確認画面「必要/確定/希望（申請中）/不足」、ASK①・ASK②の不足表。

## 既知の差異（仕様との矛盾点）
1. `getMonthShiftGaps` には、`shiftTypeId` が無い旧データに限り開始時刻からシフトを推定するフォールバックが残る（旧データ互換のため維持）。
2. `ShiftTimeBand`（時間帯別必要人数）が設定されたシフトは、時間帯ごとに時間で評価する（`evaluateShiftGap`）。「時間から逆算しない」とは別の仕組みなので、時間帯設定を使う場合は注意。
