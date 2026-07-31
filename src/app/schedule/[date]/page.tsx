"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

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

const PRODUCTIVE_CODES = ["A", "B", "全"];

function buildHourlySlots() {
  const slots: { start: string; end: string }[] = [];
  const pad = (n: number) => n.toString().padStart(2, "0");
  for (let i = 0; i < 24; i++) {
    const startH = (4 + i) % 24;
    const endH = (4 + i + 1) % 24;
    slots.push({ start: `${pad(startH)}:00`, end: `${pad(endH)}:00` });
  }
  return slots;
}
const SLOTS = buildHourlySlots();

const POSITION_COLORS: Record<string, string> = {
  A: "#dbeafe",
  B: "#f3e8ff",
  全: "#dcfce7",
  BF: "#ffedd5",
  BREAK: "#e5e7eb",
  MOVE: "#fef9c3",
  WHILL_PREP: "#cffafe",
  WHILL_CLEANUP: "#cffafe",
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
  const [autoAssigning, setAutoAssigning] = useState(false);

  async function load() {
    const [schedRes, posRes] = await Promise.all([
      fetch(`/api/schedule?date=${date}`),
      fetch(`/api/cart-positions`),
    ]);
    if (schedRes.ok) {
      const data = await schedRes.json();
      setRoster(data.rosterItems);
      setAssignments(data.assignments);
    }
    if (posRes.ok) setPositions(await posRes.json());
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

  // 時間ごとに 車A/車B/全 が誰かに割り当てられているか確認し、不足を判定
  const shortageBySlot = useMemo(() => {
    const covered = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!covered.has(a.slotStart)) covered.set(a.slotStart, new Set());
      covered.get(a.slotStart)!.add(a.cartPosition.code);
    }
    const result = new Map<string, string[]>();
    for (const s of SLOTS) {
      const coveredCodes = covered.get(s.start) ?? new Set();
      const missing = PRODUCTIVE_CODES.filter((c) => !coveredCodes.has(c));
      // その時間に誰も勤務していない（roster側でactiveな人が0人）場合は不足とみなさない
      const hasActiveStaff = roster.some((r) => {
        const idx = SLOTS.findIndex((slot) => slot.start === s.start);
        return idx >= r.activeStartIdx && idx < r.activeEndIdx;
      });
      result.set(s.start, hasActiveStaff ? missing : []);
    }
    return result;
  }, [assignments, roster]);

  async function handlePositionChange(employeeId: string, slotStart: string, slotEnd: string, cartPositionId: string) {
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, workDate: date, slotStart, slotEnd, cartPositionId: cartPositionId || null }),
    });
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

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2,minWidth:"100px", backgroundColor: "white" }}>氏名</th>
              <th style={thStyle}>シフト</th>
              <th style={thStyle}>勤務時間</th>
              {SLOTS.map((s) => (
                <th key={s.start} style={{ ...thStyle, minWidth: 52 }}>{s.start}</th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2, fontWeight: 400 }}>配置状況</th>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
              {SLOTS.map((s) => {
                const missing = shortageBySlot.get(s.start) ?? [];
                return (
                  <th
                    key={s.start}
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
                <td style={{ ...tdStyle, color: "var(--color-text-muted)", fontSize: 11 }}>
                  {r.isCarryOver ? "明番（引継）" : r.shiftTypeCode ?? ""}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : ""}
                </td>
                {SLOTS.map((s, idx) => {
                  const isActive = idx >= r.activeStartIdx && idx < r.activeEndIdx;
                  if (!isActive) {
                    return <td key={s.start} style={{ ...tdStyle, background: "var(--color-surface-2)" }} />;
                  }
                  const a = assignMap.get(`${r.employeeId}-${s.start}`);
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
                        onChange={(e) => handlePositionChange(r.employeeId, s.start, s.end, e.target.value)}
                        style={{
                          width: 52, height: 30, background: color,
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
          人員不足（車A・車B・全のいずれかが未配置）
        </div>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 8 }}>
        並び順: INC → 開始時刻の早い順（前日22時〜翌8時勤務の人は、当日シートでは「明番（引継）」として4:00〜8:00のみ表示）
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
