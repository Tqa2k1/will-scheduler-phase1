"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Employee = { id: string; fullName: string; role: string };
type ShiftType = { id: string; code: string; name: string };
type RosterEntry = {
  employeeId: string;
  workDate: string;
  shiftTypeId: string | null;
  status: "WORK" | "PAID_LEAVE" | "ADJUST_LEAVE";
  shiftType: ShiftType | null;
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export default function RosterPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [entries, setEntries] = useState<RosterEntry[]>([]);

  const monthStr = `${year}-${month.toString().padStart(2, "0")}`;
  const numDays = daysInMonth(year, month);

  async function load() {
    const [rosterRes, shiftRes] = await Promise.all([
      fetch(`/api/roster?month=${monthStr}`),
      fetch(`/api/shift-types`),
    ]);
    if (rosterRes.ok) {
      const data = await rosterRes.json();
      setEmployees(data.employees);
      setEntries(data.entries);
    }
    if (shiftRes.ok) setShiftTypes(await shiftRes.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  // Tra cứu nhanh: employeeId + ngày -> entry hiện tại
  const entryMap = useMemo(() => {
    const map = new Map<string, RosterEntry>();
    for (const e of entries) {
      const d = new Date(e.workDate).getUTCDate();
      map.set(`${e.employeeId}-${d}`, e);
    }
    return map;
  }, [entries]);

  async function handleChange(employeeId: string, day: number, value: string) {
    const workDate = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

    let shiftTypeId: string | null = null;
    let status: "WORK" | "PAID_LEAVE" | "ADJUST_LEAVE" = "WORK";

    if (value === "") {
      // Xoá — tạm coi như WORK không có ca (đơn giản hoá Phase 1)
      shiftTypeId = null;
    } else if (value === "有休") {
      status = "PAID_LEAVE";
    } else if (value === "調整休") {
      status = "ADJUST_LEAVE";
    } else {
      shiftTypeId = value;
    }

    const res = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, workDate, shiftTypeId, status }),
    });
    if (res.ok) load();
  }

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← Dashboard
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>
          Master Roster — {monthStr}
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>Tháng {m}</option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <a className="btn" href={`/api/export/roster-excel?month=${monthStr}`}>
            Xuất Excel
          </a>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", width: "max-content" }}>
          <thead>
            <tr>
              <th style={thStyle}>Nhân viên</th>
              {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
                const dateStr = `${year}-${month.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
                return (
                  <th key={d} style={{ ...thStyle, minWidth: 64 }}>
                    <Link href={`/schedule/${dateStr}`} style={{ color: "var(--color-accent)" }}>{d}</Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={{ ...tdStyle, position: "sticky", left: 0, background: "var(--color-surface)" }}>
                  {emp.fullName}
                </td>
                {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
                  const entry = entryMap.get(`${emp.id}-${d}`);
                  const value =
                    entry?.status === "PAID_LEAVE" ? "有休" :
                    entry?.status === "ADJUST_LEAVE" ? "調整休" :
                    entry?.shiftTypeId ?? "";
                  return (
                    <td key={d} style={tdStyle}>
                      <select
                        value={value}
                        onChange={(e) => handleChange(emp.id, d, e.target.value)}
                        style={{ background: "transparent", color: "inherit", border: "none", fontSize: 12, width: "100%" }}
                      >
                        <option value=""></option>
                        {shiftTypes.map((s) => (
                          <option key={s.id} value={s.id}>{s.code}</option>
                        ))}
                        <option value="有休">有休</option>
                        <option value="調整休">調整休</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 16 }}>
        Click vào ngày trong <Link href="/dashboard">Dashboard</Link> hoặc gõ trực tiếp URL{" "}
        <code>/schedule/2026-07-01</code> để vào lịch chi tiết theo slot 30 phút của ngày đó.
      </p>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 8px",
  textAlign: "left",
  fontSize: 12,
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border)",
  position: "sticky",
  top: 0,
  background: "var(--color-surface)",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 13,
};
