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
      body: JSON.stringify({ fullName, role }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error?.toString?.() ?? "Không thể thêm nhân viên (bạn có phải Admin không?)");
      return;
    }

    setFullName("");
    load();
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← Dashboard
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>Quản lý nhân viên</h1>

      <form onSubmit={handleAdd} className="card" style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="label">Họ tên</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Vai trò</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="STAFF">Nhân viên</option>
            <option value="INC">INC</option>
            <option value="OJT">OJT</option>
          </select>
        </div>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Đang thêm..." : "Thêm"}
        </button>
      </form>

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={{ padding: "8px 4px" }}>Họ tên</th>
              <th style={{ padding: "8px 4px" }}>Vai trò</th>
              <th style={{ padding: "8px 4px" }}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "8px 4px" }}>{emp.fullName}</td>
                <td style={{ padding: "8px 4px" }}>{emp.role}</td>
                <td style={{ padding: "8px 4px" }}>{emp.isActive ? "Đang hoạt động" : "Ngừng"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
