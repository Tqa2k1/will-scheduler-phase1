import { DailyRosterItem } from "@/lib/dailyRoster";

// 自動スケジュール作成ロジック（利用者指定の制約ルールに準拠）
//
// 【制約ルール】
// ① 全スタッフの休憩時間は重ならないようにする。休憩を勤務開始直後・終了直前に配置することは禁止。
// ② 4時間以上勤務した場合、1時間休憩を配置する。
// ③ 22時勤務開始（夜勤）の場合、4時間勤務ごとに2時間休憩を配置する。ただし1時間は他スタッフと重複可。
// ④ 「A」「B」「全」は2時間単位のブロックで配置する（1時間だけの配置は禁止）。
//    かつ、時間帯ごとの必要人数（業務要件のrequiredCount）を超えて配置してはいけない。
// ⑤ 全スタッフに対して「A」「B」「全」をそれぞれ1日1回ずつ配置する（④の人数上限が優先。
//    上限に達していて配置できない場合は⑥により空白のままにする）。
// ⑥ 出勤スタッフだけで必要人数が埋まる場合、余った時間帯は空白のままにする。
// ⑦ 「準備」「片付け」は同じスタッフ（各自のシフト開始・終了）に配置し、常に同一人物が両方を担当する。
//
// ※ 前日22時開始の夜勤は当日シートと翌日シート（明番引継）の2枚に分かれて表示される関係上、
//   ③のルールは「そのシートで見えている区間」単位で近似的に適用する。

export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23（4:00始まり）
  code: "A" | "B" | "全" | "BREAK" | "WHILL_PREP" | "WHILL_CLEANUP";
};

const DUTY_CODES = ["A", "B", "全"] as const;
export const PRODUCTIVE_CODES = ["A", "B", "全"] as const;

// 業務ごとの時間帯あたり必要人数（業務要件から算出。未設定の場合は1名を上限とする）
export type DemandByCode = Partial<Record<(typeof DUTY_CODES)[number], number>>;

export function buildAutoAssignPlan(
  rosterItems: DailyRosterItem[],
  demandByCode: DemandByCode = {}
): AutoAssignEntry[] {
  const stableOrder = [...rosterItems].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  const results: AutoAssignEntry[] = [];
  const breakOccupiedSlots = new Set<number>();

  // ④ 業務×時間帯ごとの現在の配置人数（必要人数の上限チェック用）
  const dutyCountBySlot: Record<string, Map<number, number>> = { A: new Map(), B: new Map(), 全: new Map() };
  const capFor = (code: (typeof DUTY_CODES)[number]) => demandByCode[code] ?? 1;

  stableOrder.forEach((person, personIndex) => {
    const start = person.activeStartIdx;
    const end = person.activeEndIdx;
    const total = end - start;
    if (total <= 0) return;

    const isNightShift = person.isCarryOver || person.resolvedStart === "22:00";

    const canReserveBookends = total >= 4;
    const prepSlot = canReserveBookends ? start : null;
    const cleanupSlot = canReserveBookends ? end - 1 : null;

    const breakHoursNeeded = total >= 4 ? (isNightShift ? 2 : 1) : 0;

    const middleStart = canReserveBookends ? start + 1 : start;
    const middleEnd = canReserveBookends ? end - 1 : end;
    const candidateSlots: number[] = [];
    for (let s = middleStart; s < middleEnd; s++) candidateSlots.push(s);
    const center = start + total / 2;
    candidateSlots.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));

    const chosenBreaks: number[] = [];
    for (let i = 0; i < breakHoursNeeded; i++) {
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

    const usedSlots = new Set<number>([
      ...(prepSlot !== null ? [prepSlot] : []),
      ...(cleanupSlot !== null ? [cleanupSlot] : []),
      ...chosenBreaks,
    ]);
    const remainingSlots: number[] = [];
    for (let s = start; s < end; s++) if (!usedSlots.has(s)) remainingSlots.push(s);

    const rotatedDuties = DUTY_CODES.map((_, i) => DUTY_CODES[(i + personIndex) % DUTY_CODES.length]);

    for (const duty of rotatedDuties) {
      const cap = capFor(duty);
      const countMap = dutyCountBySlot[duty];
      let placedAt: number | null = null;

      for (let i = 0; i + 1 < remainingSlots.length; i++) {
        const s1 = remainingSlots[i];
        const s2 = remainingSlots[i + 1];
        if (s2 !== s1 + 1) continue; // ④ 連続2時間でなければ不可
        const count1 = countMap.get(s1) ?? 0;
        const count2 = countMap.get(s2) ?? 0;
        if (count1 >= cap || count2 >= cap) continue; // ④ 必要人数の上限を超えない
        placedAt = i;
        break;
      }

      if (placedAt === null) continue; // ⑥ 配置できなければ空白のままにする

      const s1 = remainingSlots[placedAt];
      const s2 = remainingSlots[placedAt + 1];
      results.push({ employeeId: person.employeeId, slotIndex: s1, code: duty });
      results.push({ employeeId: person.employeeId, slotIndex: s2, code: duty });
      countMap.set(s1, (countMap.get(s1) ?? 0) + 1);
      countMap.set(s2, (countMap.get(s2) ?? 0) + 1);
      remainingSlots.splice(placedAt, 2);
    }

    if (prepSlot !== null) results.push({ employeeId: person.employeeId, slotIndex: prepSlot, code: "WHILL_PREP" });
    if (cleanupSlot !== null) results.push({ employeeId: person.employeeId, slotIndex: cleanupSlot, code: "WHILL_CLEANUP" });
    for (const b of chosenBreaks) results.push({ employeeId: person.employeeId, slotIndex: b, code: "BREAK" });
  });

  return results;
}

export function computeShortageCount(entries: AutoAssignEntry[], activeSlotIndexes: Set<number>): number {
  const coveredByslot = new Map<number, Set<string>>();
  for (const e of entries) {
    if (!(PRODUCTIVE_CODES as readonly string[]).includes(e.code)) continue;
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
