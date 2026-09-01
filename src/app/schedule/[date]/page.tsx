"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DUTY_PRIORITY, WHILL_EVENTS, isDutyActiveAtSlot, requiredCountAtSlot, DutyCode } from "@/lib/dutySchedule";
import { buildDisplaySlots, minutesSinceOperatingStart } from "@/lib/timeSlots";

type CartPosition = { id: string; code: string; name: string; category: "CART" | "SPECIAL"; color: string | null };
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

// 指定した従業員の割り当ての中から、このスロット開始時刻を含む（＝カバーしている）ものを探す。
// 既存の1時間の業務は分割されないため、30分スロット2つにまたがって同じ割り当てが見つかる。
function findCoveringAssignment(assignments: Assignment[], employeeId: string, slotStartTime: string): Assignment | undefined {
  const target = minutesSinceOperatingStart(slotStartTime);
  return assignments.find((a) => {
    if (a.employeeId !== employeeId) return false;
    const start = minutesSinceOperatingStart(a.slotStart);
    let end = minutesSinceOperatingStart(a.slotEnd);
    if (end <= start) end += 24 * 60; // 日をまたぐ／終了時刻が境界ちょうどの場合
    return start <= target && target < end;
  });
}

// カバーしている割り当ての長さ（分）。1時間の自動業務かどうかの判定に使う。
function coveringDurationMinutes(a: Assignment): number {
  const start = minutesSinceOperatingStart(a.slotStart);
  let end = minutesSinceOperatingStart(a.slotEnd);
  if (end <= start) end += 24 * 60;
  return end - start;
}

const POSITION_COLORS: Record<string, string> = {
  A: "#dbeafe",
  B: "#f3e8ff",
  全: "#dcfce7",
  BF: "#ffedd5",
  BREAK: "#e5e7eb",
  MOVE: "#fef9c3",
  WHILL_ARRIVAL_PREP: "#cffafe",
  WHILL_ARRIVAL_CLEANUP: "#a5f3fc",
  WHILL_DEPARTURE_PREP: "#99f6e4",
  WHILL_DEPARTURE_CLEANUP: "#5eead4",
  OFFICE: "#e2e8f0",
  MTG: "#fee2e2",
};

export default function SchedulePage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
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
  const [positions, setPositions] = useState<CartPosition[]>([]);
  // 業務A/B/全の時間帯あたり必要人数（管理画面 /tasks の設定値。自動アサインAPIと同じ
  // ソースから取得することで、「配置状況」表示と自動アサインの不足判定を一致させる）
  const [demandByCode, setDemandByCode] = useState<Partial<Record<DutyCode, number>>>({});
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [notLinked, setNotLinked] = useState(false);

  async function load() {
    const [schedRes, posRes, reqRes] = await Promise.all([
      fetch(`/api/schedule?date=${date}`),
      fetch(`/api/cart-positions`),
      fetch(`/api/task-requirements`),
    ]);
    if (schedRes.ok) {
      const data = await schedRes.json();
      setRoster(data.rosterItems);
      setAssignments(data.assignments);
      setNotLinked(!!data.notLinked);
    }
    if (posRes.ok) setPositions(await posRes.json());
    if (reqRes.ok) {
      const requirements: { cartPosition: { code: string }; appliesToAllRoles: boolean; requiredCount: number }[] =
        await reqRes.json();
      const next: Partial<Record<DutyCode, number>> = {};
      for (const duty of DUTY_PRIORITY) {
        const forDuty = requirements.filter((r) => r.cartPosition.code === duty);
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
    // 割り当てはhourStartの時刻をカバーしているかどうかで「その時間の実配置」を数える
    // （既存の1時間業務が正しく1カウントされる。分割されないため半端は発生しない）。
    const result = new Map<number, string[]>();
    for (let hourIdx = 0; hourIdx < 24; hourIdx++) {
      const hourStartMinutes = hourIdx * 60;
      const countByCode = new Map<string, number>();
      for (const a of assignments) {
        const start = minutesSinceOperatingStart(a.slotStart);
        let end = minutesSinceOperatingStart(a.slotEnd);
        if (end <= start) end += 24 * 60;
        if (start <= hourStartMinutes && hourStartMinutes < end) {
          countByCode.set(a.cartPosition.code, (countByCode.get(a.cartPosition.code) ?? 0) + 1);
        }
      }

      const missing: string[] = [];
      for (const duty of DUTY_PRIORITY) {
        if (!isDutyActiveAtSlot(duty, hourIdx)) continue;
        const required = requiredCountAtSlot(duty, hourIdx, demandByCode);
        const actual = countByCode.get(duty) ?? 0;
        if (actual < required) missing.push(duty);
      }
      for (const event of WHILL_EVENTS) {
        if (event.slotIndex !== hourIdx) continue;
        const required = requiredCountAtSlot(event.code, hourIdx, demandByCode);
        const actual = countByCode.get(event.code) ?? 0;
        if (actual < required) missing.push(event.code);
      }
      result.set(hourIdx, missing);
    }
    return result;
  }, [assignments, demandByCode]);

  // slotIdx（0-47の30分スロット）を編集する。
  // その30分をカバーしている割り当てが1時間（=自動配置のデフォルト）の場合は、
  // 触れていない方の30分を元の業務のまま残しつつ、編集した方だけ新しい業務にする
  // ＝1時間の自動業務を2つの30分業務に「分割」する。既に30分単位ならそのまま更新する。
  async function handlePositionChange(employeeId: string, slotIdx: number, cartPositionId: string) {
    const s = SLOTS[slotIdx];
    const covering = findCoveringAssignment(assignments, employeeId, s.start);

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
      if (data.shortageCount > 0) {
        alert(`自動割り当てが完了しました。人員不足のコマが ${data.shortageCount} 件あります（赤色で表示されます）。`);
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
        ← 月間勤務表に戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn-secondary" onClick={() => shiftDate(-1)} style={{ padding: "6px 12px" }}>← 前日</button>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0 }}>
            日別スケジュール — {date}
          </h1>
          <button className="btn-secondary" onClick={() => shiftDate(1)} style={{ padding: "6px 12px" }}>翌日 →</button>
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
            <button className="btn" onClick={handleAutoAssign} disabled={autoAssigning}>
              {autoAssigning ? "生成中..." : "自動割り当て"}
            </button>
          )}
          <a className="btn-secondary" href={`/api/export/schedule-excel?date=${date}`}>Excel出力</a>
          <a className="btn-secondary" href={`/api/export/schedule-pdf?date=${date}`}>PDF出力</a>
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
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2,minWidth:"100px", backgroundColor: "white" }}>氏名</th>
              <th style={thStyle}>勤務時間</th>
              {Array.from({ length: 24 }, (_, hourIdx) => (
                <th key={hourIdx} colSpan={2} style={{ ...thStyle, minWidth: 80, fontSize: 11 }}>
                  {SLOTS[hourIdx * 2].start}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, fontWeight: 400 }}>配置状況</th>
              <th style={thStyle}></th>
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
                    }}
                    title={missing.length > 0 ? `不足: ${missing.join("・")}` : "配置OK"}
                  >
                    {missing.length > 0 ? `不足:${missing.join("")}` : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.employeeId}>
                <td style={{ ...tdStyle, position: "sticky", left: 0,zIndex: 10, background: "var(--color-surface)",minWidth: "100px",
  width: "100px", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {r.employeeName}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : ""}
                </td>
                {SLOTS.map((s, idx) => {
                  const isActive = toHourIdx(idx) >= r.activeStartIdx && toHourIdx(idx) < r.activeEndIdx;
                  if (!isActive) {
                    return <td key={s.start} style={{ ...tdStyle, background: "var(--color-surface-2)" }} />;
                  }
                  const a = findCoveringAssignment(assignments, r.employeeId, s.start);
                  const color = a ? (a.cartPosition.color ?? POSITION_COLORS[a.cartPosition.code] ?? "#f1f5f9") : "#ffffff";

                  if (!isAdmin) {
                    return (
                      <td key={s.start} style={{ ...tdStyle, textAlign: "center", background: color }}>
                        {a?.cartPosition.code ?? ""}
                      </td>
                    );
                  }

                  return (
                    <td key={s.start} style={{ ...tdStyle, padding: 0 }}>
                      <select
                        value={a?.cartPositionId ?? ""}
                        onChange={(e) => handlePositionChange(r.employeeId, idx, e.target.value)}
                        style={{
                          width: 40, height: 30, background: color,
                          color: "var(--color-text)", border: "1px solid var(--color-border)",
                          fontSize: 11, textAlign: "center", cursor: "pointer",
                        }}
                      >
                        <option value=""></option>
                        {positions.map((p) => (
                          <option key={p.id} value={p.id}>{p.code}</option>
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
        {positions.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color ?? POSITION_COLORS[p.code] ?? "#f1f5f9", border: "1px solid var(--color-border)", display: "inline-block" }} />
            {p.code} — {p.name}
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

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 8 }}>
        並び順: 勤務開始時刻が早い順（同じ開始時刻の場合は終了時刻が早い順）。役割による並び替えは行いません。
        前日22時〜翌8時勤務など日付をまたぐ夜勤は、当日シートでは4:00〜シフト終了時刻のみ「引き継ぎ」として表示されます。
      </p>
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
