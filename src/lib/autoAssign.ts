import { DailyRosterItem } from "@/lib/dailyRoster";
import { hourOf } from "@/lib/timeSlots";
import {
  DutyCode,
  WhillCode,
  DUTY_PRIORITY,
  DUTY_WINDOW,
  WHILL_EVENTS,
  PRODUCTIVE_CODES,
} from "@/lib/dutySchedule";

// ============================================================================
// 自動スケジュール作成ロジック v3（2026-08 業務ルール改訂 + 夜勤/優先順位バグ修正版）
// ============================================================================
//
// 【優先順位】① 業務A ② 業務B ③ 業務全 ④ WHILL関連業務 ⑤ 休憩 ⑥ 事務時間（OFFICE）
// 「最優先」＝「必ず人数不足をゼロにする」ではない。人数・時間・休憩条件により不足が
// 発生するのは許容する。重要なのは他業務よりA/B/全を優先して埋める「順序」であること。
// WHILLや事務時間を確保するためにA/B/全の配置を削減しない。
//
// 業務A/B/全・WHILLの稼働時間・必要人数の定義は src/lib/dutySchedule.ts に集約している
// （日別スケジュール画面の「配置状況」表示もこのファイルの定義を共有する。二重管理によって
// 表示と実際の割当てがズレるのを防ぐため）。
//
// v3での変更点（前バージョンからの追加修正）:
// 1. 優先順位（RolePriority）を実際に反映するようにした（従来はロール優先度を無視していた）。
// 2. 休憩の配置を「シートの見た目上のインデックス」ではなく「実際のシフト開始時刻からの
//    経過時間」で計算するようにした。これにより、日付をまたぐ夜勤（明け番）で不自然に長い
//    休憩や、当日シートと翌日シートの両方に休憩が二重に入るバグを修正している。

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const MAX_CONSECUTIVE_HOURS_ON_DUTY = 3; // 1〜3時間を目安に持ち場を交代する
const BREAK_PREFERRED_START_OFFSET = 3; // 経過3〜5時間を優先的な休憩帯とする
const BREAK_PREFERRED_END_OFFSET = 5;

const DEBUG = process.env.AUTO_ASSIGN_DEBUG === "1";
function log(...args: unknown[]) {
  if (DEBUG) console.log("[autoAssign]", ...args);
}

export type AutoAssignEntry = {
  employeeId: string;
  slotIndex: number; // 0-23（4:00始まりの営業日インデックス）
  code: DutyCode | WhillCode | "BREAK" | "OFFICE";
};

export type DemandByCode = Partial<Record<DutyCode, number>>;
// ロールごとの優先順位（小さいほど優先）。src/lib/autoBackfill.ts と同じ考え方・同じ
// フォールバック値（未設定=999＝最低優先）を採用し、プロジェクト内で一貫させている。
export type PriorityByRole = Partial<Record<string, number>>;

export { PRODUCTIVE_CODES };

function priorityOf(priorityByRole: PriorityByRole, role: string): number {
  return priorityByRole[role] ?? 999;
}

export function buildAutoAssignPlan(
  rosterItems: DailyRosterItem[],
  demandByCode: DemandByCode = {},
  priorityByRole: PriorityByRole = {}
): AutoAssignEntry[] {
  const people = rosterItems.filter((p) => p.activeEndIdx - p.activeStartIdx > 0);
  // 安定した基準順（同条件のときの並びをブレさせないため）。表示順ではなくID順でよい。
  const stableOrder = [...people].sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const results: AutoAssignEntry[] = [];
  const capFor = (duty: DutyCode) => demandByCode[duty] ?? 1;

  // 各人・各スロットで何をしているか（二重登録防止）
  const assignedSlot = new Map<string, Map<number, string>>();
  const getAssigned = (employeeId: string, slot: number) => assignedSlot.get(employeeId)?.get(slot);
  const setAssigned = (employeeId: string, slot: number, code: string) => {
    if (!assignedSlot.has(employeeId)) assignedSlot.set(employeeId, new Map());
    assignedSlot.get(employeeId)!.set(slot, code);
  };

  const isActive = (p: DailyRosterItem, slot: number) => slot >= p.activeStartIdx && slot < p.activeEndIdx;

  // 今日すでに割り当てた業務時間数（同一優先度内での負荷平準化に使う）
  const dutyHoursSoFar = new Map<string, number>();
  const bump = (employeeId: string) => dutyHoursSoFar.set(employeeId, (dutyHoursSoFar.get(employeeId) ?? 0) + 1);
  const hoursOf = (employeeId: string) => dutyHoursSoFar.get(employeeId) ?? 0;

  // 直前スロットでその業務を担当していた人＆連続担当時間（1〜3時間ローテーション判定用）
  const lastDutyEmployee: Record<DutyCode, (string | null)[]> = { A: [], B: [], 全: [] };
  const lastDutyStreak: Record<DutyCode, number[]> = { A: [], B: [], 全: [] };

  // 候補の並び順: ①ロール優先順位（RolePriorityの設定を必ず反映） ②今日の割当時間が少ない人を優先
  // （同じ優先順位のスタッフ間で負荷を均等化するための二次基準）
  function sortCandidates(list: DailyRosterItem[]): DailyRosterItem[] {
    return [...list].sort((a, b) => {
      const pa = priorityOf(priorityByRole, a.employeeRole);
      const pb = priorityOf(priorityByRole, b.employeeRole);
      if (pa !== pb) return pa - pb;
      return hoursOf(a.employeeId) - hoursOf(b.employeeId);
    });
  }

  // ------------------------------------------------------------------
  // ステップ1〜2: 時間帯ごとに 業務A → 業務B → 業務全 → WHILL の順で埋める
  // ------------------------------------------------------------------
  for (let slot = 0; slot < 24; slot++) {
    for (const duty of DUTY_PRIORITY) {
      const window = DUTY_WINDOW[duty];
      if (slot < window.startIdx || slot >= window.endIdx) continue; // 稼働時間外

      const cap = capFor(duty);
      const continuing = lastDutyEmployee[duty];
      const streak = lastDutyStreak[duty];
      const chosenThisSlot: string[] = [];

      for (let unit = 0; unit < cap; unit++) {
        const prevEmployee = continuing[unit] ?? null;
        const prevStreak = streak[unit] ?? 0;
        let candidate: DailyRosterItem | null = null;

        // 1) 直前スロットの担当者を継続できるか（1〜3時間ローテーションの範囲内なら継続）
        if (prevEmployee && prevStreak < MAX_CONSECUTIVE_HOURS_ON_DUTY && !chosenThisSlot.includes(prevEmployee)) {
          const p = stableOrder.find((x) => x.employeeId === prevEmployee) ?? null;
          if (p && isActive(p, slot) && !getAssigned(p.employeeId, slot)) candidate = p;
        }

        // 2) 継続できなければ、ロール優先順位→負荷の少なさの順で新しい担当者を選ぶ
        if (!candidate) {
          const available = stableOrder.filter(
            (p) => isActive(p, slot) && !getAssigned(p.employeeId, slot) && !chosenThisSlot.includes(p.employeeId)
          );
          candidate = sortCandidates(available)[0] ?? null;
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

    // WHILL関連業務（この時間帯に該当するイベントのみ）。A/B/全に使われていない人・
    // パート以外の人から、ロール優先順位→負荷の少なさの順で選ぶ。
    for (const event of WHILL_EVENTS) {
      if (event.slotIndex !== slot) continue;

      const candidates = stableOrder.filter(
        (p) => isActive(p, slot) && !getAssigned(p.employeeId, slot) && p.employeeRole !== "PARTTIME"
      );
      const picked = sortCandidates(candidates).slice(0, event.requiredCount);
      if (picked.length < event.requiredCount) {
        log(`slot=${slot} whill=${event.code}: 必要人数${event.requiredCount}に対し${picked.length}名しか確保できません`);
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
  // 「実際のシフト開始時刻からの経過時間」を基準に休憩位置を決める（シート上の見た目の
  // インデックスでは判断しない）。これにより:
  //   - 勤務開始直後・終了直前に休憩が入ることを防ぐ
  //   - 日付をまたぐ夜勤で、シート境界（4:00）のせいで不自然な休憩時間になることを防ぐ
  //   - 夜勤が「当日シート（前半）」と「翌日シート（後半＝引き継ぎ）」に分かれて表示される
  //     際に、休憩が二重に（両方のシートに）入ってしまうことを防ぐ
  //
  // 前提となる仕組み: buildDailyRosterView() は日をまたぐ夜勤を2つのシート（前日分・翌日分）
  // に分けて返す。この関数は「その日のシート」単位で呼ばれるため、1回の呼び出しでは
  // シフトの前半または後半どちらか一方の断片(fragment)しか見えない。そこで、
  // 「このシートに来る前に、シフト開始から何時間経過していたか」(hoursElapsedBeforeSheet)
  // を求め、断片内の各スロットを「シフト開始からの経過時間」に変換してから休憩位置を判定する。
  // 休憩が該当する経過時間帯が今回の断片に含まれていなければ何もしない
  // （＝もう片方の断片側の実行で正しく配置される。結果として二重休憩にならない）。
  const breakOccupiedSlots = new Set<number>();

  for (const person of stableOrder) {
    if (!person.resolvedStart || !person.resolvedEnd) continue;
    const startHour = hourOf(person.resolvedStart);
    const endHour = hourOf(person.resolvedEnd);
    const totalShiftHours = ((endHour - startHour + 24) % 24) || 24; // 実際のシフト全体の長さ（両断片合算）
    if (totalShiftHours < 4) continue; // 4時間未満は休憩不要

    // このシート（断片）に入る前に、シフト開始から何時間経過していたか
    const hoursElapsedBeforeSheet = person.isCarryOver ? (4 - startHour + 24) % 24 : 0;
    const elapsedAtSlotStart = (slot: number) => hoursElapsedBeforeSheet + (slot - person.activeStartIdx);

    const isNightShift = person.shiftTypeCode === "明番" || startHour === 22;
    const breakHoursNeeded = isNightShift ? 2 : 1;

    // 「勤務開始直後」「勤務終了直前」を除いた許容範囲（シフト全体基準）
    const acceptableStart = 1;
    const acceptableEnd = totalShiftHours - 1; // 排他境界
    if (acceptableEnd <= acceptableStart) {
      log(`employee=${person.employeeId}: シフトが短く休憩の許容範囲が確保できません`);
      continue;
    }

    // 空いている（他業務が入っていない）このシート内のスロットのうち、
    // 「シフト全体で見て許容範囲内」に該当するものだけを対象にする
    const candidateSlots: number[] = [];
    for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
      if (getAssigned(person.employeeId, s)) continue;
      const elapsed = elapsedAtSlotStart(s);
      if (elapsed < acceptableStart || elapsed >= acceptableEnd) continue;
      candidateSlots.push(s);
    }
    if (candidateSlots.length === 0) continue; // このシートの断片には該当する時間帯がない（正常。他方の断片で処理される）

    const preferred = candidateSlots.filter((s) => {
      const elapsed = elapsedAtSlotStart(s);
      return elapsed >= BREAK_PREFERRED_START_OFFSET && elapsed < BREAK_PREFERRED_END_OFFSET;
    });
    const pool = preferred.length > 0 ? preferred : candidateSlots;

    if (breakHoursNeeded === 2) {
      // 2時間連続で空いているペアを、経過3〜5時間帯に近く・他スタッフの休憩と
      // 重ならない位置から優先して探す
      const poolSet = new Set(candidateSlots); // 連続判定は許容範囲全体で行う（優先帯はソートで反映）
      const pairStarts = pool.filter((s) => poolSet.has(s + 1) && !getAssigned(person.employeeId, s + 1));
      pairStarts.sort((a, b) => {
        const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
        const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
        if (aOverlap !== bOverlap) return aOverlap - bOverlap;
        return (
          Math.abs(elapsedAtSlotStart(a) - BREAK_PREFERRED_START_OFFSET) -
          Math.abs(elapsedAtSlotStart(b) - BREAK_PREFERRED_START_OFFSET)
        );
      });
      const chosenStart = pairStarts[0];
      if (chosenStart === undefined) {
        // 2時間連続が確保できない場合は1時間のみで妥協する（旧仕様を踏襲）
        const single = pool[0];
        setAssigned(person.employeeId, single, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: single, code: "BREAK" });
        breakOccupiedSlots.add(single);
        log(`employee=${person.employeeId}: 明け番の2時間連続休憩を確保できず1時間のみ配置`);
      } else {
        setAssigned(person.employeeId, chosenStart, "BREAK");
        setAssigned(person.employeeId, chosenStart + 1, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: chosenStart, code: "BREAK" });
        results.push({ employeeId: person.employeeId, slotIndex: chosenStart + 1, code: "BREAK" });
        breakOccupiedSlots.add(chosenStart);
      }
      continue;
    }

    // 通常勤務: 1時間休憩。他スタッフの休憩と重ならない位置を優先
    const sorted = [...pool].sort((a, b) => {
      const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
      const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
      if (aOverlap !== bOverlap) return aOverlap - bOverlap;
      return a - b;
    });
    const chosen = sorted[0];
    if (chosen !== undefined) {
      setAssigned(person.employeeId, chosen, "BREAK");
      results.push({ employeeId: person.employeeId, slotIndex: chosen, code: "BREAK" });
      breakOccupiedSlots.add(chosen);
    }
  }

  // ------------------------------------------------------------------
  // ステップ4: 事務時間（OFFICE）— 業務A/B/全・WHILL・休憩をすべて配置した後、
  // 余った時間帯だけをパート以外のスタッフに割り当てる。最初から確保しない。
  // ------------------------------------------------------------------
  for (const person of stableOrder) {
    if (person.employeeRole === "PARTTIME") continue; // パートは事務時間NG
    for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
      if (getAssigned(person.employeeId, s)) continue;
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
