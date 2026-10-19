import { getAcceptanceWindow } from "@/lib/shortageNotice";
import { shiftWindow, toMinutes, formatMinutes } from "@/lib/shiftRequirements";

// 勤務希望（応募）の時間が募集枠（シフト）の条件を満たすかの判定。純粋関数（DBに触れない）。
//  - 希望時間が未指定 → シフト全体を勤務できるものとして扱う
//  - シフトに「受け付け条件」がある（8:00〜17:00 / 13:00〜22:00）→ その条件の時間帯を含んでいればOK
//    （例: 13:00〜22:00 の枠は 16:00〜22:00 を勤務できれば条件を満たす）
//  - 上記以外のシフト → シフト全体を含んでいる必要がある

type Slot = { start: string; end: string };
type Req = { start?: string | null; end?: string | null };

// 希望時間を、枠（日跨ぎ含む）と同じ分単位の軸に直す
function requestWindow(slot: Slot, req: { start: string; end: string }) {
  const w = shiftWindow(slot.start, slot.end);
  let s = toMinutes(req.start);
  if (w.end > 1440 && s < w.start) s += 1440;
  let e = toMinutes(req.end);
  while (e <= s) e += 1440;
  return { s, e, w };
}

export function isValidTime(t: string | null | undefined): t is string {
  return !!t && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);
}

// 募集枠の条件を満たすか（満たさない場合は理由つき）
export function requestMeetsSlot(slot: Slot, req: Req): { ok: boolean; reason?: string } {
  if (!req.start && !req.end) return { ok: true };
  if (!isValidTime(req.start) || !isValidTime(req.end)) return { ok: false, reason: "希望時間の形式が正しくありません" };
  const { s, e, w } = requestWindow(slot, { start: req.start, end: req.end });
  const acc = getAcceptanceWindow(slot.start, slot.end);
  const needStart = acc ? toMinutes(acc.from) : w.start;
  const needEnd = acc ? toMinutes(acc.to) : w.end;
  if (s <= needStart && e >= needEnd) return { ok: true };
  return {
    ok: false,
    reason: `希望時間（${req.start}〜${req.end}）が募集枠の条件（${formatMinutes(needStart)}〜${formatMinutes(needEnd)} を勤務できること）を満たしていません`,
  };
}

// 希望時間が枠（シフト）の範囲内か（登録時のサーバー検証用）
export function requestInsideSlot(slot: Slot, req: Req): boolean {
  if (!req.start && !req.end) return true;
  if (!isValidTime(req.start) || !isValidTime(req.end)) return false;
  const { s, e, w } = requestWindow(slot, { start: req.start, end: req.end });
  return e > s && s >= w.start && e <= w.end;
}

// 確定時に月間勤務表へ書く勤務時間: 希望時間と枠の重なり。枠全体と同じなら null（= シフト標準時間を使う）
export function clampToSlot(slot: Slot, req: Req): { start: string; end: string } | null {
  if (!isValidTime(req.start) || !isValidTime(req.end)) return null;
  const { s, e, w } = requestWindow(slot, { start: req.start, end: req.end });
  const cs = Math.max(s, w.start);
  const ce = Math.min(e, w.end);
  if (ce <= cs) return null;
  if (cs === w.start && ce === w.end) return null;
  return { start: formatMinutes(cs), end: formatMinutes(ce) };
}

export function windowMinutes(start: string, end: string): number {
  const w = shiftWindow(start, end);
  return w.end - w.start;
}
