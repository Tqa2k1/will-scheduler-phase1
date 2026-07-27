"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Employee = {
  id: string;
  fullName: string;
  role: "INC" | "STAFF" | "OJT";
  isActive: boolean;
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"INC" | "STAFF" | "OJT">("STAFF");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/employees");
    if (res.ok) {
      setEmployees(await res.json());
    }
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
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fullName,
        role,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json();

      setError(
        body.error?.toString?.() ??
          "社員を登録できません。管理者権限が必要です。"
      );

      return;
    }

    setFullName("");
    load();
  }

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: "40px 24px",
      }}
    >
      <Link
        href="/dashboard"
        style={{
          color: "var(--color-text-muted)",
          fontSize: 14,
        }}
      >
        ← ダッシュボード
      </Link>

      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 30,
          marginBottom: 30,
        }}
      >
        社員一覧
      </h1>

      <form
        onSubmit={handleAdd}
        className="card"
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 30,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 250 }}>
          <label className="label">氏名</label>

          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div style={{ minWidth: 180 }}>
          <label className="label">役職</label>

          <select
            className="input"
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "INC" | "STAFF" | "OJT")
            }
          >
            <option value="STAFF">STAFF</option>
            <option value="INC">INC</option>
            <option value="OJT">OJT</option>
          </select>
        </div>

        <button className="btn" type="submit" disabled={loading}>
          {loading ? "登録中..." : "社員追加"}
        </button>
      </form>

      {error && (
        <p style={{ color: "var(--color-danger)" }}>{error}</p>
      )}

      <div className="card">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                textAlign: "left",
                color: "var(--color-text-muted)",
                fontSize: 14,
              }}
            >
              <th style={{ padding: "12px" }}>氏名</th>
              <th style={{ padding: "12px" }}>役職</th>
              <th style={{ padding: "12px" }}>状態</th>
              <th style={{ padding: "12px" }}>操作</th>
            </tr>
          </thead>

          <tbody>
            {employees.map((emp) => (
              <tr
                key={emp.id}
                style={{
                  borderTop:
                    "1px solid var(--color-border)",
                }}
              >
                <td style={{ padding: "12px" }}>
                  {emp.fullName}
                </td>

                <td style={{ padding: "12px" }}>
                  {emp.role}
                </td>

                <td style={{ padding: "12px" }}>
                  {emp.isActive ? "在籍" : "退職"}
                </td>

                <td style={{ padding: "12px" }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="btn-secondary"
                    >
                      編集
                    </button>

                    <button
                      type="button"
                      className="btn-secondary"
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}