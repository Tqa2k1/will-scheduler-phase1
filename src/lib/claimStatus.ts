// 勤務希望（ShiftClaimRequest）の状態に関する純粋関数（DBに触れない）。

export type ClaimLike = { status: string; cancelRequestedAt?: Date | string | null };

// INCの確定前に、従業員が自分で即時キャンセルした勤務希望か。
//  - 確定前の取消は status=CANCELED のまま cancelRequestedAt が空（INCの承認を経ていない）
//  - 確定後の取消は「取消申請（cancelRequestedAt が入る）→ INCが承認」で CANCELED になる＝INCの処理履歴なので別扱い
// 即時キャンセル分は、INC側の一覧・応募状況・集計・ASK②の依頼済み表示には出さない（データは削除せず、履歴・操作ログに残す）。
export function isSelfCanceledBeforeConfirm(c: ClaimLike): boolean {
  return c.status === "CANCELED" && !c.cancelRequestedAt;
}

// 「勤務希望人数」に数える状態: 本人が登録済みでINCの確定待ち（PENDING）だけ。
// 招待中(INVITED)は未回答、取消済み・却下・不採用はカウントしない。確定済み(APPROVED / CANCEL_REQUESTED)は「確定人数」側。
export function countsAsRequested(c: ClaimLike): boolean {
  return c.status === "PENDING";
}
