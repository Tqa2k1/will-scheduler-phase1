# WORKFLOWS.md — 業務フロー

## 全体の流れ
1. **ASK①**（`/shortage`、INC）: 現在の勤務表から不足（日・シフト・人数）を確定（`ShiftAdjustmentConfirmation`）し、役割が「バイト」の従業員へ1回目メール「勤務希望登録のお願い」（`ShortageMailLog`で二重送信防止）。
2. **勤務希望の登録**（`/shift-requests/register`、従業員）: 不足の日・シフトを選び、シフト内の勤務時間を登録（`ShiftClaimRequest`、状態 PENDING）。
3. **応募者の確認・勤務者の確定**（`/shift-requests`、INC）: 応募を確認し、承認／却下、または一括確定（`bulkConfirm.ts`。実労働時間が少ない人→優先順位→ID順）。承認で勤務表（`MonthRoster`）へ反映。
4. **ASK②**（`/roster/shift-adjustment`、INC）: 残りの不足に候補者を招待・調整し、月の確定メールを配信。全員成功で月が「確定」。

ASK①/②は画面を統一（`AskSteps`の段階表示・同じ見出し/ボタン/確認ダイアログ）したが、処理順序・API呼び出しは変更していない。

## 勤務希望のステータス
INVITED（ASK②の招待）/ PENDING（申請中）/ APPROVED（確定）/ REJECTED / CANCEL_REQUESTED（確定後の取消申請）/ CANCELED / NOT_SELECTED。

## キャンセル
| 状態 | 従業員の操作 | 結果 |
|---|---|---|
| PENDING（確定前） | `POST /api/shift-claims/:id/cancel` | **即時** CANCELED。INC承認不要。`decidedAt`/`decidedBy`に日時・操作者、監査ログ `CLAIM_CANCEL`。`cancelRequestedAt`が空＝「確定前の自己キャンセル」。 |
| APPROVED（確定後） | 同上 | CANCEL_REQUESTED（`cancelRequestedAt`記録）。**INCが承認するまで確定のまま**（人数不変）。承認(`PATCH /api/shift-claims/:id` decision=CANCEL_APPROVED)で CANCELED・勤務表から削除。却下で APPROVED に戻る。 |

確定前の自己キャンセル（`isSelfCanceledBeforeConfirm`）は、INC一覧・希望人数・不足判定・ASK②候補（招待中一覧）から除外される。DBには履歴として残る。

## 登録の停止／再開（月別）
- INC/ADMINが `/shift-requests` の「登録を停止する／再開する」で切替（`POST /api/shift-claims/registration-hold` `{month, stopped}`）。`ClaimRegistrationHold`に月ごとに保存。
- 停止中: `POST /api/shift-claims` が 403（`registrationStopped:true`）。従業員画面は「○月の勤務希望登録は現在停止中です」を表示し、登録・変更フォームを隠す。既存データは残り、未確定のキャンセルは可能。
- 月は日付文字列（JST）の `YYYY-MM` で判定。操作は監査ログ（CLAIM_REGISTRATION_STOP / RESUME）。
