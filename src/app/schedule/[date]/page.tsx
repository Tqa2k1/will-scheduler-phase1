"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Employee = { id: string; fullName: string };
type ShiftType = { id: string; code: string };
type CartPosition = { id: string; code: string; name: string; category: "CART" | "SPECIAL" };
type RosterEntry = { employeeId: string; employee: Employee; shiftType: ShiftType | null };
type Assignment = {
  employeeId: string;
  slotStart: string;
  slotEnd: string;
  cartPositionId: string;
  cartPosition: CartPosition;
};

// Trục thời gian 4:00 -> 3:30 hôm sau, mỗi slot 30 phút (khớp lib/timeSlots.ts phía server)
function buildSlots() {
  const slots: { start: string; end: string }[] = [];
  const pad = (n: number) => n.toString().padStart(2, "0");
  for (let i = 0; i < 48; i++) {
    const total = 4 * 60 + i * 30;
    const sH = Math.floor(total / 60) % 24;
    const sM = total % 60;
    const eTotal = total + 30;
    const eH = Math.floor(eTotal / 60) % 24;
    const eM = eTotal % 60;
    slots.push({ start: `${pad(sH)}:${pad(sM)}`, end: `${pad(eH)}:${pad(eM)}` });
  }
  return slots;
}
const SLOTS = buildSlots();

const POSITION_COLORS: Record<string, string> = {
  A: "#3b82f6",
  B: "#a855f7",
  全: "#22c55e",
  BF: "#ff8a3d",
  BREAK: "#64748b",
  MOVE: "#eab308",
  WHILL_PREP: "#06b6d4",
  WHILL_CLEANUP: "#06b6d4",
  MTG: "#ef4444",
};

export default function SchedulePage() {
  const params = useParams<{ date: string }>();
  const date = params.date; // "2026-07-01"

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [positions, setPositions] = useState<CartPosition[]>([]);

  async function load() {
    const [schedRes, posRes] = await Promise.all([
      fetch(`/api/schedule?date=${date}`),
      fetch(`/api/cart-positions`),
    ]);
    if (schedRes.ok) {
      const data = await schedRes.json();
      setRoster(data.rosterEntries);
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

  async function handleChange(employeeId: string, slotStart: string, slotEnd: string, cartPositionId: string) {
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        workDate: date,
        slotStart,
        slotEnd,
        cartPositionId: cartPositionId || null,
      }),
    });
    load();
  }

  return (
    <div style={{ maxWidth: "100%", padding: "32px 24px" }}>
      <Link href="/roster" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← Master Roster
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>
          Daily Assignment — {date}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href={`/api/export/schedule-excel?date=${date}`}>Xuất Excel</a>
          <a className="btn" href={`/api/export/schedule-pdf?date=${date}`}>Xuất PDF</a>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2 }}>Nhân viên</th>
              <th style={thStyle}>Ca</th>
              {SLOTS.map((s) => (
                <th key={s.start} style={{ ...thStyle, minWidth: 46, fontSize: 10 }}>{s.start}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.employeeId}>
                <td style={{ ...tdStyle, position: "sticky", left: 0, background: "var(--color-surface)", fontWeight: 600 }}>
                  {r.employee.fullName}
                </td>
                <td style={{ ...tdStyle, color: "var(--color-text-muted)", fontSize: 11 }}>
                  {r.shiftType?.code ?? ""}
                </td>
                {SLOTS.map((s) => {
                  const a = assignMap.get(`${r.employeeId}-${s.start}`);
                  const color = a ? POSITION_COLORS[a.cartPosition.code] ?? "#334155" : "transparent";
                  return (
                    <td key={s.start} style={{ ...tdStyle, padding: 0 }}>
                      <select
                        value={a?.cartPositionId ?? ""}
                        onChange={(e) => handleChange(r.employeeId, s.start, s.end, e.target.value)}
                        style={{
                          width: 46,
                          height: 30,
                          background: color,
                          color: a ? "#0b0f1a" : "var(--color-text-muted)",
                          border: "1px solid var(--color-border)",
                          fontSize: 10,
                          textAlign: "center",
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
            <span style={{ width: 12, height: 12, borderRadius: 3, background: POSITION_COLORS[p.code] ?? "#334155", display: "inline-block" }} />
            {p.code} — {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  textAlign: "left",
  fontSize: 12,
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface)",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 12,
};
