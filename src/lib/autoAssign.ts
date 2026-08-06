import { DailyRosterItem } from "@/lib/dailyRoster";
import { operatingIndex } from "@/lib/timeSlots";

// ============================================================================
// 自動スケジュール作成ロジック v2（2026-08 業務ルール改訂版）
// ============================================================================
//
// 【優先順位】（2026-08 改訂で確定した最優先ルール）
//   ① 業務A
//   ② 業務B
//   ③ 業務全
//   ④ WHILL関連業務（準備・片づけ）
//   ⑤ 休憩
//   ⑥ 事務時間（OFFICE）
//
// 「最優先」は「必ず人数不足をゼロにする」という意味ではない。スタッフ人数・勤務時間・
// 休憩条件などにより不足が発生する場合はそれを許容する。重要なのは、他の業務より
// A/B/全を優先して埋めるという「順序」である。WHILL業務や事務時間を確保するために
// A/B/全の配置を削減することはしない。
//
// 【本ファイルの設計方針】
// 旧バージョンは「1人ずつ、休憩→prep/cleanup(bookend)→A/B/全(1回ずつ)」という
// 人単位の逐次処理だったが、新ルールは「時間帯ごとに複数人が同じ業務を担当し、
// 1〜3時間程度で担当を交代する」という時間帯単位のローテーションが必要になったため、
// スロット（時間帯）を主軸にしたグローバルな逐次割当てに書き直した。
//
// 処理順序（優先順位をそのままアルゴリズムの実行順序に反映している）:
//   1. 業務A/B/全 を時間帯ごとに埋める（1〜3時間で担当交代、必要人数の上限を尊重）
//   2. WHILL関連業務（固定時刻・固定人数のイベント）を、A/B/全に使われていない人から補充
//   3. 休憩を、A/B/全・WHILLの配置を壊さない範囲でスタッフごとに時間をずらして配置
//   4. 事務時間（OFFICE）を、上記すべてを配置したあとに余った時間だけ埋める（パート除く）
//
// 【既存機能との互換性】
// - buildAutoAssignPlan / computeShortageCount のシグネチャ、AutoAssignEntry / DemandByCode
//   の形は維持し、呼び出し側（API route）を大きく変更しなくて済むようにしている。
// - 既存の業務コード（"A" "B" "全" "BREAK" "WHILL_DEPARTURE_PREP" "WHILL_DEPARTURE_CLEANUP"）は
//   そのまま使用。新規に必要な "WHILL_ARRIVAL_PREP" "WHILL_ARRIVAL_CLEANUP" "OFFICE" は
//   prisma/seed.ts に既に CartPosition として定義済みのコードをそのまま使う（DB schema変更なし）。
// - Prisma schema・API構造（POST /api/schedule/auto-assign の入出力）は変更していない。

export type DutyCode = "A" | "B" | "全";
export type WhillCode =
  | "WHILL_ARRIVAL_PREP"
  | "WHILL_ARRIVAL_CLEANUP"
  | "WHILL_DEPARTURE_PREP"
  | "WHILL_DEPARTURE_CLEANUP";
export type SpecialCode = "BREAK" | "OFFICE";

export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23（4:00始まり。src/lib/timeSlots.ts の営業日インデックスに準拠）
  code: DutyCode | WhillCode | SpecialCode;
};

const DUTY_PRIORITY: DutyCode[] = ["A", "B", "全"];
export const PRODUCTIVE_CODES = DUTY_PRIORITY;

// 業務ごとの時間帯あたり必要人数（業務要件から算出。未設定の場合は1名を上限とする）
export type DemandByCode = Partial<Record<DutyCode, number>>;

// ログ出力（"なぜその配置になったか"を後から確認できるように）。
// 通常は静かにしておき、環境変数 AUTO_ASSIGN_DEBUG=1 のときだけ詳細ログを出す。
const DEBUG = process.env.AUTO_ASSIGN_DEBUG === "1";
function log(...args: unknown[]) {
  if (DEBUG) console.log("[autoAssign]", ...args);
}

// ---------------------------------------------------------------------------
// 業務A/B/全の稼働時間（営業日インデックス。endIdxは排他境界）
// ---------------------------------------------------------------------------
// 例: A は 5:00〜26:00（=翌2:00）稼働 → 21時間
function windowFromClock(startHour: number, endHourExclusive: number): { startIdx: number; endIdx: number } {
  const startIdx = operatingIndex(startHour % 24);
  const duration = endHourExclusive - startHour; // 26 - 5 = 21 のように24時間超もそのまま使える
  return { startIdx, endIdx: startIdx + duration };
}

const DUTY_WINDOW: Record<DutyCode, { startIdx: number; endIdx: number }> = {
  A: windowFromClock(5, 26), // 05:00-26:00
  B: windowFromClock(6, 24), // 06:00-24:00
  全: windowFromClock(5, 25), // 05:00-25:00
};

// ---------------------------------------------------------------------------
// WHILL関連業務（固定時刻・固定必要人数のイベント。要件通り時間・人数を固定値として定義）
// ---------------------------------------------------------------------------
const WHILL_EVENTS: { code: WhillCode; slotIndex: number; requiredCount: number }[] = [
  { code: "WHILL_ARRIVAL_CLEANUP", slotIndex: operatingIndex(10), requiredCount: 1 }, // 10:00-11:00
  { code: "WHILL_DEPARTURE_PREP", slotIndex: operatingIndex(11), requiredCount: 2 }, // 11:00-12:00
  { code: "WHILL_DEPARTURE_CLEANUP", slotIndex: operatingIndex(18), requiredCount: 2 }, // 18:00-19:00
  { code: "WHILL_ARRIVAL_PREP", slotIndex: operatingIndex(19), requiredCount: 1 }, // 19:00-20:00
];

// 1〜3時間を目安に担当を交代する（同一人物が同じ業務を4時間連続で担当するのは禁止）
const MAX_CONSECUTIVE_HOURS_ON_DUTY = 3;

// 通常勤務の休憩は「勤務開始から3〜5時間程度」を目安にする
const BREAK_WINDOW_START_OFFSET = 3;
const BREAK_WINDOW_END_OFFSET = 5;

export function buildAutoAssignPlan(
  rosterItems: DailyRosterItem[],
  demandByCode: DemandByCode = {}
): AutoAssignEntry[] {
  const people = rosterItems.filter((p) => p.activeEndIdx - p.activeStartIdx > 0);
  // 安定した順序（同条件の場合の優先度をブレさせないため）。パートも含め、社員IDの昇順を基本にする。
  const stableOrder = [...people].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const results: AutoAssignEntry[] = [];
  const capFor = (duty: DutyCode) => demandByCode[duty] ?? 1;

  // 各人・各スロットで何をしているか（二重登録防止）
  const assignedSlot = new Map<string, Map<number, string>>(); // employeeId -> slotIndex -> code
  const getAssigned = (employeeId: string, slot: number) => assignedSlot.get(employeeId)?.get(slot);
  const setAssigned = (employeeId: string, slot: number, code: string) => {
    if (!assignedSlot.has(employeeId)) assignedSlot.set(employeeId, new Map());
    assignedSlot.get(employeeId)!.set(slot, code);
  };

  const isActive = (p: DailyRosterItem, slot: number) => slot >= p.activeStartIdx && slot < p.activeEndIdx;

  // 公平にローテーションするための「今日すでに割り当てた業務時間数」カウンタ
  const dutyHoursSoFar = new Map<string, number>();
  const bump = (employeeId: string) => dutyHoursSoFar.set(employeeId, (dutyHoursSoFar.get(employeeId) ?? 0) + 1);
  const hoursOf = (employeeId: string) => dutyHoursSoFar.get(employeeId) ?? 0;

  // 直前スロットでその業務を担当していた人＆連続時間数（1〜3時間ローテーションの判定用）
  const lastDutyEmployee: Record<DutyCode, (string | null)[]> = { A: [], B: [], 全: [] };
  const lastDutyStreak: Record<DutyCode, number[]> = { A: [], B: [], 全: [] };

  // ------------------------------------------------------------------
  // ステップ1〜2: 時間帯ごとに 業務A → 業務B → 業務全 → WHILL の順で埋める
  // ------------------------------------------------------------------
  for (let slot = 0; slot < 24; slot++) {
    for (const duty of DUTY_PRIORITY) {
      const window = DUTY_WINDOW[duty];
      if (slot < window.startIdx || slot >= window.endIdx) continue; // この業務の稼働時間外

      const cap = capFor(duty);
      const continuing = lastDutyEmployee[duty];
      const streak = lastDutyStreak[duty];

      const chosenThisSlot: string[] = [];

      for (let unit = 0; unit < cap; unit++) {
        // 1) まず「直前スロットの担当者を継続」できるか確認する（1〜3時間ローテーションの範囲内なら継続）
        const prevEmployee = continuing[unit] ?? null;
        const prevStreak = streak[unit] ?? 0;
        let candidate: DailyRosterItem | null = null;

        if (
          prevEmployee &&
          prevStreak < MAX_CONSECUTIVE_HOURS_ON_DUTY &&
          !chosenThisSlot.includes(prevEmployee)
        ) {
          const p = stableOrder.find((x) => x.employeeId === prevEmployee) ?? null;
          if (p && isActive(p, slot) && !getAssigned(p.employeeId, slot)) {
            candidate = p;
          }
        }

        // 2) 継続できなければ、稼働中かつ未割当の人の中から「今日の業務時間が最も少ない人」を選ぶ
        //    （負荷を均等化しつつ、自動的に1〜3時間での交代を発生させる）
        if (!candidate) {
          const available = stableOrder.filter(
            (p) => isActive(p, slot) && !getAssigned(p.employeeId, slot) && !chosenThisSlot.includes(p.employeeId)
          );
          available.sort((a, b) => hoursOf(a.employeeId) - hoursOf(b.employeeId));
          candidate = available[0] ?? null;
        }

        if (!candidate) {
          log(`slot=${slot} duty=${duty} unit=${unit}: 配置できる人員がいません（人数不足として許容）`);
          continuing[unit] = null;
          streak[unit] = 0;
          continue;
        }

        setAssigned(candidate.employeeId, slot, duty);
        results.push({ employeeId: candidate.employeeId, slotIndex: slot, code: duty });
        bump(candidate.employeeId);
        chosenThisSlot.push(candidate.employeeId);

        streak[unit] = candidate.employeeId === prevEmployee ? prevStreak + 1 : 1;
        continuing[unit] = candidate.employeeId;
      }
    }

    // WHILL関連業務（この時間帯に該当するイベントのみ）
    // A/B/全に既に使われている人は対象外（優先順位上、業務A/B/全を削らないため）。
    // パートスタッフはWHILL業務に配置禁止。
    for (const event of WHILL_EVENTS) {
      if (event.slotIndex !== slot) continue;

      const candidates = stableOrder.filter(
        (p) =>
          isActive(p, slot) &&
          !getAssigned(p.employeeId, slot) &&
          p.employeeRole !== "PARTTIME"
      );
      candidates.sort((a, b) => hoursOf(a.employeeId) - hoursOf(b.employeeId));

      const picked = candidates.slice(0, event.requiredCount);
      if (picked.length < event.requiredCount) {
        log(
          `slot=${slot} whill=${event.code}: 必要人数 ${event.requiredCount} に対して ${picked.length} 名しか確保できません`
        );
      }
      for (const p of picked) {
        setAssigned(p.employeeId, slot, event.code);
        results.push({ employeeId: p.employeeId, slotIndex: slot, code: event.code });
        bump(p.employeeId);
      }
    }
  }

  // ------------------------------------------------------------------
  // ステップ3: 休憩
  // ------------------------------------------------------------------
  // - 休憩を設定する場合でも業務A/B/全の運営を優先する＝既にA/B/全やWHILLで埋まっている
  //   スロットには休憩を入れない（空いているスロットのみを対象にする）。
  // - 全員を同時に休憩へ入れない（breakOccupiedSlotsで時間をずらす）。
  // - 明け番（前日22:00開始の夜勤引き継ぎ）は2時間連続休憩。ただし2時間目は他スタッフの
  //   休憩と重複してよい（もともとの制約ルールを踏襲）。
  // - 通常勤務は勤務開始から3〜5時間程度を目安に1時間休憩を配置する。
  const breakOccupiedSlots = new Set<number>();

  for (const person of stableOrder) {
    const start = person.activeStartIdx;
    const end = person.activeEndIdx;
    const total = end - start;
    if (total < 4) continue; // 4時間未満は休憩不要（既存ルールを踏襲）

    const isNightShift = person.isCarryOver || person.resolvedStart === "22:00";
    const breakHoursNeeded = isNightShift ? 2 : 1;

    // 候補スロット: 空いている（他業務が入っていない）スロットのみ
    const freeSlots: number[] = [];
    for (let s = start; s < end; s++) {
      if (!getAssigned(person.employeeId, s)) freeSlots.push(s);
    }
    if (freeSlots.length === 0) {
      log(`employee=${person.employeeId}: 休憩を入れる空きスロットがありません（業務優先のため許容）`);
      continue;
    }

    if (isNightShift) {
      // 2時間連続の空きスロットを、他スタッフの休憩とできるだけ重ならない位置から探す
      const freeSet = new Set(freeSlots);
      const pairCandidates: number[] = [];
      for (const s of freeSlots) {
        if (freeSet.has(s + 1)) pairCandidates.push(s);
      }
      // 他の休憩と重ならない開始スロットを優先。無ければ許容（2時間目は重複可という既存ルールに準拠）
      pairCandidates.sort((a, b) => {
        const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
        const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
        if (aOverlap !== bOverlap) return aOverlap - bOverlap;
        // 中間に近いスロットを優先
        const center = start + total / 2;
        return Math.abs(a - center) - Math.abs(b - center);
      });
      const chosenStart = pairCandidates[0];
      if (chosenStart === undefined) {
        log(`employee=${person.employeeId}: 明け番の2時間連続休憩を確保できません（1時間のみ許容）`);
        const single = freeSlots[0];
        setAssigned(person.employeeId, single, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: single, code: "BREAK" });
        breakOccupiedSlots.add(single);
      } else {
        setAssigned(person.employeeId, chosenStart, "BREAK");
        setAssigned(person.employeeId, chosenStart + 1, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: chosenStart, code: "BREAK" });
        results.push({ employeeId: person.employeeId, slotIndex: chosenStart + 1, code: "BREAK" });
        breakOccupiedSlots.add(chosenStart); // 1時間目のみ「他スタッフと重複NG」対象にする
      }
      continue;
    }

    // 通常勤務: 開始から3〜5時間を目安に、他スタッフの休憩と重ならないスロットを優先して選ぶ
    const preferredWindow = freeSlots.filter(
      (s) => s >= start + BREAK_WINDOW_START_OFFSET && s <= start + BREAK_WINDOW_END_OFFSET
    );
    const pool = preferredWindow.length > 0 ? preferredWindow : freeSlots;
    const sorted = [...pool].sort((a, b) => {
      const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
      const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
      if (aOverlap !== bOverlap) return aOverlap - bOverlap;
      return a - b;
    });
    const chosen = sorted[0];
    for (let i = 0; i < breakHoursNeeded && chosen !== undefined; i++) {
      const slot = chosen + i;
      if (slot >= end || getAssigned(person.employeeId, slot)) break;
      setAssigned(person.employeeId, slot, "BREAK");
      results.push({ employeeId: person.employeeId, slotIndex: slot, code: "BREAK" });
      breakOccupiedSlots.add(slot);
    }
  }

  // ------------------------------------------------------------------
  // ステップ4: 事務時間（OFFICE）— 業務A/B/全・WHILL・休憩をすべて配置した後、
  // 余った時間帯だけをパート以外のスタッフに割り当てる。最初から確保しない。
  // ------------------------------------------------------------------
  for (const person of stableOrder) {
    if (person.employeeRole === "PARTTIME") continue; // パートは事務時間NG
    for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
      if (getAssigned(person.employeeId, s)) continue; // 何かしら既に入っているスロットはスキップ
      setAssigned(person.employeeId, s, "OFFICE");
      results.push({ employeeId: person.employeeId, slotIndex: s, code: "OFFICE" });
    }
  }

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
