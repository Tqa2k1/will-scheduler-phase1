"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DUTY_PRIORITY, WHILL_EVENTS, isDutyActiveAtSlot, requiredCountAtSlot, DutyCode } from "@/lib/dutySchedule";

type CartPosition = {
  id: string;
  code: string;
  name: string;
  category: "CART" | "SPECIAL";
  color: string | null;
  slotUnitMinutes: number; // 60=通常（1時間単位）/ 30=30分単位でも配置可能
};
type RosterItem = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  shiftTypeCode: string | null;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  activeStartIdx: number; // 時間(hour)粒度の営業日インデックス（0-23。4:00始まり）
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

// タイムライン表示は30分刻み（48コマ）。ただし各業務(CartPosition)の既定の単位は引き続き
// 1時間であり（slotUnitMinutes=60）、30分単位を許可された特別な業務のみ30分のコマとして
// 配置できる。hourIndex は既存の src/lib/dutySchedule.ts（1時間粒度・0-23）にそのまま対応する。
function buildHalfHourSlots() {
  const slots: { start: string; end: string; hourIndex: number }[] = [];
  const pad = (n: number) => n.toString().padStart(2, "0");
  for (let i = 0; i < 48; i++) {
    const startTotal = 4 * 60 + i * 30;
    const endTotal = startTotal + 30;
    const startH = Math.floor(startTotal / 60) % 24;
    const startM = startTotal % 60;
    const endH = Math.floor(endTotal / 60) % 24;
    const endM = endTotal % 60;
    slots.push({
      start: `${pad(startH)}:${pad(startM)}`,
      end: `${pad(endH)}:${pad(endM)}`,
      hourIndex: Math.floor(i / 2),
    });
  }
  return slots;
}
const SLOTS = buildHalfHourSlots();

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

  const assignMap = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const a of assignments) map.set(`${a.employeeId}-${a.slotStart}`, a);
    return map;
  }, [assignments]);

  // 時間帯ごとに、業務A/B/全・WHILL関連業務の「必要人数 vs 実際の配置人数」を比較して
  // 不足を判定する。この判定自体は既存通り1時間粒度のまま（src/lib/dutySchedule.tsが
  // 1時間粒度で定義されているため）。タイムラインの表示だけが30分刻みになったので、
  // 同じ不足情報を該当する1時間の中の両方の30分コマに表示する。
  //
  // 実際の配置人数は、その1時間の範囲内に存在するどの粒度のレコード（1時間/30分どちらでも）でも
  // 正しく数えられるよう、slotStartの「時刻」からhourIndexを逆算して集計する。
  const shortageByHour = useMemo(() => {
    const countByHourAndCode = new Map<number, Map<string, number>>();
    for (const a of assignments) {
      const [h] = a.slotStart.split(":").map(Number);
      const hourIndex = ((h - 4) % 24 + 24) % 24;
      if (!countByHourAndCode.has(hourIndex)) countByHourAndCode.set(hourIndex, new Map());
      const m = countByHourAndCode.get(hourIndex)!;
      m.set(a.cartPosition.code, (m.get(a.cartPosition.code) ?? 0) + 1);
    }

    const result = new Map<number, string[]>();
    for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
      const counts = countByHourAndCode.get(hourIndex) ?? new Map<string, number>();
      const missing: string[] = [];

      for (const duty of DUTY_PRIORITY) {
        if (!isDutyActiveAtSlot(duty, hourIndex)) continue; // 稼働時間外は不足計算しない
        const required = requiredCountAtSlot(duty, hourIndex, demandByCode);
        const actual = counts.get(duty) ?? 0;
        if (actual < required) missing.push(duty);
      }
      for (const event of WHILL_EVENTS) {
        if (event.slotIndex !== hourIndex) continue; // 該当時間帯のみ計算対象
        const required = requiredCountAtSlot(event.code, hourIndex, demandByCode);
        const actual = counts.get(event.code) ?? 0;
        if (actual < required) missing.push(event.code);
      }

      result.set(hourIndex, missing);
    }
    return result;
  }, [assignments, demandByCode]);

  async function handlePositionChange(
    r: RosterItem,
    halfIdx: number,
    cartPositionId: string
  ) {
    const slot = SLOTS[halfIdx];

    if (!cartPositionId) {
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: r.employeeId, workDate: date, slotStart: slot.start, slotEnd: slot.end, cartPositionId: null }),
      });
      load();
      return;
    }

    const position = positions.find((p) => p.id === cartPositionId);
    const durationMinutes = position?.slotUnitMinutes === 30 ? 30 : 60;
    let slotEnd = slot.end;

    if (durationMinutes === 60) {
      // この業務は1時間単位。次の30分コマも同じ従業員の勤務時間内であることを確認したうえで、
      // 1時間分（slot.start 〜 次の次のコマの終了時刻）としてまとめて設定する。
      if (halfIdx + 1 >= SLOTS.length || halfIdx + 1 >= r.activeEndIdx * 2) {
        alert("この業務は1時間単位です。勤務時間を超えるため、この位置には設定できません。");
        return;
      }
      slotEnd = SLOTS[halfIdx + 1].end;
    }

    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: r.employeeId, workDate: date, slotStart: slot.start, slotEnd, cartPositionId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "設定に失敗しました");
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
              {SLOTS.map((s, idx) => (
                <th
                  key={s.start}
                  style={{
                    ...thStyle,
                    minWidth: 30,
                    fontSize: idx % 2 === 0 ? 11 : 9,
                    color: idx % 2 === 0 ? "var(--color-text-muted)" : "#c4c9d1",
                    borderLeft: idx % 2 === 0 ? "1px solid var(--color-border)" : undefined,
                  }}
                >
                  {idx % 2 === 0 ? s.start : ""}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, fontWeight: 400 }}>配置状況</th>
              <th style={thStyle}></th>
              {SLOTS.map((s, idx) => {
                const missing = shortageByHour.get(s.hourIndex) ?? [];
                return (
                  <th
                    key={s.start}
                    style={{
                      ...thStyle,
                      minWidth: 30,
                      background: missing.length > 0 ? "#fee2e2" : "var(--color-surface-2)",
                      color: missing.length > 0 ? "var(--color-danger)" : "var(--color-text-muted)",
                      fontWeight: missing.length > 0 ? 700 : 400,
                      fontSize: 9,
                      borderLeft: idx % 2 === 0 ? "1px solid var(--color-border)" : undefined,
                    }}
                    title={missing.length > 0 ? `不足: ${missing.join("・")}` : "配置OK"}
                  >
                    {missing.length > 0 && idx % 2 === 0 ? `不足:${missing.join("")}` : ""}
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
                  const isActive = idx >= r.activeStartIdx * 2 && idx < r.activeEndIdx * 2;
                  const borderLeft = idx % 2 === 0 ? "1px solid var(--color-border)" : undefined;
                  if (!isActive) {
                    return <td key={s.start} style={{ ...tdStyle, background: "var(--color-surface-2)", borderLeft }} />;
                  }

                  const direct = assignMap.get(`${r.employeeId}-${s.start}`);
                  // 直接の割当てが無い場合、直前の30分コマの割当てがこのコマまでカバーしている
                  // （＝1時間業務の後半など）かどうかを確認する ⇒ その場合はここは「続き」の
                  // 表示のみ（編集は先頭側のコマから行う）。60分業務は基本的に正時開始だが、
                  // 30分業務の直後に別の60分業務を置くなど、正時に揃わないケースもありうるため、
                  // 半コマの奇偶に関わらず判定する。
                  let continuationOf: Assignment | undefined;
                  if (!direct && idx > 0) {
                    const prevSlot = SLOTS[idx - 1];
                    const prev = assignMap.get(`${r.employeeId}-${prevSlot.start}`);
                    if (prev && prev.slotEnd === s.end) continuationOf = prev;
                  }

                  const shown = direct ?? continuationOf;
                  const color = shown ? (shown.cartPosition.color ?? POSITION_COLORS[shown.cartPosition.code] ?? "#f1f5f9") : "#ffffff";

                  if (!isAdmin) {
                    return (
                      <td key={s.start} style={{ ...tdStyle, textAlign: "center", background: color, borderLeft, fontSize: 10 }}>
                        {direct ? direct.cartPosition.code : ""}
                      </td>
                    );
                  }

                  if (continuationOf) {
                    // 1時間業務の後半30分: 編集は前半のコマから行う（ここは表示のみ）
                    return (
                      <td
                        key={s.start}
                        style={{ ...tdStyle, textAlign: "center", background: color, borderLeft, fontSize: 9, color: "var(--color-text-muted)" }}
                        title={`${continuationOf.cartPosition.name}（続き。編集は${SLOTS[idx - 1].start}から）`}
                      >
                        ﹅
                      </td>
                    );
                  }

                  return (
                    <td key={s.start} style={{ ...tdStyle, padding: 0, borderLeft }}>
                      <select
                        value={direct?.cartPositionId ?? ""}
                        onChange={(e) => handlePositionChange(r, idx, e.target.value)}
                        style={{
                          width: 30, height: 30, background: color,
                          color: "var(--color-text)", border: "1px solid var(--color-border)",
                          fontSize: 9, textAlign: "center", cursor: "pointer",
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
        タイムラインは30分単位で表示していますが、業務は基本的に1時間単位です。「30分も可」に設定された業務のみ
        30分のコマとして配置できます（1時間業務の後半30分は「﹅」で表示され、編集は前半のコマから行ってください）。
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
