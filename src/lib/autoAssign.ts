import { DailyRosterItem } from "@/lib/dailyRoster";
import { hourOf, operatingIndex } from "@/lib/timeSlots";
import {
  DutyCode,
  WhillCode,
  DUTY_PRIORITY,
  DUTY_WINDOW,
  WHILL_EVENTS,
  PRODUCTIVE_CODES,
  isDutyActiveAtSlot,
} from "@/lib/dutySchedule";

// ============================================================================
// 自動スケジュール作成ロジック v8（休憩ルール全面変更・責任者ロール追加・INC/責任者のOFFICE優先）
// ============================================================================
//
// v8での変更点（2026-09、業務指示に基づく全面置き換え。旧ルールとの混在はしない）:
//   - 【休憩】旧ルール（4時間以上勤務で休憩、パートタイムは対象外）を破棄し、
//     「7時間以上勤務＝休憩1時間、6時間以下＝休憩なし」に統一。パートタイムも
//     7時間以上勤務する場合は他の従業員と同じく休憩1時間を付与する（PARTTIME除外を撤廃）。
//     6時間超7時間未満は運用上発生しない前提。夜勤（明番）の2時間連続休憩ルールは維持。
//   - 【休憩の分散】休憩はまず時間をずらして重ならないよう配置することを優先するが、
//     それによって業務A/B/全の必要人数を満たせなくなる場合は、①まず休憩開始時刻を
//     調整→②それでも避けられなければ複数人の同時休憩を許容→③最終的には休憩の分散より
//     業務A/B/全の維持を優先する、という段階的な考え方に変更（既存の「余裕人数(slack)が
//     多い時間帯を優先する」ランキングで概ね同じ方向性を実現している）。
//   - 【新ロール「責任者」(RESPONSIBLE)】EmployeeRoleに追加。ロール優先順位のデフォルトは
//     INC→責任者→STAFF→CONTRACT→PARTTIME→OJT（prisma/seed.tsのRolePriority初期値）。
//   - 【INC・責任者とOFFICEの関係】INCは元々プロジェクトに存在するロールであり、新設ではない。
//     通常時はINC・責任者をOFFICE（事務時間）に優先的に配置する。ただし「INC・責任者は
//     OFFICE専任」という制限は設けない＝業務A/B/全の必要人数が現有スタッフだけでは
//     満たせない場合は、INC・責任者も他の従業員と同様に業務A/B/全を担当する。
//     実装上は、業務A/B/全（Phase4）・WHILL（Phase3）の候補選定で、INC・責任者を
//     「他に候補がいない場合のみ選ばれる最後尾」の扱いにすることで実現している
//     （`OFFICE_RESERVED_ROLES`）。事務時間（Phase5）は従来通り「残った時間を埋める」
//     だけなので、A/B/全に回さずに済んだINC・責任者は自然とOFFICEで埋まる。
//   - 【人員不足時の考え方（変更なし、再確認）】不足が発生しても、細かいローテーションや
//     無理な配置で無理やり解決しない。現在の勤務者だけでの調整を優先し、それでも
//     業務全体を維持できない場合にのみ、上記の仕組みでINC・責任者がA/B/全に回る
//     （＝INCの追加投入は最終手段という方針は、本ファイルの「渡されたrosterItemsの
//     範囲内でやりくりする」という設計とも一致する。ロースター自体にスタッフを新規に
//     追加する機能は本ファイルの責務外＝呼び出し元でその日にINC・責任者を含めて
//     出勤させるかどうかを決めた上でこの関数に渡す想定）。
//
// --- 以下、v7までの変更点（経緯として維持） ---
//
// v7での変更点（2026-09、Excelサンプルからのロジック逆算に基づく）:
//   - 【最重要】パート/アルバイト（`employeeRole === "PARTTIME"`）は事務時間(OFFICE)の
//     対象外という既存ルールがある一方、v6までは業務A/B/全の必要人数(cap)の選考に
//     他の候補と対等に並んでいたため、cap枠が正社員等で埋まってしまうと、パート/
//     アルバイト本人は勤務時間中なのに何も割り当てられない「空欄」になり得る不具合が
//     あった（サンプルExcelでは、パート/アルバイトの勤務時間は常に実業務(A/B)で
//     隙間なく埋まっており、空欄も事務時間も一切存在しないことを確認した）。
//   - `sortCandidates`で「パート/アルバイトかどうか」をロール優先順位より先に評価し、
//     常に最優先で実業務へ回るようにした。
//   - 上記だけでは同時間帯にパート/アルバイトがcap数を超えて重なるケースを救えないため、
//     Phase 4の各時間帯の処理の最後に、パート/アルバイトのうちその時間帯でまだ何も
//     割り当てられていない人を、稼働中の業務(A/B/全)のいずれかへ必要人数を超えてでも
//     追加配置するセーフティネットを追加した（不足数の計算には影響しない。あくまで
//     パート/アルバイト本人を空欄にしないための措置）。
//   - 正社員等（事務時間に回せる人）の扱い・必要人数不足の許容方針・勤務時間外の人を
//     割り当てない仕組みは変更していない（人員が稼働時間内かどうかは既存の`isActive`
//     判定がスロットごとに行うため、勤務の途中開始・途中終了による人員増減にも
//     従来通り自動的に追従する）。
//
// --- 以下、v6までの変更点（経緯として維持） ---
//
// v6での変更点（2026-09、「勤務時間と業務ローテーションの考え方」の追記に基づく）:
//   - 【最重要】業務A/B/全の持ち場交代について、「2時間に達したら原則として交代を試みる」
//     （v5まで）のを、「2時間に達しても、交代が必要な理由がなければ基本的に継続する」
//     （v6）に変更した。v5では2時間目に達した瞬間、交代候補さえいれば無条件に交代して
//     いたため、「1時間だけA→別の業務→1時間だけB」のような、現場的に不自然な細かい
//     業務変更が発生しうる不具合があった。v6では2〜3時間（=ROTATE_PREFERRED_HOURS〜
//     ROTATE_MAX_HOURS）を「交代してもよいが必須ではない」中間ゾーンとして扱い、
//     実際に交代するのは次のいずれかの場合のみとする:
//       ① 前任者がそのスロットで稼働していない／すでに他の業務（休憩・WHILL等）に
//          割り当て済み（＝BREAK・WHILL・勤務時間などの都合で必然的に交代が必要）
//       ② 3時間の上限に達した（ROTATE_MAX_HOURS。これは従来通りハード制約）
//       ③ 他スタッフとの業務時間の偏りが `REBALANCE_HOUR_GAP` 時間以上ある
//         （＝人員バランス調整の必要がある場合のみ、2時間経過時点で早めに交代する）
//     上記いずれにも該当しない場合は、2時間経過後もそのまま同じ人が同じ持ち場を続ける
//     （＝「可能な限り2〜3時間まとめて担当する」という要件の実装）。
//   - 事務時間（OFFICE、Phase 5）は従来通り「他のどの業務にも割り当てられなかった
//     残り時間」にのみ使われる設計になっており、本来Phase 4内でA/B/全のいずれかに
//     配置できたはずの枠を安易に事務時間へ逃がすことはない。v6での交代抑制により、
//     不要な交代の結果として生じていたOFFICE時間もあわせて減る。
//
// --- 以下、v5までの変更点（経緯として維持） ---
//
// v5での変更点（2026-09、業務指示に基づく全面見直し）:
//   - 【最重要】優先順位を ①休憩 → ②WHILL関連業務 → ③業務A/B/全 → ④事務時間 に変更
//     （v4までは①A/B/全→②WHILL→③休憩→④事務時間だった。休憩は「勤務条件として最初に
//     確保すべきもの」であり、後から業務Aなどの枠を明け渡す形（v4の「強制確保」）ではなく、
//     最初から何も割り当てられていない状態に対して配置するため、v4にあった「bumpして休憩を
//     確保する」処理は不要になった＝ロジックが単純になった）。
//   - 業務A/B/全の配置を「業務ごとに全時間帯を通しで埋める」（v4）から
//     「時間帯（1時間）ごとに A→B→全 の順で埋める」方式に戻した（v3以前の構成に近い）。
//     理由: 業務ごとに丸ごと処理すると、ある業務の処理中は他の業務の割当て履歴が
//     まだ存在しないため、「直前は別の持ち場だった人を優先する」という交代の方向性判定
//     （sortCandidates内のlastAssignedDuty比較）が時系列的に機能していなかった
//     （＝指示にあった「A→B→全→A のようなローテーション」が実質的に機能しない不具合の原因）。
//     時間帯ごとに処理することで、ある時間にAから外れた人がその同じ時間のBや全の候補に
//     自然に回るようになり、意図した持ち場ローテーションが機能する。
//   - 「同じ人物を同じ持ち場に3時間を超えて連続配置すること」を絶対禁止のハード上限にした。
//     v4は交代候補が誰もいない場合に限り4時間・5時間…と際限なく延長を許容していたが、
//     v5では3時間に達したら候補がいなくても必ず交代（＝その枠は他の人か、いなければ空欄
//     ＝不足として表示）とする。「不足を無理に埋めない」という要件を優先するための変更。
//
// 【フェーズ構成】（このファイルの処理順序そのものが優先順位を表す）
//   Phase 1: 従業員の稼働タイムライン把握（rosterItemsをそのまま使用）
//   Phase 2: 休憩を配置（優先度1。v8で全員対象に変更。7時間以上勤務で休憩1時間、6時間以下は休憩なし）
//   Phase 3: WHILL関連業務を配置（優先度2。休憩中の人・パート以外から）
//   Phase 4: 業務A/B/全を時間帯ごとに配置（優先度3。休憩・WHILLに入っていない人から）
//   Phase 5: 事務時間（OFFICE）を、残った時間だけ配置（優先度4。パートスタッフ対象外）
//   Phase 6: 不足人数の計算（computeShortageCount。呼び出し側のAPIで実行）
//
// 【最優先の原則】休憩の確保 > WHILLの必要人数 > 業務A/B/全の必要人数・公平なローテーション
//              > 事務時間。人員不足の場合、他のルール（休憩・3時間上限・パート制限等）を
//              破ってまで穴埋めしない。不足はそのまま「未配置」として表示する。

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
const ROTATE_PREFERRED_HOURS = 2; // 持ち場交代の第一目安（2時間）。これ未満なら継続を優先
const ROTATE_MAX_HOURS = 3; // 持ち場交代の絶対上限（3時間）。これに達したら候補の有無に関わらず必ず交代（＝いなければ空欄）
// v6で追加: ちょうど2時間経過した時点（2時間以上3時間未満）は「交代してもよいが、必須ではない」
// 中間ゾーンとして扱う。このゾーンで実際に交代するのは、他スタッフとの業務時間の偏りが
// この時間数以上ある場合のみ（＝不要な1時間単位の業務変更を避けるための閾値）。
const REBALANCE_HOUR_GAP = 2;

const BREAK_ANCHOR_OFFSET = 4; // 休憩の最優先タイミング（経過4時間後。許容範囲3〜6hの中心）
const BREAK_ACCEPTABLE_MIN_OFFSET = 3; // 経過3〜5時間を優先範囲とする
const BREAK_ACCEPTABLE_MAX_OFFSET = 6;
// v8で変更: 4時間以上→7時間以上に変更（7時間以上=休憩1時間、6時間以下=休憩なし。
// 6時間超7時間未満のシフトは運用上存在しない前提）。パートタイム除外は撤廃し全員に適用する。
const MANDATORY_BREAK_MIN_SHIFT_HOURS = 7;

// v8追加: この実時刻（時）には誰も休憩を開始できないようにする（業務指示により11時・18時を除外）。
// 「営業日インデックス」(0=4:00始まり)に変換したSetで、休憩スロット選定時に除外フィルタとして使う。
const BREAK_FORBIDDEN_HOURS = [11, 18];
const BREAK_FORBIDDEN_SLOTS = new Set(BREAK_FORBIDDEN_HOURS.map((h) => operatingIndex(h)));
// v8追加: 3〜5h（経過）の枠は元々候補が2つしかないため、その片方が禁止時間帯(11時/18時)に
// 一致すると候補が1つに減り、同じ開始時刻の従業員全員の休憩が1点に集中してしまう
// （＝結果的に他の業務の人員配置が非効率になる）。これを避けるため、禁止時間帯の除外で
// 候補が2未満に減った場合に限り、前後に最大1時間ずつ許容範囲を広げて候補数を補う。
const BREAK_WINDOW_MIN_CANDIDATES = 2;
const BREAK_WINDOW_MAX_EXTENSION_HOURS = 1;

// v8で追加: INC・責任者は通常時はOFFICE（事務時間）を優先し、業務A/B/全は「他に候補が
// いない場合の最後尾」として扱う（＝A/B/全の必要人数を現有スタッフで満たせない場合のみ
// 回ってくる）。sortCandidates内でこのロールを最後尾に押し下げるために使う。
const OFFICE_RESERVED_ROLES = new Set(["INC", "RESPONSIBLE"]);

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

  const isActive = (p: DailyRosterItem, slot: number) => slot >= p.activeStartIdx && slot < p.activeEndIdx;

  // 今日すでに割り当てた業務時間数（同一優先度内での負荷平準化に使う）
  const dutyHoursSoFar = new Map<string, number>();
  const bump = (employeeId: string) => dutyHoursSoFar.set(employeeId, (dutyHoursSoFar.get(employeeId) ?? 0) + 1);
  const hoursOf = (employeeId: string) => dutyHoursSoFar.get(employeeId) ?? 0;

  // 各従業員が直前に担当していた業務（A/B/全のいずれか）。交代時に「別の業務」を
  // 優先するために使う（要件: A→B→全→A のように、同じ業務への逆戻りを避ける）。
  // v5では業務A/B/全を時間帯ごとに処理するため、この値が時系列的に正しく機能する。
  const lastAssignedDuty = new Map<string, DutyCode>();

  // 候補の並び順: ①パート/アルバイトかどうか（事務時間に回せないため最優先で実業務へ）
  // ②INC/責任者かどうか（v8で追加。OFFICE優先のため実業務では最後尾＝他に候補がいない
  //   場合のみ選ばれる） ③ロール優先順位 ④直前と別の業務かどうか（交代の方向性）
  // ⑤今日の割当時間の少なさ
  function sortCandidates(list: DailyRosterItem[], forDuty: DutyCode): DailyRosterItem[] {
    return [...list].sort((a, b) => {
      // v7で追加: パート/アルバイトは事務時間(OFFICE)を割り当てられない運用のため、
      // 業務A/B/全の必要人数(cap)が限られている時間帯でも、正社員などOFFICEに回せる人より
      // 先にパート/アルバイトを実業務へ割り当てる（＝勤務時間中に何も割り当てられない
      // 「空欄」を防ぐ）。
      const aPart = a.employeeRole === "PARTTIME" ? 0 : 1;
      const bPart = b.employeeRole === "PARTTIME" ? 0 : 1;
      if (aPart !== bPart) return aPart - bPart;

      // v8で追加: INC・責任者はOFFICE優先のため、業務A/B/全・WHILLの通常候補選定では
      // 最後尾に回す（＝他のロールで必要人数を満たせる場合はINC・責任者を実業務に回さない）。
      // これにより、A/B/全の必要人数が現有スタッフで満たせない場合にのみ、通常の候補と
      // 同様にINC・責任者が選ばれるようになる。
      const aReserved = OFFICE_RESERVED_ROLES.has(a.employeeRole) ? 1 : 0;
      const bReserved = OFFICE_RESERVED_ROLES.has(b.employeeRole) ? 1 : 0;
      if (aReserved !== bReserved) return aReserved - bReserved;

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
  // Phase 2: 休憩（優先度1。v8でパートタイム除外を撤廃し全員が対象）
  // ---------------------------------------------------------------------
  const breakOccupiedSlots = new Set<number>();
  // その時間帯に稼働中の人数（休憩配置時に「人員に余裕がある時間」を判断するために使う。
  // slotごとに何度も使うのでキャッシュする）。
  const activeCountCache = new Map<number, number>();
  const activeCountAtSlot = (s: number): number => {
    if (!activeCountCache.has(s)) {
      activeCountCache.set(s, stableOrder.filter((p) => isActive(p, s)).length);
    }
    return activeCountCache.get(s)!;
  };

  for (const person of stableOrder) {
    // v8: パートタイム除外を撤廃。7時間以上勤務すれば他の従業員と同じく休憩を付与する
    // （MANDATORY_BREAK_MIN_SHIFT_HOURSの判定は下で全員共通に行う）。
    if (!person.resolvedStart || !person.resolvedEnd) continue;

    const startHour = hourOf(person.resolvedStart);
    const endHour = hourOf(person.resolvedEnd);
    const totalShiftHours = ((endHour - startHour + 24) % 24) || 24;
    if (totalShiftHours < MANDATORY_BREAK_MIN_SHIFT_HOURS) continue;

    const hoursElapsedBeforeSheet = person.isCarryOver ? (4 - startHour + 24) % 24 : 0;
    const elapsedAtSlotStart = (slot: number) => hoursElapsedBeforeSheet + (slot - person.activeStartIdx);

    const fragmentLength = person.activeEndIdx - person.activeStartIdx;
    const midElapsed = totalShiftHours / 2;
    const ownsBreakResponsibility =
      hoursElapsedBeforeSheet <= midElapsed && midElapsed < hoursElapsedBeforeSheet + fragmentLength;
    if (!ownsBreakResponsibility) {
      log(
        `Phase2: employee=${person.employeeId}: このシートの断片は休憩配置の責任を持たない` +
          `（シフト中間点(経過${midElapsed}h)がもう一方の断片に属するため。二重配置防止）`
      );
      continue;
    }

    const isNightShift = person.shiftTypeCode === "明番" || startHour === 22;
    const breakHoursNeeded = isNightShift ? 2 : 1;

    log(
      `Phase2: employee=${person.employeeId} shift=${person.resolvedStart}-${person.resolvedEnd} ` +
        `totalShiftHours=${totalShiftHours} isCarryOver=${person.isCarryOver} hoursElapsedBeforeSheet=${hoursElapsedBeforeSheet} ` +
        `isNightShift=${isNightShift} breakHoursNeeded=${breakHoursNeeded}`
    );

    // 【絶対条件】BREAKは「出勤から3時間後〜5時間以内」の範囲を厳守する。
    // これはisPreferred（並び替え用のヒント）ではなく、配置可能スロットそのものを絞り込む
    // ハードフィルタとして扱う（この範囲外に配置することは、他の休憩と重なる／後の時間帯が
    // 手薄になるなどの事情があっても一切許容しない）。
    // ただし、11時・18時（BREAK_FORBIDDEN_SLOTS）の除外によってこの3〜5hの枠内の候補が
    // 2未満に減ってしまう場合に限り、前後最大1時間まで範囲を広げて候補を補う
    // （＝禁止時間帯のせいで全員の休憩が1つの時刻に集中し、他業務の人員配置が非効率に
    // なるのを防ぐための救済措置。11時・18時そのものが候補になることは変更後も一切ない）。
    const collectInRangeSlots = (minOffset: number, maxOffset: number): number[] => {
      const out: number[] = [];
      for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
        const elapsed = elapsedAtSlotStart(s);
        if (elapsed < minOffset || elapsed >= maxOffset) continue;
        out.push(s);
      }
      return out;
    };

    const rawInRangeSlots = collectInRangeSlots(BREAK_ACCEPTABLE_MIN_OFFSET, BREAK_ACCEPTABLE_MAX_OFFSET);
    let inRangeSlots = rawInRangeSlots.filter((s) => !BREAK_FORBIDDEN_SLOTS.has(s));

    if (inRangeSlots.length < rawInRangeSlots.length) {
      // 禁止時間帯の除外が実際に発生したケースのみ、不足分を補うために範囲を広げる。
      for (
        let extension = 1;
        inRangeSlots.length < BREAK_WINDOW_MIN_CANDIDATES && extension <= BREAK_WINDOW_MAX_EXTENSION_HOURS;
        extension++
      ) {
        const widened = collectInRangeSlots(
          BREAK_ACCEPTABLE_MIN_OFFSET - extension,
          BREAK_ACCEPTABLE_MAX_OFFSET + extension
        ).filter((s) => !BREAK_FORBIDDEN_SLOTS.has(s));
        if (widened.length > inRangeSlots.length) {
          log(
            `Phase2: employee=${person.employeeId}: 禁止時間帯(11時/18時)除外により候補が` +
              `${inRangeSlots.length}件に減ったため、範囲を経過${BREAK_ACCEPTABLE_MIN_OFFSET - extension}` +
              `〜${BREAK_ACCEPTABLE_MAX_OFFSET - 1 + extension}hまで拡張して補いました`
          );
        }
        inRangeSlots = widened;
      }
    }

    if (inRangeSlots.length === 0) {
      log(`Phase2: employee=${person.employeeId}: 経過${BREAK_ACCEPTABLE_MIN_OFFSET}〜${BREAK_ACCEPTABLE_MAX_OFFSET}hの範囲がこの断片に含まれません（他方の断片で処理される想定、または休憩なしで許容）`);
      continue;
    }

    const isFree = (s: number) => !getAssigned(person.employeeId, s);
    // その時間帯にどれだけ人員の余裕があるか（=同時刻に稼働中の人数。多いほど1人抜けても
    // 影響が小さい＝休憩に適したタイミングと判断する）。全従業員で共通のため一度だけ計算する。
    const slackAt = (s: number) => activeCountAtSlot(s);

    function placeBreakAt(slots: number[]) {
      for (const s of slots) {
        setAssigned(person.employeeId, s, "BREAK");
        results.push({ employeeId: person.employeeId, slotIndex: s, code: "BREAK" });
        breakOccupiedSlots.add(s);
      }
      log(`Phase2: employee=${person.employeeId}: 休憩を ${slots.map((s) => `slot${s}(経過${elapsedAtSlotStart(s)}h,余裕${slackAt(s)}名)`).join(",")} に配置`);
    }

    // 単一スロット（日勤1時間）の並び順: ①他スタッフの休憩と重ならない
    // ②その時間帯の稼働人数が多い（＝余裕がある）ほど優先 ③経過4hに近い方を最後の決め手にする
    function rankSingle(pool: number[]): number[] {
      return [...pool].sort((a, b) => {
        const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
        const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
        if (aOverlap !== bOverlap) return aOverlap - bOverlap;
        const slackDiff = slackAt(b) - slackAt(a); // 余裕が多い方を優先
        if (slackDiff !== 0) return slackDiff;
        return distanceFromAnchor(a) - distanceFromAnchor(b);
      });
    }
    const distanceFromAnchor = (s: number) => Math.abs(elapsedAtSlotStart(s) - BREAK_ANCHOR_OFFSET);

    if (breakHoursNeeded === 2) {
      // 3〜5h経過の範囲に完全に収まる2時間連続の組み合わせを探す（範囲の性質上、通常は
      // 「経過3h・経過4h」の1パターンのみが該当する）。
      const starts = inRangeSlots.filter((s) => isFree(s) && inRangeSlots.includes(s + 1) && isFree(s + 1));
      const ranked = starts.sort((a, b) => {
        const aOverlap = breakOccupiedSlots.has(a) ? 1 : 0;
        const bOverlap = breakOccupiedSlots.has(b) ? 1 : 0;
        if (aOverlap !== bOverlap) return aOverlap - bOverlap;
        const slackDiff = Math.min(slackAt(b), slackAt(b + 1)) - Math.min(slackAt(a), slackAt(a + 1));
        if (slackDiff !== 0) return slackDiff;
        return distanceFromAnchor(a) - distanceFromAnchor(b);
      });
      const start = ranked[0];

      if (start !== undefined) {
        placeBreakAt([start, start + 1]);
      } else {
        // 2時間連続がこの範囲内で確保できない ⇒ 1時間のみで妥協する（範囲外への延長はしない）
        const single = rankSingle(inRangeSlots.filter((s) => isFree(s)))[0];
        if (single !== undefined) {
          placeBreakAt([single]);
          log(`Phase2: employee=${person.employeeId}: 明け番の2時間連続休憩を範囲内で確保できず1時間のみ配置（範囲外には配置しません）`);
        } else {
          log(`Phase2: employee=${person.employeeId}: 経過3〜5hの範囲内に休憩を配置できる時間帯がありません（範囲外への配置はしないため休憩なし）`);
        }
      }
      continue;
    }

    const single = rankSingle(inRangeSlots.filter((s) => isFree(s)))[0];
    if (single !== undefined) {
      placeBreakAt([single]);
    } else {
      log(`Phase2: employee=${person.employeeId}: 休憩を配置できる時間帯がありません`);
    }
  }

  // ---------------------------------------------------------------------
  // Phase 3: WHILL関連業務（優先度2。固定時刻・固定必要人数の4イベント）
  // ---------------------------------------------------------------------
  for (const event of WHILL_EVENTS) {
    const slot = event.slotIndex;
    const candidates = stableOrder.filter(
      (p) => isActive(p, slot) && !getAssigned(p.employeeId, slot) && p.employeeRole !== "PARTTIME"
    );
    const picked = sortCandidates(candidates, "A").slice(0, event.requiredCount);
    if (picked.length < event.requiredCount) {
      log(`Phase3: slot=${slot} whill=${event.code}(${event.label}): 必要人数${event.requiredCount}に対し${picked.length}名しか確保できません`);
    }
    for (const p of picked) {
      setAssigned(p.employeeId, slot, event.code);
      results.push({ employeeId: p.employeeId, slotIndex: slot, code: event.code });
      bump(p.employeeId);
      log(`Phase3: slot=${slot} whill=${event.code}: ${p.employeeId} を選択`);
    }
  }

  // ---------------------------------------------------------------------
  // Phase 4: 業務A/B/全（優先度3）。時間帯（1時間）ごとに A→B→全 の順で配置する。
  // ---------------------------------------------------------------------
  const minStart = Math.min(...DUTY_PRIORITY.map((d) => DUTY_WINDOW[d].startIdx));
  const maxEnd = Math.max(...DUTY_PRIORITY.map((d) => DUTY_WINDOW[d].endIdx));

  const continuing: Record<DutyCode, (string | null)[]> = { A: [], B: [], 全: [] };
  const streak: Record<DutyCode, number[]> = { A: [], B: [], 全: [] };

  for (let slot = minStart; slot < maxEnd; slot++) {
    const chosenThisSlot: string[] = [];

    for (const duty of DUTY_PRIORITY) {
      if (!isDutyActiveAtSlot(duty, slot)) continue;
      const cap = capFor(duty);

      for (let unit = 0; unit < cap; unit++) {
        const prevEmployee = continuing[duty][unit] ?? null;
        const prevStreak = streak[duty][unit] ?? 0;
        let candidate: DailyRosterItem | null = null;
        let reason = "";

        const prevPerson = prevEmployee ? stableOrder.find((x) => x.employeeId === prevEmployee) ?? null : null;
        const prevStillAvailable =
          !!prevPerson && isActive(prevPerson, slot) && !getAssigned(prevPerson.employeeId, slot) && !chosenThisSlot.includes(prevPerson.employeeId);

        const hitHardCap = prevStreak >= ROTATE_MAX_HOURS;

        const alternativePool = () =>
          stableOrder.filter(
            (p) =>
              p.employeeId !== prevEmployee &&
              isActive(p, slot) &&
              !getAssigned(p.employeeId, slot) &&
              !chosenThisSlot.includes(p.employeeId)
          );

        if (!prevPerson || !prevStillAvailable) {
          // 前任者が不在（勤務時間外／休憩・WHILLなど他の業務にすでに割り当て済み）。
          // これは「必要な場合の交代」（BREAK・WHILL・勤務時間の都合）にあたるため、
          // 交代の要否を判断するまでもなく新しい候補を選ぶ。
          const alternatives = sortCandidates(alternativePool(), duty);
          if (alternatives.length > 0) {
            candidate = alternatives[0];
            reason = "新規配置(前任者が不在のため)";
          } else {
            candidate = null;
            reason = "配置できる人員がいません";
          }
        } else if (prevStreak < ROTATE_PREFERRED_HOURS) {
          // 2時間未満 → 1時間ごとの細かい交代を避けるため、そのまま継続する。
          candidate = prevPerson;
          reason = `継続(${prevStreak}時間目、目安の2時間未満)`;
        } else if (hitHardCap) {
          // 3時間の絶対上限に到達 → 交代候補の有無に関わらず必ず交代する
          // （候補がいなければ、その枠は空欄＝不足として表示。ルールを破って延長しない）。
          const alternatives = sortCandidates(alternativePool(), duty);
          if (alternatives.length > 0) {
            candidate = alternatives[0];
            reason = `交代(${prevStreak}時間で上限到達のため強制交代)`;
          } else {
            candidate = null;
            reason = "上限3時間到達・交代候補なしのため空欄（不足として表示。ルールを破って延長しない）";
          }
        } else {
          // v6: 2時間以上3時間未満の「交代してもよいが必須ではない」中間ゾーン。
          // 原則は継続。他スタッフとの業務時間の偏りが REBALANCE_HOUR_GAP 時間以上
          // ある場合のみ、人員バランス調整のため早めに交代する（無意味な1時間交代を避ける）。
          const alternatives = sortCandidates(alternativePool(), duty);
          const bestAlternative = alternatives[0];
          const hourGap = bestAlternative ? hoursOf(prevPerson.employeeId) - hoursOf(bestAlternative.employeeId) : 0;

          if (bestAlternative && hourGap >= REBALANCE_HOUR_GAP) {
            candidate = bestAlternative;
            reason = `交代(${prevStreak}時間経過、他スタッフとの業務時間差${hourGap}時間のバランス調整のため交代)`;
          } else {
            candidate = prevPerson;
            reason = `継続(${prevStreak}時間経過も交代の必要性がないため継続。目安の2〜3時間の範囲内)`;
          }
        }

        if (!candidate) {
          log(`Phase4: slot=${slot} duty=${duty} unit=${unit}: 配置できる人員がいません（${reason || "人数不足として許容"}）`);
          continuing[duty][unit] = null;
          streak[duty][unit] = 0;
          continue;
        }

        setAssigned(candidate.employeeId, slot, duty);
        results.push({ employeeId: candidate.employeeId, slotIndex: slot, code: duty });
        bump(candidate.employeeId);
        lastAssignedDuty.set(candidate.employeeId, duty);
        chosenThisSlot.push(candidate.employeeId);
        log(`Phase4: slot=${slot} duty=${duty} unit=${unit}: ${candidate.employeeId} を選択 — ${reason}`);

        streak[duty][unit] = candidate.employeeId === prevEmployee ? prevStreak + 1 : 1;
        continuing[duty][unit] = candidate.employeeId;
      }
    }

    // -------------------------------------------------------------------
    // v7で追加: パート/アルバイトの「空欄」防止セーフティネット。
    // -------------------------------------------------------------------
    // パート/アルバイトは事務時間(OFFICE, Phase 5)の対象外であるため、通常の必要人数(cap)の
    // 選考で漏れると、勤務時間中なのに何も割り当てられない「空欄」になってしまう
    // （事務時間で穴埋めできる正社員等とは異なる）。sortCandidatesでパート/アルバイトを
    // 最優先にしたことで通常はこのケースは起きないはずだが、同時間帯にパート/アルバイトが
    // cap数を超えて重なった場合の保険として、この時間帯に稼働中の業務(A/B/全)のいずれかへ
    // 必要人数を超えてでも追加配置する（不足を埋めるためではなく、パート/アルバイト本人を
    // 空欄にしないための措置。通常の必要人数計算・不足表示には影響しない）。
    const activeDutiesThisSlot = DUTY_PRIORITY.filter((d) => isDutyActiveAtSlot(d, slot));
    if (activeDutiesThisSlot.length > 0) {
      const strandedPartTimers = stableOrder.filter(
        (p) =>
          p.employeeRole === "PARTTIME" &&
          isActive(p, slot) &&
          !getAssigned(p.employeeId, slot) &&
          !chosenThisSlot.includes(p.employeeId)
      );
      for (const p of strandedPartTimers) {
        const countFor = (d: DutyCode) => chosenThisSlot.filter((id) => getAssigned(id, slot) === d).length;
        const preferred = [...activeDutiesThisSlot].sort((d1, d2) => {
          const d1Same = lastAssignedDuty.get(p.employeeId) === d1 ? 1 : 0;
          const d2Same = lastAssignedDuty.get(p.employeeId) === d2 ? 1 : 0;
          if (d1Same !== d2Same) return d1Same - d2Same; // 直前と同じ業務は後回し
          return countFor(d1) - countFor(d2); // 人数の少ない業務を優先（負荷分散）
        })[0];
        setAssigned(p.employeeId, slot, preferred);
        results.push({ employeeId: p.employeeId, slotIndex: slot, code: preferred });
        bump(p.employeeId);
        lastAssignedDuty.set(p.employeeId, preferred);
        chosenThisSlot.push(p.employeeId);
        log(
          `Phase4: slot=${slot}: パート/アルバイト ${p.employeeId} が通常の必要人数選考で` +
            `漏れたため ${preferred} へ追加配置（事務時間を割り当てないための保険）`
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Phase 5: 事務時間（OFFICE）— 優先度4。
  // ---------------------------------------------------------------------
  for (const person of stableOrder) {
    if (person.employeeRole === "PARTTIME") continue;
    for (let s = person.activeStartIdx; s < person.activeEndIdx; s++) {
      if (getAssigned(person.employeeId, s)) continue;
      setAssigned(person.employeeId, s, "OFFICE");
      results.push({ employeeId: person.employeeId, slotIndex: s, code: "OFFICE" });
    }
  }

  return results;
}

// Phase 6: 不足人数の計算（呼び出し側のAPIから使用）
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
