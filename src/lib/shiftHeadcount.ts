import { countsAsRequested, type ClaimLike } from "@/lib/claimStatus";

// ============================================================================
// シフト人数の集計ルール（純粋関数。DBに触れないので単体テストできる）
//
//  - 人数は「登録時に選択したシフト」を基準に数える。勤務時間がシフト全体と一致しなくても、そのシフトの1人。
//    例: 13:00〜22:00 のシフトを選び 16:00〜22:00 で登録 → 13:00〜22:00 のシフトに1人。
//  - 時間帯（開始・終了）からシフトを逆算しない。シフトが未選択（shiftTypeId なし）のものは、ここでは数えない。
//  - 同じ従業員は、同じ日・同じシフトで1回しか数えない。
//  - 取消済み・却下・不採用・招待中（未回答）の勤務希望は「希望人数」に数えない。
//  - 「確定人数」（勤務表に確定した人数）と「希望人数」（申請中でINCの確定待ちの人数）は別々に集計する。
// ============================================================================

export type RequestCountInput = ClaimLike & { employeeId: string; date: string; shiftTypeId: string | null };
export type RosterCountInput = { employeeId: string; date: string; shiftTypeId: string | null; status: string };

export const slotKey = (date: string, shiftTypeId: string) => `${date}|${shiftTypeId}`;

// 勤務希望人数: 申請中（PENDING）の勤務希望を、選択したシフトごとに数える
export function countRequestedByShift(claims: RequestCountInput[]): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const c of claims) {
    if (!countsAsRequested(c) || !c.shiftTypeId) continue;
    const dedupe = `${c.employeeId}|${c.date}|${c.shiftTypeId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const k = slotKey(c.date, c.shiftTypeId);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// 勤務確定人数: 勤務表に出勤（WORK）として確定している人を、そのシフトごとに数える（勤務時間の長さは問わない）
export function countConfirmedByShift(entries: RosterCountInput[]): Map<string, number> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "WORK" || !e.shiftTypeId) continue;
    const dedupe = `${e.employeeId}|${e.date}|${e.shiftTypeId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const k = slotKey(e.date, e.shiftTypeId);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export type SlotHeadcount = {
  required: number; // 必要人数
  confirmed: number; // 勤務確定人数
  requested: number; // 勤務希望人数（申請中）
  shortage: number; // 不足（確定人数基準。希望はまだ確定していないので不足を減らさない）
  shortageAfterRequests: number; // 申請中の希望がすべて確定した場合の不足
};

export function summarizeSlot(required: number, confirmed: number, requested: number): SlotHeadcount {
  const shortage = Math.max(0, required - confirmed);
  return { required, confirmed, requested, shortage, shortageAfterRequests: Math.max(0, shortage - requested) };
}
