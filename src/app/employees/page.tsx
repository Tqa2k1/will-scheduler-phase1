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

const ROLE_LABEL: Record<string, string> = { STAFF: "社員", CONTRACT: "契約社員", PARTTIME: "バイト", INC: "INC", OJT: "OJT" };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"INC" | "STAFF" | "CONTRACT" | "PARTTIME" | "OJT">("STAFF");
  const [baseStartTime, setBaseStartTime] = useState("08:00");
  const [baseEndTime, setBaseEndTime] = useState("17:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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

  function startEditName(emp: Employee) {
    setEditingId(emp.id);
    setEditName(emp.fullName);
  }

  async function saveEditName(empId: string) {
    if (!editName.trim()) return;
    await fetch(`/api/employees/${empId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: editName.trim() }),
    });
    setEditingId(null);
    load();
  }

  async function handleDeactivate(emp: Employee) {
    if (!confirm(`${emp.fullName} さんを退職（無効化）にしますか？\n過去の勤務データは保持されます。`)) return;
    await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
    load();
  }

  async function handleReactivate(emp: Employee) {
    await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    load();
  }

  const visibleEmployees = employees.filter((e) => showInactive || e.isActive);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
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
            <option value="STAFF">社員</option>
            <option value="CONTRACT">契約社員</option>
            <option value="PARTTIME">バイト</option>
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

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        退職済みも表示する
      </label>

      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={{ padding: "10px 12px" }}>氏名</th>
              <th style={{ padding: "10px 12px" }}>役割</th>
              <th style={{ padding: "10px 12px" }}>基本勤務時間</th>
              <th style={{ padding: "10px 12px" }}>状態</th>
              <th style={{ padding: "10px 12px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((emp) => (
              <tr key={emp.id} style={{ opacity: emp.isActive ? 1 : 0.5 }}>
                <td style={{ padding: "8px 12px" }}>
                  {editingId === emp.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        className="input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ width: 140 }}
                        autoFocus
                      />
                      <button className="btn" onClick={() => saveEditName(emp.id)} style={{ padding: "6px 10px" }}>保存</button>
                      <button className="btn-secondary" onClick={() => setEditingId(null)} style={{ padding: "6px 10px" }}>取消</button>
                    </div>
                  ) : (
                    emp.fullName
                  )}
                </td>
                <td style={{ padding: "8px 12px" }}>{ROLE_LABEL[emp.role]}</td>
                <td style={{ padding: "8px 12px", display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="input"
                    type="time"
                    value={emp.baseStartTime ?? ""}
                    onChange={(e) => handleUpdateTime(emp, "baseStartTime", e.target.value)}
                    style={{ width: 110 }}
                    disabled={!emp.isActive}
                  />
                  〜
                  <input
                    className="input"
                    type="time"
                    value={emp.baseEndTime ?? ""}
                    onChange={(e) => handleUpdateTime(emp, "baseEndTime", e.target.value)}
                    style={{ width: 110 }}
                    disabled={!emp.isActive}
                  />
                </td>
                <td style={{ padding: "8px 12px" }}>{emp.isActive ? "在籍中" : "退職"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  {editingId !== emp.id && emp.isActive && (
                    <button className="btn-secondary" onClick={() => startEditName(emp)} style={{ padding: "5px 10px", marginRight: 6, fontSize: 12 }}>
                      名前変更
                    </button>
                  )}
                  {emp.isActive ? (
                    <button className="btn-secondary" onClick={() => handleDeactivate(emp)} style={{ padding: "5px 10px", fontSize: 12, color: "var(--color-danger)" }}>
                      退職にする
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={() => handleReactivate(emp)} style={{ padding: "5px 10px", fontSize: 12 }}>
                      復職させる
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 12 }}>
        「退職にする」は過去の勤務データを保持したまま一覧から外す操作です（完全削除ではありません）。
      </p>
    </div>
  );
}
