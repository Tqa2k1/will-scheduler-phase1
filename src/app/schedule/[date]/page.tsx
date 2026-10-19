"use client";

import { POSITION_COLORS } from "@/lib/positionColors";
import { isManagerRole } from "@/lib/roles";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DUTY_PRIORITY, computeShortageCells, isSixtyMinuteCode, DutyCode } from "@/lib/dutySchedule";
import { buildDisplaySlots } from "@/lib/timeSlots";
import { findCoveringAssignment, coveringDurationMinutes } from "@/lib/scheduleGrid";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import Icon from "@/components/ui/Icon";

type CartPosition = { id: string; code: string; name: string; category: "CART" | "SPECIAL"; color: string | null; isActive?: boolean };
type RosterItem = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  shiftTypeCode: string | null;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  activeStartIdx: number;
  activeEndIdx: number;
  isCarryOver: boolean;
};
type Assignment = {
  employeeId: string;
  slotStart: string;
  slotEnd: string;
  cartPositionId: string;
  cartPosition: CartPosition;
};

// 表示専用の30分刻みスロット（48個/日）。自動アサインの計算は従来通り1時間単位のまま
// （src/lib/dutySchedule.ts）で、この画面の見た目だけを30分刻みに変更する。
const SLOTS = buildDisplaySlots();

// 30分スロットのインデックス(0-47) -> 対応する時間インデックス(0-23)。
// activeStartIdx/activeEndIdxやdutySchedule.tsの各関数は「1時間=1インデックス」の前提のため、
// 表示側のインデックスから変換して渡す。
function toHourIdx(slotIdx: number): number {
  return Math.floor(slotIdx / 2);
}

const NAME_COL_W = 110;
const TIME_COL_W = 120;



export default function SchedulePage() {
  const { data: session } = useSession();
  const isAdmin = isManagerRole(session?.user.role);
  const params = useParams<{ date: string }>();
  const router = useRouter();
  const date = params.date;

  function shiftDate(days: number) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    router.push(`/schedule/${d.toISOString().slice(0, 10)}`);
  }

  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // 最新の割当て。AIの提案を連続で適用する時に、直前の保存結果を必ず踏まえて分割判定するために使う。
  const assignmentsRef = useRef<Assignment[]>([]);
  const [positions, setPositions] = useState<CartPosition[]>([]);
  // 業務A/B/全の時間帯あたり必要人数（管理画面 /tasks の設定値。自動アサインAPIと同じ
  // ソースから取得することで、「配置状況」表示と自動アサインの不足判定を一致させる）
  const [demandByCode, setDemandByCode] = useState<Partial<Record<DutyCode, number>>>({});
  // INCが /shift-settings で設定したシフト必要人数から求めた、スロットごとの必要人数の合計
  // （自動割り当てと同じ設定。requiredCountAtSlot に渡して A/B/全 の必要人数を決める）
  const [totalBySlot, setTotalBySlot] = useState<number[]>([]);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [notLinked, setNotLinked] = useState(false);
  // 従業員は、その月が「調整中」の間はシフト内容を取得できない（APIが空で返す）
  const [monthAdjusting, setMonthAdjusting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  async function load() {
    const [schedRes, posRes, reqRes, headcountRes] = await Promise.all([
      fetch(`/api/schedule?date=${date}`),
      fetch(`/api/cart-positions`),
      fetch(`/api/task-requirements`),
      fetch(`/api/schedule/required-headcount`),
    ]);
    if (headcountRes.ok) setTotalBySlot((await headcountRes.json()).totalBySlot ?? []);
    if (schedRes.ok) {
      const data = await schedRes.json();
      setRoster(data.rosterItems);
      setAssignments(data.assignments);
      assignmentsRef.current = data.assignments;
      setNotLinked(!!data.notLinked);
      setMonthAdjusting(data.monthStatus === "ADJUSTING");
    }
    if (posRes.ok) setPositions(await posRes.json());
    if (reqRes.ok) {
      const requirements: { cartPosition: { code: string }; appliesToAllRoles: boolean; requiredCount: number; isActive?: boolean }[] =
        await reqRes.json();
      const next: Partial<Record<DutyCode, number>> = {};
      for (const duty of DUTY_PRIORITY) {
        // 無効化された業務要件は自動割当て(サーバー)と同じく対象外にする（配置状況と自動割当ての不足判定を一致させる）
        const forDuty = requirements.filter((r) => r.cartPosition.code === duty && r.isActive !== false);
        const chosen = forDuty.find((r) => r.appliesToAllRoles) ?? forDuty[0];
        if (chosen) next[duty] = chosen.requiredCount;
      }
      setDemandByCode(next);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // 別画面で従業員・業務を変更してから戻った時に、最新の内容を自動で再取得する
  useRefetchOnFocus(load);

  // 表示は30分刻みだが、割り当て自体は従来通り自由な長さ（主に1時間）のまま保持する。
  // セルごとの参照は findCoveringAssignment() で「時刻を含むか」を都度判定する。

  // 時間帯ごとに、業務A/B/全・WHILL関連業務の「必要人数 vs 実際の配置人数」を比較して
  // 不足を判定する。
  //
  // 修正前の問題: PRODUCTIVE_CODES(=A/B/全)がその時間に配置されているかどうかだけを見ており、
  // 各業務自身の稼働時間（例: 業務Bは6:00〜24:00）を考慮していなかったため、業務が本来
  // 稼働していない時間帯（例: 業務Bの24:00以降）でも「誰かが勤務していれば」不足表示が
  // 出てしまっていた。またWHILL関連業務は計算対象に含まれていなかった。
  //
  // 修正後: 各コードごとに src/lib/dutySchedule.ts の稼働時間定義でフィルタし、稼働時間内の
  // 時間帯のみを対象に、必要人数(requiredCountAtSlot)と実際の配置人数を比較する。
  const shortageByHour = useMemo(() => {
    // 自動割当て完了メッセージ(サーバー)と同じ計算(computeShortageCells)を使う。
    const result = new Map<number, string[]>();
    for (let hourIdx = 0; hourIdx < 24; hourIdx++) result.set(hourIdx, []);
    const cells = computeShortageCells(
      assignments.map((a) => ({ code: a.cartPosition.code, slotStart: a.slotStart, slotEnd: a.slotEnd })),
      demandByCode,
      totalBySlot
    );
    for (const c of cells) result.get(c.hourIdx)!.push(c.code);
    return result;
  }, [assignments, demandByCode, totalBySlot]);

  // 配置状況の表示用: 内部コード(code) -> 業務管理に登録されている最新の業務名。
  // 業務マスタ(positions)にない場合のみ code をそのまま表示する。
  const nameByCode = useMemo(() => new Map(positions.map((p) => [p.code, p.name])), [positions]);
  const displayName = (code: string) => nameByCode.get(code) ?? code;

  // slotIdx（0-47の30分スロット）を編集する。
  // その30分をカバーしている割り当てが1時間（=自動配置のデフォルト）の場合は、
  // 触れていない方の30分を元の業務のまま残しつつ、編集した方だけ新しい業務にする
  // ＝1時間の自動業務を2つの30分業務に「分割」する。既に30分単位ならそのまま更新する。
  async function saveAssignment(employeeId: string, slotIdx: number, cartPositionId: string) {
    const s = SLOTS[slotIdx];
    const covering = findCoveringAssignment(assignmentsRef.current, employeeId, s.start);

    // 60分業務（WHILL到着/出発の準備・片づけ、バッテリー交換）は30分に分割しない。
    // 60分業務を選ぶ場合、または60分業務を別の業務(空欄含む)に変更する場合は、
    // その1時間全体を新しい内容に置き換える。
    const newCode = positions.find((p) => p.id === cartPositionId)?.code;
    if (isSixtyMinuteCode(newCode) || isSixtyMinuteCode(covering?.cartPosition.code)) {
      const firstIdx = Math.floor(slotIdx / 2) * 2;
      const hourStart = SLOTS[firstIdx].start;
      const hourMid = SLOTS[firstIdx].end;
      const hourEnd = SLOTS[firstIdx + 1].end;
      const post = (body: object) =>
        fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      // 後半(30分開始)の割当てを消してから、1時間分を先頭に保存する
      await post({ employeeId, workDate: date, slotStart: hourMid, slotEnd: hourEnd, cartPositionId: null });
      await post({ employeeId, workDate: date, slotStart: hourStart, slotEnd: hourEnd, cartPositionId: cartPositionId || null });
      return;
    }

    if (covering && coveringDurationMinutes(covering) > 30) {
      const hourIdx = Math.floor(slotIdx / 2);
      const firstIdx = hourIdx * 2;
      const secondIdx = firstIdx + 1;
      const isFirstHalf = slotIdx === firstIdx;
      const hourStart = SLOTS[firstIdx].start;
      const hourMid = SLOTS[firstIdx].end; // == SLOTS[secondIdx].start
      const hourEnd = SLOTS[secondIdx].end;
      const firstHalfCode = isFirstHalf ? cartPositionId : covering.cartPositionId;
      const secondHalfCode = isFirstHalf ? covering.cartPositionId : cartPositionId;

      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate: date, slotStart: hourStart, slotEnd: hourMid, cartPositionId: firstHalfCode || null }),
      });
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate: date, slotStart: hourMid, slotEnd: hourEnd, cartPositionId: secondHalfCode || null }),
      });
    } else {
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate: date, slotStart: s.start, slotEnd: s.end, cartPositionId: cartPositionId || null }),
      });
    }
  }

  // 手動編集（セルのプルダウン）
  async function handlePositionChange(employeeId: string, slotIdx: number, cartPositionId: string) {
    await saveAssignment(employeeId, slotIdx, cartPositionId);
    load();
  }

  async function handleAutoAssign() {
    if (!confirm("この日の配置を自動生成します。既存の手動編集は上書きされます。よろしいですか？")) return;
    setAutoAssigning(true);
    const res = await fetch("/api/schedule/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    setAutoAssigning(false);
    if (res.ok) {
      const data = await res.json();
      const warn = Array.isArray(data.warnings) && data.warnings.length > 0 ? `\n\n【注意】\n${data.warnings.join("\n")}` : "";
      if (data.shortageCount > 0) {
        alert(`自動割り当てが完了しました。人員不足のコマが ${data.shortageCount} 件あります（赤色で表示されます）。${warn}`);
      } else if (warn) {
        alert(`自動割り当てが完了しました。人員不足はありません。${warn}`);
      }
      load();
    } else {
      const data = await res.json().catch(() => null);
      const detail = data?.detail || data?.error || "";
      alert(`自動割り当てに失敗しました。${detail ? `\n詳細: ${detail}` : ""}`);
    }
  }

  return (
    <div style={{ maxWidth: "100%", padding: "32px 24px" }}>
      <Link href="/roster" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← 勤務表に戻る
      </Link>
      {!isAdmin && monthAdjusting && (
        <p className="card" style={{ margin: "12px 0", padding: "12px 16px", fontWeight: 600 }} data-testid="schedule-adjusting">
          この月の勤務スケジュールは調整中です。確定後に表示されます。
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn-secondary" onClick={() => shiftDate(-1)} style={{ padding: "6px 12px" }}><Icon name="chevronLeft" />← 前日</button>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0 }}>
            アサイン表 — {date}
          </h1>
          <button className="btn-secondary" onClick={() => shiftDate(1)} style={{ padding: "6px 12px" }}><Icon name="chevronRight" />翌日 →</button>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => router.push(`/schedule/${e.target.value}`)}
            style={{ width: 150 }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isAdmin && (
            <button className="btn" onClick={handleAutoAssign} disabled={autoAssigning}><Icon name="calendarCheck" />
              {autoAssigning ? "生成中..." : "自動割り当て"}
            </button>
          )}
          {isAdmin && (
            <button className="btn-secondary" onClick={() => setAiModalOpen(true)}>
              <Icon name="sparkles" />AI依頼
            </button>
          )}
          <a className="btn-secondary" href={`/api/export/schedule-excel?date=${date}`}><Icon name="sheet" />Excel出力</a>
          <a className="btn-secondary" href={`/api/export/schedule-pdf?date=${date}`}><Icon name="fileText" />PDF出力</a>
        </div>
      </div>

      {notLinked && (
        <div className="card" style={{ marginBottom: 16, background: "#fffbeb", borderColor: "#fde68a" }}>
          <p style={{ margin: 0, color: "var(--color-warn)" }}>
            このアカウントにはまだ従業員情報が紐付けられていません。自分のスケジュールを表示するには、管理者にアカウントと従業員情報の紐付けを依頼してください。
          </p>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 12, minWidth: NAME_COL_W, width: NAME_COL_W, background: "var(--color-surface-2)", fontSize: 13 }}>氏名</th>
              <th style={{ ...thStyle, position: "sticky", left: NAME_COL_W, zIndex: 12, minWidth: TIME_COL_W, width: TIME_COL_W, background: "var(--color-surface-2)", fontSize: 13 }}>勤務時間</th>
              {Array.from({ length: 24 }, (_, hourIdx) => (
                <th key={hourIdx} colSpan={2} style={{ ...thStyle, minWidth: 120, fontSize: 11 }}>
                  {SLOTS[hourIdx * 2].start}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 12, minWidth: NAME_COL_W, width: NAME_COL_W, fontWeight: 400 }}>配置状況</th>
              <th style={{ ...thStyle, position: "sticky", left: NAME_COL_W, zIndex: 12, minWidth: TIME_COL_W, width: TIME_COL_W }}></th>
              {Array.from({ length: 24 }, (_, hourIdx) => {
                const missing = shortageByHour.get(hourIdx) ?? [];
                return (
                  <th
                    key={hourIdx}
                    colSpan={2}
                    style={{
                      ...thStyle,
                      background: missing.length > 0 ? "#fee2e2" : "var(--color-surface-2)",
                      color: missing.length > 0 ? "var(--color-danger)" : "var(--color-text-muted)",
                      fontWeight: missing.length > 0 ? 700 : 400,
                      fontSize: 10,
                      whiteSpace: "normal",
                      wordBreak: "keep-all",
                    }}
                    title={missing.length > 0 ? `不足: ${missing.map(displayName).join("・")}` : "配置OK"}
                  >
                    {missing.length > 0 ? `不足:${missing.map(displayName).join("・")}` : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.employeeId}>
                <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 10, background: "var(--color-surface)", minWidth: NAME_COL_W, width: NAME_COL_W, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {r.employeeName}
                </td>
                {/* 勤務時間のみ表示（シフト名〔早番・遅番など〕は表示しない） */}
                <td style={{ ...tdStyle, position: "sticky", left: NAME_COL_W, zIndex: 10, background: "var(--color-surface)", minWidth: TIME_COL_W, width: TIME_COL_W, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center" }}>
                  {r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : ""}
                </td>
                {SLOTS.map((s, idx) => {
                  const isActive = toHourIdx(idx) >= r.activeStartIdx && toHourIdx(idx) < r.activeEndIdx;
                  if (!isActive) {
                    return <td key={s.start} style={{ ...tdStyle, background: "var(--color-surface-2)" }} />;
                  }
                  const a = findCoveringAssignment(assignments, r.employeeId, s.start);
                  // 60分業務は1つのセルにまとめて表示する（前半コマで結合し、後半コマは描画しない）
                  const sixty = a && isSixtyMinuteCode(a.cartPosition.code) && coveringDurationMinutes(a) >= 60;
                  if (sixty && idx % 2 === 1) return null;
                  const span = sixty ? 2 : 1;
                  const color = a ? (a.cartPosition.color ?? POSITION_COLORS[a.cartPosition.code] ?? "#f1f5f9") : "#ffffff";

                  if (!isAdmin) {
                    return (
                      <td
                        key={s.start}
                        colSpan={span}
                        title={a?.cartPosition.name ?? ""}
                        style={{ ...tdStyle, textAlign: "center", background: color, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: span === 2 ? 120 : 60 }}
                      >
                        {a?.cartPosition.name ?? ""}
                      </td>
                    );
                  }

                  return (
                    <td key={s.start} colSpan={span} style={{ ...tdStyle, padding: 0 }}>
                      <select
                        value={a?.cartPositionId ?? ""}
                        title={a?.cartPosition.name ?? ""}
                        onChange={(e) => handlePositionChange(r.employeeId, idx, e.target.value)}
                        style={{
                          width: span === 2 ? 120 : 60, height: 30, background: color,
                          color: "var(--color-text)", border: "1px solid var(--color-border)",
                          fontSize: 12, fontWeight: 600, textAlign: "center", cursor: "pointer",
                        }}
                      >
                        <option value=""></option>
                        {positions
                          .filter((p) => p.isActive !== false || p.id === a?.cartPositionId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap", fontSize: 12 }}>
        {positions.filter((p) => p.isActive !== false).map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color ?? POSITION_COLORS[p.code] ?? "#f1f5f9", border: "1px solid var(--color-border)", display: "inline-block" }} />
            {p.name}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-surface-2)", border: "1px solid var(--color-border)", display: "inline-block" }} />
          勤務時間外（編集不可）
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "#fee2e2", border: "1px solid var(--color-border)", display: "inline-block" }} />
          人員不足（業務A・業務B・業務全・WHILL関連業務のいずれかが必要人数未満。各業務の稼働時間内のみ判定）
        </div>
      </div>

      {aiModalOpen && (
        <AiAssistModal
          date={date}
          onClose={() => setAiModalOpen(false)}
          onApply={saveAssignment}
          onApplied={load}
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  textAlign: "center",
  fontSize: 12,
  color: "var(--color-text-muted)",
  background: "var(--color-surface-2)",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 6px",
  fontSize: 12,
};


// AI追加（日別スケジュール）。月間勤務表の「AI追加」と同じ流れ:
//   AIに依頼 → 提案一覧を確認 → 「適用」を押したものだけを手動編集と同じ保存処理で反映する。
type DailyAiChange = {
  employeeId: string;
  employeeName: string;
  start: string;
  slotIdx: number;
  cartPositionId: string;
  positionCode: string;
  positionName: string;
};

function AiAssistModal({
  date, onClose, onApply, onApplied,
}: {
  date: string;
  onClose: () => void;
  onApply: (employeeId: string, slotIdx: number, cartPositionId: string) => Promise<void>;
  onApplied: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [changes, setChanges] = useState<DailyAiChange[]>([]);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  const keyOf = (c: DailyAiChange) => `${c.employeeId}-${c.slotIdx}`;
  // 60分業務は1時間分の枠になる
  const rangeLabel = (c: DailyAiChange) => {
    const isSixty = isSixtyMinuteCode(c.positionCode);
    const end = SLOTS[Math.min(c.slotIdx + (isSixty ? 1 : 0), SLOTS.length - 1)].end;
    return `${SLOTS[c.slotIdx].start}〜${end}`;
  };

  async function handleSubmit() {
    setLoading(true);
    setResultMsg(null);
    setChanges([]);
    setAppliedKeys(new Set());
    const res = await fetch("/api/schedule/ai-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, prompt }),
    });
    setLoading(false);
    const data = await res.json().catch(() => null);
    setResultMsg(data?.message ?? data?.error ?? "エラーが発生しました。");
    // 実際にDBへ反映するのは、管理者が「適用」を押した時のみ（AIが勝手に変更することはない）。
    setChanges(Array.isArray(data?.changes) ? data.changes : []);
  }

  async function applyChange(c: DailyAiChange) {
    const key = keyOf(c);
    setApplyingKey(key);
    await onApply(c.employeeId, c.slotIdx, c.cartPositionId);
    setAppliedKeys((prev) => new Set(prev).add(key));
    await onApplied(); // 最新の割当てを取り直してから次の提案を適用する
    setApplyingKey(null);
  }

  async function applyAll() {
    for (const c of changes) {
      if (appliedKeys.has(keyOf(c))) continue;
      await applyChange(c);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>AI依頼</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          {date} のアサイン表について、AIが不足している業務の補完・調整案を提案します。提案内容は一覧で確認し、
          「適用」を押したものだけが実際にアサイン表に反映されます（AIが自動でデータベースを変更することはありません）。
        </p>

        <label className="label">依頼内容（任意）</label>
        <textarea
          className="input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ minHeight: 80, marginBottom: 12 }}
          placeholder="例：不足している時間帯を解消する割当て案を提案してほしい"
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn-secondary" onClick={onClose}><Icon name="x" />閉じる</button>
          <button className="btn" onClick={handleSubmit} disabled={loading}><Icon name="sparkles" />
            {loading ? "送信中..." : "AIに依頼する"}
          </button>
        </div>

        {resultMsg && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "pre-line", marginBottom: 12 }}>
            {resultMsg}
          </p>
        )}

        {changes.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="label" style={{ margin: 0 }}>提案された変更（{changes.length}件）</label>
              <button className="btn-secondary" onClick={applyAll} style={{ padding: "4px 10px", fontSize: 12 }}>
                <Icon name="check" />
                すべて適用
              </button>
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 6 }}>
              {changes.map((c) => {
                const key = keyOf(c);
                const isApplied = appliedKeys.has(key);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", borderBottom: "1px solid var(--color-border)", fontSize: 13,
                    }}
                  >
                    <span>
                      {c.employeeName} — {rangeLabel(c)} → <strong>{c.positionName}</strong>
                    </span>
                    <button
                      className="btn-secondary"
                      onClick={() => applyChange(c)}
                      disabled={isApplied || applyingKey === key}
                      style={{ padding: "3px 10px", fontSize: 12 }}
                    >
                      <Icon name="check" size={14} />
                      {isApplied ? "適用済み" : applyingKey === key ? "適用中..." : "適用"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
