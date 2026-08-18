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
// 自動スケジュール作成ロジック v4（休憩・夜勤・持ち場交代の精度改善版）
// ============================================================================
//
// v4は「A/B/全を埋めること」自体はv3で概ね出来ている前提で、以下の品質改善に焦点を当てる:
//   - 休憩の確実性（8時間以上勤務者は必ず休憩を取得する。不足が出ても休憩を優先する）
//   - 休憩のタイミング精度（経過4時間を最優先、3〜5時間を許容範囲とする）
//   - 夜勤（明け番）を「1つの連続勤務」として正しく扱う（休憩が3時間以上にならないようにする）
//   - 持ち場交代を2〜3時間を目安に行う（2時間を優先、3時間は次善）。ただし人員状況上
//     交代できない場合は同じ人が継続してよい（運用の安定を交代より優先する）
//   - 交代の際は可能な限り「別の業務」へ回す（A→B→全→A のように）
//   - デバッグログの充実（誰が・なぜ選ばれた/選ばれなかったか、休憩・夜勤の計算根拠）
//
// 【フェーズ構成】（このファイルの処理順序そのものが優先順位を表す）
//   Phase 1: 従業員の稼働タイムライン把握（rosterItemsをそのまま使用）
//   Phase 2: 業務Aを全時間帯にわたって配置
//   Phase 3: 業務Bを全時間帯にわたって配置
//   Phase 4: 業務全を全時間帯にわたって配置
//   Phase 5: 持ち場交代の最適化（Phase2〜4の配置ロジックに組み込み済み。交代要否の判定を
//            "1〜3時間ローテーション"から"2時間を優先・3時間まで許容"に変更）
//   Phase 6: WHILL関連業務を配置（A/B/全に使われていない人・パート以外から）
//   Phase 7: 休憩を配置（パートスタッフは対象外。8時間以上勤務者は必ず休憩を取得させる。
//            空きが無ければ業務A/B/全の枠を1つ明け渡してでも休憩を優先する）
//   Phase 8: 事務時間（OFFICE）を、残った時間だけ配置（パートスタッフ対象外）
//   Phase 9: 不足人数の計算（computeShortageCount。呼び出し側のAPIで実行）
//
// 【最優先の原則】従業員の休憩・労働条件 > 安定運用 > 持ち場交代 > 不足ゼロ。
// 休憩のために不足が出ても休憩を優先し、不足はごまかさず表示する。

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const ROTATE_PREFERRED_HOURS = 2; // 持ち場交代の第一目安（2時間）
const ROTATE_MAX_HOURS = 3; // 持ち場交代の許容上限目安（3時間）。これを超えても交代できなければ継続を許容する

const BREAK_ANCHOR_OFFSET = 4; // 休憩の最優先タイミング（経過4時間後）
const BREAK_ACCEPTABLE_MIN_OFFSET = 3; // 通常の許容範囲（経過3〜5時間）
const BREAK_ACCEPTABLE_MAX_OFFSET = 5;
const MANDATORY_BREAK_MIN_SHIFT_HOURS = 4; // これ未満の勤務時間には休憩を付けない
const MANDATORY_BREAK_STRICT_HOURS = 8; // これ以上勤務する人は必ず休憩を確保する（不足が出ても優先）

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
// ロールごとの優先順位（小さいほど優先）。未設定ロールはsrc/lib/autoBackfill.tsと同じ
// フォールバック値（999＝最低優先）を使う。
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
  // ---------------------------------------------------------------------
  // Phase 1: 従業員の稼働タイムライン把握
  // ---------------------------------------------------------------------
  const people = rosterItems.filter((p) => p.activeEndIdx - p.activeStartIdx > 0);
  const stableOrder = [...people].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  log(`Phase1: 対象従業員 ${stableOrder.length}名`);

  const results: AutoAssignEntry[] = [];
  const capFor = (duty: DutyCode) => demandByCode[duty] ?? 1;

  // 各人・各スロットで何をしているか（二重登録防止）。値はAutoAssignEntry.codeと同じ文字列。
  const assignedSlot = new Map<string, Map<number, string>>();
  const getAssigned = (employeeId: string, slot: number) => assignedSlot.get(employeeId)?.get(slot);
  const setAssigned = (employeeId: string, slot: number, code: string) => {
    if (!assignedSlot.has(employeeId)) assignedSlot.set(employeeId, new Map());
    assignedSlot.get(employeeId)!.set(slot, code);
  };
  const clearAssigned = (employeeId: string, slot: number) => {
    assignedSlot.get(employeeId)?.delete(slot);
  };
  // resultsから該当エントリを取り除く（休憩確保のためにA/B/全の割当てを取り消す時に使う）
  const removeResultEntry = (employeeId: string, slot: number) => {
    const idx = results.findIndex((r) => r.employeeId === employeeId && r.slotIndex === slot);
    if (idx >= 0) results.splice(idx, 1);
  };

  const isActive = (p: DailyRosterItem, slot: number) => slot >= p.activeStartIdx && slot < p.activeEndIdx;

  // 今日すでに割り当てた業務時間数（同一優先度内での負荷平準化に使う）
  const dutyHoursSoFar = new Map<string, number>();
  const bump = (employeeId: string) => dutyHoursSoFar.set(employeeId, (dutyHoursSoFar.get(employeeId) ?? 0) + 1);
  const hoursOf = (employeeId: string) => dutyHoursSoFar.get(employeeId) ?? 0;

  // 各従業員が直前に担当していた業務（A/B/全のいずれか）。交代時に「別の業務」を
  // 優先するために使う（要件: A→B→全→A のように、同じ業務への逆戻りを避ける）。
  const lastAssignedDuty = new Map<string, DutyCode>();

  // 候補の並び順: ①ロール優先順位 ②直前と別の業務かどうか（交代の方向性） ③今日の割当時間の少なさ
  function sortCandidates(list: DailyRosterItem[], forDuty: DutyCode): DailyRosterItem[] {
    return [...list].sort((a, b) => {
      const pa = priorityOf(priorityByRole, a.employeeRole);
      const pb = priorityOf(priorityByRole, b.employeeRole);
      if (pa !== pb) return pa - pb;
      const aSame = lastAssignedDuty.get(a.employeeId) === forDuty ? 1 : 0;
      const bSame = lastAssignedDuty.get(b.employeeId) === forDuty ? 1 : 0;
      if (aSame !== bSame) return aSame - bSame; // 直前と同じ業務の人は後回し
      return hoursOf(a.employeeId) - hoursOf(b.employeeId);
    });
  }

  // ---------------------------------------------------------------------
  // Phase 2〜4: 業務A → 業務B → 業務全 の順に、それぞれ全時間帯を配置する
  // （Phase 5「持ち場交代の最適化」はここに組み込まれている）
  // ---------------------------------------------------------------------
  for (const duty of DUTY_PRIORITY) {
    const window = DUTY_WINDOW[duty];
    const cap = capFor(duty);
    // このduty専用の「直前スロットの担当者・連続担当時間」トラッカー（unit=同時配置人数の枠）
    const continuing: (string | null)[] = [];
    const streak: number[] = [];

    log(`Phase ${duty === "A" ? 2 : duty === "B" ? 3 : 4}: 業務${duty} 配置開始 (稼働 slot${window.startIdx}-${window.endIdx - 1}, 必要${cap}名/時)`);

    for (let slot = window.startIdx; slot < window.endIdx; slot++) {
      const chosenThisSlot: string[] = [];

      for (let unit = 0; unit < cap; unit++) {
        const prevEmployee = continuing[unit] ?? null;
        const prevStreak = streak[unit] ?? 0;
        let candidate: DailyRosterItem | null = null;
        let reason = "";

        const prevPerson = prevEmployee ? stableOrder.find((x) => x.employeeId === prevEmployee) ?? null : null;
        const prevStillAvailable =
          !!prevPerson && isActive(prevPerson, slot) && !getAssigned(prevPerson.employeeId, slot) && !chosenThisSlot.includes(prevPerson.employeeId);

        if (prevPerson && prevStillAvailable && prevStreak < ROTATE_PREFERRED_HOURS) {
          // 2時間未満の継続はそのまま維持する（毎時間交代するのは不自然なため）
          candidate = prevPerson;
          reason = `継続(${prevStreak}時間目、目安の2時間未満)`;
        } else {
          // 2時間（もしくは強制上限3時間）に達した、または直前担当者が動けない ⇒ 交代を試みる
          const alternatives = sortCandidates(
            stableOrder.filter(
              (p) =>
                p.employeeId !== prevEmployee &&
                isActive(p, slot) &&
                !getAssigned(p.employeeId, slot) &&
                !chosenThisSlot.includes(p.employeeId)
            ),
            duty
          );
          if (alternatives.length > 0) {
            candidate = alternatives[0];
            reason =
              prevStreak >= ROTATE_MAX_HOURS
                ? `交代(${prevStreak}時間で上限到達のため強制交代)`
                : `交代(${prevStreak}時間経過、目安の2時間に達したため他の候補へ)`;
          } else if (prevStillAvailable) {
            // 交代したいが他に候補がいない ⇒ 運用の安定を優先し、同じ人を継続させる
            candidate = prevPerson;
            reason = `継続(${prevStreak}時間経過も交代候補がいないため継続。運用安定を優先)`;
          } else {
            // 直前の担当者も動けず、他の候補もいない
            candidate = null;
          }
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
        lastAssignedDuty.set(candidate.employeeId, duty);
        chosenThisSlot.push(candidate.employeeId);
        log(`slot=${slot} duty=${duty} unit=${unit}: ${candidate.employeeId} を選択 — ${reason}`);

        streak[unit] = candidate.employeeId === prevEmployee ? prevStreak + 1 : 1;
        continuing[unit] = candidate.employeeId;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Phase 6: WHILL関連業務（固定時刻・固定必要人数の4イベント）
  // A/B/全に使われていない人・パート以外の人から、ロール優先順位→負荷の少なさの順で選ぶ。
  // ---------------------------------------------------------------------
  for (const event of WHILL_EVENTS) {
    const slot = event.slotIndex;
    const candidates = stableOrder.filter(
      (p) => isActive(p, slot) && !getAssigned(p.employeeId, slot) && p.employeeRole !== "PARTTIME"
    );
    const picked = sortCandidates(candidates, "A" /* WHILLでは業務方向の優先は使わないが引数として渡す */).slice(
      0,
      event.requiredCount
    );
    if (picked.length < event.requiredCount) {
      log(`Phase6: slot=${slot} whill=${event.code}(${event.label}): 必要人数${event.requiredCount}に対し${picked.length}名しか確保できません`);
    }
    for (const p of picked) {
      setAssigned(p.employeeId, slot, event.code);
      results.push({ employeeId: p.employeeId, slotIndex: slot, code: event.code });
      bump(p.employeeId);
      log(`Phase6: slot=${slot} whill=${event.code}: ${p.employeeId} を選択`);
    }
  }

  // ---------------------------------------------------------------------
  // Phase 7: 休憩（パートスタッフは対象外）
  // ---------------------------------------------------------------------
  // 「実際のシフト開始時刻からの経過時間」を基準に休憩位置を決める（シート上の見た目の
  // インデックスでは判断しない）。日をまたぐ夜勤（明け番）は buildDailyRosterView() により
  // 当日側/翌日側（引き継ぎ）の2つの断片に分かれて渡されてくるため、断片に入る前に
  // 既に経過していた時間 (hoursElapsedBeforeSheet) を加味して「シフト全体で見た経過時間」を
  // 求める。これにより夜勤を1つの連続勤務として正しく扱い、3時間以上の休憩や二重休憩を防ぐ。
  //
  // 優先度: 経過4時間が最優先、経過3〜5時間が許容範囲。8時間以上勤務する人は、
  // 空きスロットが無い場合でも業務A/B/全の枠を1つ休憩に明け渡してでも必ず休憩を確保する
  // （このとき不足数は増えるが、休憩を優先し不足はそのまま表示する）。
  const breakOccupiedSlots = new Set<number>();

  for (const person of stableOrder) {
    if (person.employeeRole === "PARTTIME") {
      log(`Phase7: employee=${person.employeeId} はパートスタッフのため休憩を付与しない`);
      continue;
    }
    if (!person.resolvedStart || !person.resolvedEnd) continue;

    const startHour = hourOf(person.resolvedStart);
    const endHour = hourOf(person.resolvedEnd);
    const totalShiftHours = ((endHour - startHour + 24) % 24) || 24; // シフト全体（両断片合算）の実労働時間
    if (totalShiftHours < MANDATORY_BREAK_MIN_SHIFT_HOURS) continue; // 4時間未満は休憩不要

    const hoursElapsedBeforeSheet = person.isCarryOver ? (4 - startHour + 24) % 24 : 0;
    const elapsedAtSlotStart = (slot: number) => hoursElapsedBeforeSheet + (slot - person.activeStartIdx);

    // 【重要】日をまたぐ夜勤は、buildDailyRosterView()により当日側/翌日側(引き継ぎ)の
    // 2つの断片に分かれ、それぞれが「別々の buildAutoAssignPlan() 呼び出し」（＝別々のAPI
    // リクエスト、別々の日の自動アサイン実行）として処理される。そのため、この関数の中だけでは
    // 「もう一方の断片で今日すでに休憩を入れたかどうか」を知ることができない。
    // 何も対策しないと、両方の断片が独立に「休憩が必要」と判断し、休憩が二重に（合計3〜4時間）
    // 入ってしまう（実際にテストで確認された不具合）。
    //
    // 対策: シフト全体の中間時点（elapsed = totalShiftHours / 2）が、どちらの断片に属するかを
    // 決定的に計算し、その断片だけが休憩配置の「責任」を持つ。もう一方の断片は（自由スロットへの
    // ベストエフォート配置すら）行わない。中間時点は断片ごとの経過時間レンジ
    // [hoursElapsedBeforeSheet, hoursElapsedBeforeSheet+fragmentLength) に対して必ずどちらか
    // 片方にのみ属するため、責任の重複が起きない。日をまたがない通常シフトは断片が1つしかないため
    // 常にtrueになり、動作は変わらない。
    const fragmentLength = person.activeEndIdx - person.activeStartIdx;
    const midElapsed = totalShiftHours / 2;
    const ownsBreakResponsibility =
      hoursElapsedBeforeSheet <= midElapsed && midElapsed < hoursElapsedBeforeSheet + fragmentLength;
    if (!ownsBreakResponsibility) {
      log(
        `Phase7: employee=${person.employeeId}: このシートの断片は休憩配置の責任を持たない` +
          `（シフト中間点(経過${midElapsed}h)がもう一方の断片に属するため。二重配置防止）`
      );
      continue;
    }

    const isNightShift = person.shiftTypeCode === "明番" || startHour === 22;
    const breakHoursNeeded = isNightShift ? 2 : 1;
    // 休憩が必要な人（4時間以上勤務）は全員、空きスロットが無ければ業務A/B/全を1つ明け渡してでも
    // 休憩を確保する（＝不足ゼロより休憩を優先する、という原則を一律に適用する）。
    // 8時間以上の勤務者は特にこの原則が重要（元々「休憩が付与されない」不具合が報告された対象）だが、
    // 4〜8時間の勤務者だけ休憩を後回しにしてよい理由はないため、しきい値を分けていない。
    const isMandatory = true;

    log(
      `Phase7: employee=${person.employeeId} shift=${person.resolvedStart}-${person.resolvedEnd} ` +
        `totalShiftHours=${totalShiftHours} isCarryOver=${person.isCarryOver} hoursElapsedBeforeSheet=${hoursElapsedBeforeSheet} ` +
        `isNightShift=${isNightShift} breakHoursNeeded=${breakHoursNeeded} ` +
        `${totalShiftHours >= MANDATORY_BREAK_STRICT_HOURS ? "(8時間以上勤務: 休憩確保を特に厳守)" : ""}`
    );

    // 「勤務開始直後」「勤務終了直前」を除いた許容範囲（シフト全体基準、経過時間）
    const acceptableStart = 1;
    const acceptableEnd = totalShiftHours - 1; // 排他境界
    if (acceptableEnd <= acceptableStart) {
      log(`Phase7: employee=${person.employeeId}: シフトが短く休憩の許容範囲が確保できません`);
      continue;
    }

    // このシート（断片）内で、シフト全体で見て許容範囲内にあるスロットのみを対象にする
    const inRangeSlots: number[] = [];
    for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
      const elapsed = elapsedAtSlotStart(s);
      if (elapsed < acceptableStart || elapsed >= acceptableEnd) continue;
      inRangeSlots.push(s);
    }
    if (inRangeSlots.length === 0) {
      log(`Phase7: employee=${person.employeeId}: このシートの断片には休憩の対象時間帯が含まれません（他方の断片で処理される想定）`);
      continue;
    }

    const distanceFromAnchor = (s: number) => Math.abs(elapsedAtSlotStart(s) - BREAK_ANCHOR_OFFSET);
    const isPreferred = (s: number) => {
      const e = elapsedAtSlotStart(s);
      return e >= BREAK_ACCEPTABLE_MIN_OFFSET && e < BREAK_ACCEPTABLE_MAX_OFFSET;
    };

    // free = 何も割り当てられていない。bumpable = A/B/全が入っていて、休憩確保のために
    // 明け渡すことができる（WHILL/OFFICE/BREAKは明け渡さない）。
    const isFree = (s: number) => !getAssigned(person.employeeId, s);
    const isBumpable = (s: number) => {
      const code = getAssigned(person.employeeId, s);
      return code === "A" || code === "B" || code === "全";
    };

    function placeBreakAt(slots: number[], forcedBump: boolean) {
      for (const s of slots) {
        if (isBumpable(s) && !isFree(s)) {
          const bumpedCode = getAssigned(person.employeeId, s);
          clearAssigned(person.employeeId, s);
          removeResultEntry(person.employeeId, s);
          log(
            `Phase7: employee=${person.employeeId} slot=${s}: 休憩を確保するため業務${bumpedCode}の割当てを取り消しました（不足が発生する可能性があります）`
          );
        }
        setAssigned(person.employeeId, s, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: s, code: "BREAK" });
        breakOccupiedSlots.add(s);
      }
      log(
        `Phase7: employee=${person.employeeId}: 休憩を ${slots.map((s) => `slot${s}(経過${elapsedAtSlotStart(s)}h)`).join(",")} に配置` +
          (forcedBump ? "（強制確保）" : "")
      );
    }

    function rankSingle(pool: number[]): number[] {
      return [...pool].sort((a, b) => {
        const aPref = isPreferred(a) ? 0 : 1;
        const bPref = isPreferred(b) ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
        const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
        if (aOverlap !== bOverlap) return aOverlap - bOverlap;
        return distanceFromAnchor(a) - distanceFromAnchor(b);
      });
    }

    if (breakHoursNeeded === 2) {
      // 2時間連続の空きスロットを優先範囲(経過3〜5h)に近い位置・他スタッフの休憩と
      // 重ならない位置から探す。空きが無ければbumpable(A/B/全)も候補に含める。
      const findPair = (allowBump: boolean): number | undefined => {
        const eligible = (s: number) => isFree(s) || (allowBump && isBumpable(s));
        const starts = inRangeSlots.filter((s) => eligible(s) && inRangeSlots.includes(s + 1) && eligible(s + 1));
        const ranked = starts.sort((a, b) => {
          // どちらも空きの組み合わせを最優先、片方bumpがその次
          const aFreeCount = (isFree(a) ? 1 : 0) + (isFree(a + 1) ? 1 : 0);
          const bFreeCount = (isFree(b) ? 1 : 0) + (isFree(b + 1) ? 1 : 0);
          if (aFreeCount !== bFreeCount) return bFreeCount - aFreeCount;
          const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
          const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
          if (aOverlap !== bOverlap) return aOverlap - bOverlap;
          return distanceFromAnchor(a) - distanceFromAnchor(b);
        });
        return ranked[0];
      };

      let start = findPair(false);
      let usedBump = false;
      if (start === undefined && isMandatory) {
        start = findPair(true);
        usedBump = start !== undefined;
      }

      if (start !== undefined) {
        placeBreakAt([start, start + 1], usedBump);
      } else {
        // 2時間連続が確保できない ⇒ 1時間のみで妥協する（3時間以上には絶対に延長しない）
        const singlePool = rankSingle(inRangeSlots.filter((s) => isFree(s)));
        let single = singlePool[0];
        let singleBump = false;
        if (single === undefined && isMandatory) {
          single = rankSingle(inRangeSlots.filter((s) => isBumpable(s)))[0];
          singleBump = single !== undefined;
        }
        if (single !== undefined) {
          placeBreakAt([single], singleBump);
          log(`Phase7: employee=${person.employeeId}: 明け番の2時間連続休憩を確保できず1時間のみ配置（3時間以上には延長しません）`);
        } else {
          log(`Phase7: employee=${person.employeeId}: 休憩を配置できる時間帯がありません`);
        }
      }
      continue;
    }

    // 通常勤務: 1時間休憩
    let single = rankSingle(inRangeSlots.filter((s) => isFree(s)))[0];
    let usedBump = false;
    if (single === undefined && isMandatory) {
      single = rankSingle(inRangeSlots.filter((s) => isBumpable(s)))[0];
      usedBump = single !== undefined;
    }
    if (single !== undefined) {
      placeBreakAt([single], usedBump);
    } else {
      log(`Phase7: employee=${person.employeeId}: 休憩を配置できる時間帯がありません`);
    }
  }

  // ---------------------------------------------------------------------
  // Phase 8: 事務時間（OFFICE）— 業務A/B/全・WHILL・休憩をすべて配置した後、
  // 余った時間帯だけをパート以外のスタッフに割り当てる。最初から確保しない。
  // ---------------------------------------------------------------------
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

// Phase 9: 不足人数の計算（呼び出し側のAPIから使用）
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
