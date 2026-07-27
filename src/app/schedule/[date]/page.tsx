"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type CartPosition = { id: string; code: string; name: string; category: "CART" | "SPECIAL" };
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

// 1時間ごと・24スロット（4:00始まり）— サーバー側 buildOperatingDaySlots と揃える
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
  const params = useParams<{ date: string }>();
  const date = params.date;

  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [positions, setPositions] = useState<CartPosition[]>([]);

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

  async function handlePositionChange(employeeId: string, slotStart: string, slotEnd: string, cartPositionId: string) {
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, workDate: date, slotStart, slotEnd, cartPositionId: cartPositionId || null }),
    });
    load();
  }

  return (
    <div style={{ maxWidth: "100%", padding: "32px 24px" }}>
      <Link href="/roster" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← 月間勤務表に戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: 0 }}>
          日別スケジュール — {date}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href={`/api/export/schedule-excel?date=${date}`}>Excel出力</a>
          <a className="btn-secondary" href={`/api/export/schedule-pdf?date=${date}`}>PDF出力</a>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2 }}>氏名</th>
              <th style={thStyle}>シフト</th>
              <th style={thStyle}>勤務時間</th>
              {SLOTS.map((s) => (
                <th key={s.start} style={{ ...thStyle, minWidth: 52 }}>{s.start}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.employeeId}>
                <td style={{ ...tdStyle, position: "sticky", left: 0, background: "var(--color-surface)", fontWeight: 600, whiteSpace: "nowrap" }}>
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
                  const color = a ? POSITION_COLORS[a.cartPosition.code] ?? "#f1f5f9" : "#ffffff";
                  return (
                    <td key={s.start} style={{ ...tdStyle, padding: 0 }}>
                      <select
                        value={a?.cartPositionId ?? ""}
                        onChange={(e) => handlePositionChange(r.employeeId, s.start, s.end, e.target.value)}
                        style={{
                          width: 52, height: 30, background: color,
                          color: "var(--color-text)", border: "1px solid var(--color-border)",
                          fontSize: 11, textAlign: "center",
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
            <span style={{ width: 12, height: 12, borderRadius: 3, background: POSITION_COLORS[p.code] ?? "#f1f5f9", border: "1px solid var(--color-border)", display: "inline-block" }} />
            {p.code} — {p.name}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-surface-2)", border: "1px solid var(--color-border)", display: "inline-block" }} />
          勤務時間外（編集不可）
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
