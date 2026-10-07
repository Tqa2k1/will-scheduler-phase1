import { DUTY_PRIORITY, requiredCountAtSlot, DutyCode } from "@/lib/dutySchedule";
import { hourOf, operatingIndex } from "@/lib/timeSlots";

// ============================================================================
// 22時勤務（夜勤）のBreak開始時間・バッテリー交換の割当て計画
// ============================================================================
// 22時勤務の3人/4人だけを対象に、次を「人員の組み合わせ全探索」で決める純粋関数。
//   - Break（120分のまま）の開始時間: 1:00 / 2:00 / 3:00 のどれか。同時Breakは最大2人。
//   - バッテリー交換 1回目: 1:00 または 2:00 の範囲内で自動選択（範囲外にはしない）
//   - バッテリー交換 2回目: 4:00 固定（翌日シートの先頭コマ）
//
// 夜勤は「当日シート(22:00〜翌4:00)」と「翌日シート(4:00〜8:00の明番)」の2枚に分かれて
// 表示・保存される。3:00開始のBreakや4:00のバッテリー交換は翌日シート側に現れるため、
// 両シートが同じ計画を再現できるよう、計画は「夜勤メンバー一覧＋必要人数設定」だけの
// 純粋関数にしている（他の日勤者やDBの状態には依存しない）。

export const NIGHT_START_HOUR = 22;
export const NIGHT_BREAK_START_SLOTS = [operatingIndex(1), operatingIndex(2), operatingIndex(3)]; // 21,22,23
export const NIGHT_BATTERY1_SLOTS = [operatingIndex(1), operatingIndex(2)]; // 1:00 / 2:00
export const NIGHT_BATTERY2_SLOT = operatingIndex(4); // 4:00（翌日シートの先頭コマ = 0）
export const MAX_CONCURRENT_NIGHT_BREAKS = 2;

// ご指定の目標開始パターン（Break開始時間の「希望」。同時2人制限を守れない場合は最小限ずらす）
const TARGET_BREAK_STARTS: Record<number, number[]> = {
  4: [operatingIndex(1), operatingIndex(2), operatingIndex(2), operatingIndex(3)],
  3: [operatingIndex(2), operatingIndex(2), operatingIndex(3)],
};

export type NightCrewMember = { employeeId: string; employeeRole: string };

export type NightCrewPlan = {
  breakStartSlot: Map<string, number>; // employeeId -> 21 | 22 | 23
  battery1: { employeeId: string; slot: number } | null; // 当日シート
  battery2: { employeeId: string } | null; // 翌日シートの先頭コマ(4:00)
};

// 22時勤務のシフトかどうか（翌朝5〜12時に終わる22時開始のシフト）。
// 当日シート側(isCarryOver=false)と翌日シート側(isCarryOver=true)で同じ判定になる。
export function isNightCrewItem(p: { resolvedStart: string | null; resolvedEnd: string | null }): boolean {
  if (!p.resolvedStart || !p.resolvedEnd) return false;
  const endHour = hourOf(p.resolvedEnd);
  return hourOf(p.resolvedStart) === NIGHT_START_HOUR && endHour >= 5 && endHour <= 12;
}

export function planNightCrew(
  crew: NightCrewMember[],
  demandByCode: Partial<Record<DutyCode, number>>,
  totalBySlot?: number[]
): NightCrewPlan | null {
  const n = crew.length;
  const target = TARGET_BREAK_STARTS[n];
  if (!target) return null; // 3人・4人以外は対象外（従来ロジックに任せる）

  const members = [...crew].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  const eligibleForBattery = members.map((m) => m.employeeRole !== "PARTTIME"); // WHILLと同じ扱い
  const sortedTarget = [...target].sort((a, b) => a - b);

  const requiredAt = (slot: number) =>
    DUTY_PRIORITY.reduce((sum, d) => sum + requiredCountAtSlot(d, slot, demandByCode, totalBySlot), 0);

  type Cost = number[];
  const better = (a: Cost, b: Cost) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };

  let best: { cost: Cost; starts: number[]; b1: number; t1: number; b2: number } | null = null;
  const combos = Math.pow(NIGHT_BREAK_START_SLOTS.length, n);

  for (let c = 0; c < combos; c++) {
    const starts: number[] = [];
    let x = c;
    for (let i = 0; i < n; i++) {
      starts.push(NIGHT_BREAK_START_SLOTS[x % NIGHT_BREAK_START_SLOTS.length]);
      x = Math.floor(x / NIGHT_BREAK_START_SLOTS.length);
    }
    // Breakは120分 = 開始コマとその次のコマ。4:00(翌日コマ0)は開始23のBreakの2時間目。
    const breaksAt = (slot: number) =>
      slot === 0 ? starts.filter((s) => s === 23).length : starts.filter((s) => s === slot || s + 1 === slot).length;
    if ([21, 22, 23, 0].some((slot) => breaksAt(slot) > MAX_CONCURRENT_NIGHT_BREAKS)) continue;

    const deviation = [...starts].sort((a, b) => a - b).reduce((sum, s, i) => sum + Math.abs(s - sortedTarget[i]), 0);
    const onBreak = (i: number, slot: number) => (slot === 0 ? starts[i] === 23 : slot === starts[i] || slot === starts[i] + 1);

    // バッテリー交換1回目の候補（人×時刻）。誰もできない場合は null（未配置）として評価する。
    const b1Options: { i: number; t: number }[] = [];
    for (const t of NIGHT_BATTERY1_SLOTS)
      for (let i = 0; i < n; i++) if (eligibleForBattery[i] && !onBreak(i, t)) b1Options.push({ i, t });
    if (b1Options.length === 0) b1Options.push({ i: -1, t: -1 });

    const b2Options: number[] = [];
    for (let i = 0; i < n; i++) if (eligibleForBattery[i] && !onBreak(i, 0)) b2Options.push(i);
    if (b2Options.length === 0) b2Options.push(-1);

    for (const b1 of b1Options) {
      // 他業務の不足: 各コマで「必要な業務人数 - (夜勤人数 - Break中 - バッテリー担当)」の不足分
      let shortage = 0;
      let slackAtBattery = 0;
      // rotationRisk: 業務が必要なコマで「必要人数ちょうどしか空いていない」コマの数。
      // 同じ工程は3時間連続を超えられないため、交代要員が1人もいないと不足が出やすい。
      let rotationRisk = 0;
      for (const slot of [21, 22, 23]) {
        const free = n - breaksAt(slot) - (b1.t === slot ? 1 : 0);
        shortage += Math.max(0, requiredAt(slot) - free);
        if (requiredAt(slot) > 0 && free - requiredAt(slot) < 1) rotationRisk++;
        if (b1.t === slot) slackAtBattery = free - requiredAt(slot);
      }
      for (const b2 of b2Options) {
        const missingBattery = (b1.i < 0 ? 1 : 0) + (b2 < 0 ? 1 : 0);
        const sameOne = b1.i >= 0 && b1.i === b2 ? 1 : 0;
        // 優先順位: ①他業務の不足なし ②バッテリー未配置なし ③3時間連続の交代要員がいない状態を避ける
        //          ④Break開始時間の希望との差 ⑤同一人物に2回のバッテリーを避ける
        //          ⑥バッテリー時刻は余裕の大きい方 ⑦決定的な順序
        const cost: Cost = [shortage, missingBattery, rotationRisk, deviation, sameOne, -slackAtBattery, b1.t, b1.i, b2, c];
        if (!best || better(cost, best.cost)) best = { cost, starts, b1: b1.i, t1: b1.t, b2 };
      }
    }
  }

  if (!best) return null;
  const breakStartSlot = new Map<string, number>();
  members.forEach((m, i) => breakStartSlot.set(m.employeeId, best!.starts[i]));
  return {
    breakStartSlot,
    battery1: best.b1 >= 0 ? { employeeId: members[best.b1].employeeId, slot: best.t1 } : null,
    battery2: best.b2 >= 0 ? { employeeId: members[best.b2].employeeId } : null,
  };
}
