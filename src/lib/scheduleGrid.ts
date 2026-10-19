import { minutesSinceOperatingStart, buildDisplaySlots } from "@/lib/timeSlots";
import { isSixtyMinuteCode } from "@/lib/dutySchedule";

// 日別スケジュールの「表示グリッド」（30分刻み・60分業務は2コマ結合）を組み立てる共通ロジック。
// Web画面(src/app/schedule/[date]/page.tsx)・Excel出力・PDF出力が必ず同じ関数を使うことで、
// 画面と出力の内容（誰がどの業務を何時に担当しているか）がズレないようにする。
// DBの構造・自動割当てのロジック（1時間=1インデックス）には一切影響しない。

export type SlotAssignment = { employeeId: string; slotStart: string; slotEnd: string };

// 指定した従業員の割り当ての中から、このスロット開始時刻を含む（＝カバーしている）ものを探す。
export function findCoveringAssignment<T extends SlotAssignment>(
  assignments: T[],
  employeeId: string,
  slotStartTime: string
): T | undefined {
  const target = minutesSinceOperatingStart(slotStartTime);
  return assignments.find((a) => {
    if (a.employeeId !== employeeId) return false;
    const start = minutesSinceOperatingStart(a.slotStart);
    let end = minutesSinceOperatingStart(a.slotEnd);
    if (end <= start) end += 24 * 60; // 日をまたぐ／終了時刻が境界ちょうどの場合
    return start <= target && target < end;
  });
}

// カバーしている割り当ての長さ（分）
export function coveringDurationMinutes(a: SlotAssignment): number {
  const start = minutesSinceOperatingStart(a.slotStart);
  let end = minutesSinceOperatingStart(a.slotEnd);
  if (end <= start) end += 24 * 60;
  return end - start;
}

export type GridCell = {
  startIdx: number; // 30分スロットのインデックス(0-47)
  span: number; // 1=30分 / 2=60分業務（結合）
  active: boolean; // 勤務時間内かどうか
  label: string; // 表示する業務名（業務管理に登録された最新の業務名。codeは使わない）
  color: string | null;
  code?: string | null; // 業務コード（色の既定値の決定用）
};

type PositionLike = { code: string; name: string; color: string | null };
type AssignmentWithPosition = SlotAssignment & { cartPosition: PositionLike };

// 1人分の行のセルを作る。60分業務は前半コマで結合(span=2)し、後半コマは出力しない。
export function buildRowCells(
  item: { employeeId: string; activeStartIdx: number; activeEndIdx: number },
  assignments: AssignmentWithPosition[]
): GridCell[] {
  const slots = buildDisplaySlots();
  const cells: GridCell[] = [];
  slots.forEach((s, idx) => {
    const hourIdx = Math.floor(idx / 2);
    const active = hourIdx >= item.activeStartIdx && hourIdx < item.activeEndIdx;
    if (!active) {
      cells.push({ startIdx: idx, span: 1, active: false, label: "", color: null, code: null });
      return;
    }
    const a = findCoveringAssignment(assignments, item.employeeId, s.start);
    const sixty = !!a && isSixtyMinuteCode(a.cartPosition.code) && coveringDurationMinutes(a) >= 60;
    if (sixty && idx % 2 === 1) return; // 前半コマで結合済み
    cells.push({
      startIdx: idx,
      span: sixty ? 2 : 1,
      active: true,
      label: a?.cartPosition.name ?? "",
      color: a?.cartPosition.color ?? null,
      code: a?.cartPosition.code ?? null,
    });
  });
  return cells;
}

// 勤務時間欄の表示用（Web・Excel・PDF共通）
export function rosterShiftLabel(r: { isCarryOver: boolean; shiftTypeCode: string | null }): string {
  return r.isCarryOver ? "明番（引継）" : r.shiftTypeCode ?? "";
}
