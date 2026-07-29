import { DailyRosterItem } from "@/lib/dailyRoster";

// 4種類のローテーション（休憩を含む）— ユーザー提示のサンプル表と同じロジック
// 各時間で「その時間に勤務中の人」だけを対象に、持ち回りで4種を割り当てる。
// 人数が4人より多い場合は、時間ごとに順番をずらしながら「あぶれた人」を作る（余った人は空欄）。
// 人数が4人より少ない場合は、埋まらない業務が出る（車A/車B/全が埋まらない場合のみ「不足」とみなす）。
export const ROTATION_CODES = ["A", "B", "全", "BREAK"] as const;
export const PRODUCTIVE_CODES = ["A", "B", "全"] as const; // 不足判定の対象（休憩は対象外）

export type AutoAssignSlotResult = {
  slotIndex: number; // 0-23（4:00始まり）
  assignments: { employeeId: string; code: (typeof ROTATION_CODES)[number] }[];
  shortagePositions: (typeof PRODUCTIVE_CODES)[number][]; // その時間に埋まらなかった業務
};

export function buildAutoAssignPlan(rosterItems: DailyRosterItem[]): AutoAssignSlotResult[] {
  // INCは業務ローテーションの対象外（監督役割のため）
  const pool = rosterItems.filter((r) => r.employeeRole !== "INC");
  // 安定した並び順（employeeIdでソート）を基準にし、時間ごとにこの並びを回転させる
  const stableOrder = [...pool].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const results: AutoAssignSlotResult[] = [];

  for (let slot = 0; slot < 24; slot++) {
    const activeAtSlot = stableOrder.filter((r) => slot >= r.activeStartIdx && slot < r.activeEndIdx);
    if (activeAtSlot.length === 0) {
      results.push({ slotIndex: slot, assignments: [], shortagePositions: [] });
      continue;
    }

    // 時間ごとに並びをローテーションさせる（余る人・休憩の人が毎時間変わるようにする）
    const rotated = activeAtSlot.map((_, i) => activeAtSlot[(i + slot) % activeAtSlot.length]);

    const assignments: AutoAssignSlotResult["assignments"] = [];
    const filled = new Set<string>();
    rotated.slice(0, 4).forEach((emp, i) => {
      const code = ROTATION_CODES[i];
      assignments.push({ employeeId: emp.employeeId, code });
      filled.add(code);
    });
    // 4人を超える分は「あぶれ」（今回は割り当てなし＝空欄のまま）

    const shortagePositions = PRODUCTIVE_CODES.filter((c) => !filled.has(c));

    results.push({ slotIndex: slot, assignments, shortagePositions });
  }

  return results;
}
