import { DailyRosterItem } from "@/lib/dailyRoster";

// 自動スケジュール作成ロジック（利用者指定の制約ルールに準拠）
//
// 【制約ルール】
// ① 全スタッフの休憩時間は重ならないようにする。休憩を勤務開始直後・終了直前に配置することは禁止。
// ② 4時間以上勤務した場合、1時間休憩を配置する。
// ③ 22時勤務開始（夜勤）の場合、4時間勤務ごとに2時間休憩を配置する。ただし1時間は他スタッフと重複可。
// ④ 「A」「B」「全」は2時間単位のブロックで配置する（1時間だけの配置は禁止）。
// ⑤ 全スタッフに対して「A」「B」「全」をそれぞれ1日1回ずつ配置する。
// ⑥ 出勤スタッフだけで足りる場合、余った時間帯は空白のままにする。
// ⑦ 「準備」「片付け」は同じスタッフ（各自のシフト開始・終了）に配置し、常に同一人物が両方を担当する。
//
// ※ 前日22時開始の夜勤は当日シートと翌日シート（明番引継）の2枚に分かれて表示される関係上、
//   ③のルールは「そのシートで見えている区間」単位で近似的に適用する（大元のシフトが22時開始、
//   または明番引継のセグメントである場合に2時間休憩を適用）。連続10時間シフトを1つの塊として
//   厳密に扱う場合は、日またぎのシフトをまたいで保持するデータ構造の拡張が別途必要になる。

export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23（4:00始まり）
  code: "A" | "B" | "全" | "BREAK" | "WHILL_PREP" | "WHILL_CLEANUP";
};

const DUTY_CODES = ["A", "B", "全"] as const;
export const PRODUCTIVE_CODES = ["A", "B", "全"] as const;

export function buildAutoAssignPlan(rosterItems: DailyRosterItem[]): AutoAssignEntry[] {
  // 安定した並び順（役割ローテーションのオフセットに使う）
  const stableOrder = [...rosterItems].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const results: AutoAssignEntry[] = [];
  const breakOccupiedSlots = new Set<number>(); // 他スタッフと重複させたくない休憩スロット

  stableOrder.forEach((person, personIndex) => {
    const start = person.activeStartIdx;
    const end = person.activeEndIdx; // 排他的
    const total = end - start;
    if (total <= 0) return;

    // ③ 夜勤（22時開始 or 明番引継＝前日22時開始の続き）判定
    const isNightShift = person.isCarryOver || person.resolvedStart === "22:00";

    // ⑦ 準備・終了直前の片付けは「勤務開始直後・終了直前」に固定（十分な時間がある場合のみ）
    const canReserveBookends = total >= 4;
    const prepSlot = canReserveBookends ? start : null;
    const cleanupSlot = canReserveBookends ? end - 1 : null;

    // ② ③ 休憩時間数の決定
    const breakHoursNeeded = total >= 4 ? (isNightShift ? 2 : 1) : 0;

    // ① 休憩の配置候補（開始直後・終了直前を除いた中央寄りの時間帯）
    const middleStart = canReserveBookends ? start + 1 : start;
    const middleEnd = canReserveBookends ? end - 1 : end;
    const candidateSlots: number[] = [];
    for (let s = middleStart; s < middleEnd; s++) candidateSlots.push(s);
    const center = start + total / 2;
    candidateSlots.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));

    const chosenBreaks: number[] = [];
    for (let i = 0; i < breakHoursNeeded; i++) {
      // ③ 夜勤の2時間休憩のうち1時間は他スタッフとの重複を許容
      const exemptFromOverlapCheck = isNightShift && i === 1;
      let picked: number | null = null;
      for (const c of candidateSlots) {
        if (chosenBreaks.includes(c)) continue;
        if (!exemptFromOverlapCheck && breakOccupiedSlots.has(c)) continue;
        picked = c;
        break;
      }
      if (picked === null) {
        picked = candidateSlots.find((c) => !chosenBreaks.includes(c)) ?? null;
      }
      if (picked !== null) {
        chosenBreaks.push(picked);
        if (!exemptFromOverlapCheck) breakOccupiedSlots.add(picked);
      }
    }

    // ④ ⑤ 残り時間に A/B/全 を2時間ブロックで1回ずつ配置
    const usedSlots = new Set<number>([
      ...(prepSlot !== null ? [prepSlot] : []),
      ...(cleanupSlot !== null ? [cleanupSlot] : []),
      ...chosenBreaks,
    ]);
    const remainingSlots: number[] = [];
    for (let s = start; s < end; s++) if (!usedSlots.has(s)) remainingSlots.push(s);

    // スタッフごとに開始する業務をずらして、負荷が均等になるようにする
    const rotatedDuties = DUTY_CODES.map((_, i) => DUTY_CODES[(i + personIndex) % DUTY_CODES.length]);

    let cursor = 0;
    for (const duty of rotatedDuties) {
      let placed = false;
      for (let i = cursor; i + 1 < remainingSlots.length; i++) {
        if (remainingSlots[i + 1] === remainingSlots[i] + 1) {
          results.push({ employeeId: person.employeeId, slotIndex: remainingSlots[i], code: duty });
          results.push({ employeeId: person.employeeId, slotIndex: remainingSlots[i] + 1, code: duty });
          cursor = i + 2;
          placed = true;
          break;
        }
      }
      // ⑥ 2時間の空きブロックが確保できない場合はそれ以上配置せず空白のままにする
      if (!placed) break;
    }

    if (prepSlot !== null) results.push({ employeeId: person.employeeId, slotIndex: prepSlot, code: "WHILL_PREP" });
    if (cleanupSlot !== null) results.push({ employeeId: person.employeeId, slotIndex: cleanupSlot, code: "WHILL_CLEANUP" });
    for (const b of chosenBreaks) results.push({ employeeId: person.employeeId, slotIndex: b, code: "BREAK" });
  });

  return results;
}

// その日の配置結果から「A/B/全のいずれかが誰にも割り当てられていない時間帯」を検出する
// （画面側の不足ハイライトと同じロジックをサーバー側でも使えるように用意）
export function computeShortageCount(entries: AutoAssignEntry[], activeSlotIndexes: Set<number>): number {
  const coveredByslot = new Map<number, Set<string>>();
  for (const e of entries) {
    if (!PRODUCTIVE_CODES.includes(e.code as any)) continue;
    if (!coveredByslot.has(e.slotIndex)) coveredByslot.set(e.slotIndex, new Set());
    coveredByslot.get(e.slotIndex)!.add(e.code);
  }
  let shortage = 0;
  for (const slot of activeSlotIndexes) {
    const covered = coveredByslot.get(slot) ?? new Set();
    shortage += PRODUCTIVE_CODES.filter((c) => !covered.has(c)).length;
  }
  return shortage;
}
