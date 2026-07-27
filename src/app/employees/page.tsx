"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Employee = {
  id: string;
  fullName: string;
  role: "INC" | "STAFF" | "OJT";
  isActive: boolean;
  baseStartTime: string | null;
  baseEndTime: string | null;
};

const ROLE_LABEL: Record<string, string> = { STAFF: "スタッフ", INC: "INC", OJT: "OJT" };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"INC" | "STAFF" | "OJT">("STAFF");
  const [baseStartTime, setBaseStartTime] = useState("08:00");
  const [baseEndTime, setBaseEndTime] = useState("17:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/employees");
    if (res.ok) setEmployees(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, role, baseStartTime, baseEndTime }),
    });

    setLoading(false);

    if (!res.ok) {
      setError("追加できませんでした（管理者権限が必要です）");
      return;
    }

    setFullName("");
    load();
  }

  async function handleUpdateTime(emp: Employee, field: "baseStartTime" | "baseEndTime", value: string) {
    await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    load();
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>従業員管理</h1>

      <form onSubmit={handleAdd} className="card" style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">氏名</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="label">役割</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="STAFF">スタッフ</option>
            <option value="INC">INC</option>
            <option value="OJT">OJT</option>
          </select>
        </div>
        <div>
          <label className="label">基本勤務時間（開始）</label>
          <input className="input" type="time" value={baseStartTime} onChange={(e) => setBaseStartTime(e.target.value)} />
        </div>
        <div>
          <label className="label">基本勤務時間（終了）</label>
          <input className="input" type="time" value={baseEndTime} onChange={(e) => setBaseEndTime(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "追加中..." : "追加"}
        </button>
      </form>

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={{ padding: "10px 12px" }}>氏名</th>
              <th style={{ padding: "10px 12px" }}>役割</th>
              <th style={{ padding: "10px 12px" }}>基本勤務時間</th>
              <th style={{ padding: "10px 12px" }}>状態</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={{ padding: "8px 12px" }}>{emp.fullName}</td>
                <td style={{ padding: "8px 12px" }}>{ROLE_LABEL[emp.role]}</td>
                <td style={{ padding: "8px 12px", display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="input"
                    type="time"
                    value={emp.baseStartTime ?? ""}
                    onChange={(e) => handleUpdateTime(emp, "baseStartTime", e.target.value)}
                    style={{ width: 110 }}
                  />
                  〜
                  <input
                    className="input"
                    type="time"
                    value={emp.baseEndTime ?? ""}
                    onChange={(e) => handleUpdateTime(emp, "baseEndTime", e.target.value)}
                    style={{ width: 110 }}
                  />
                </td>
                <td style={{ padding: "8px 12px" }}>{emp.isActive ? "在籍中" : "退職"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
