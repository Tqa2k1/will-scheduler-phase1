"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Employee = {
  id: string;
  fullName: string;
  role: "INC" | "RESPONSIBLE" | "STAFF" | "CONTRACT" | "PARTTIME" | "OJT";
  isActive: boolean;
  baseStartTime: string | null;
  baseEndTime: string | null;
  contactEmail: string | null;
  priorityOrder: number;
};

const ROLE_LABEL: Record<string, string> = { STAFF: "社員", CONTRACT: "契約社員", PARTTIME: "バイト", INC: "INC", RESPONSIBLE: "責任者", OJT: "OJT" };
// 役割ごとのグループ表示順（役割ごとの優先順位=RolePriorityとは別。単に画面上の見やすさのための並び）
const ROLE_ORDER: Employee["role"][] = ["STAFF", "CONTRACT", "PARTTIME", "RESPONSIBLE", "INC", "OJT"];

export default function EmployeesPage() {
  const { data: session, status } = useSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"INC" | "RESPONSIBLE" | "STAFF" | "CONTRACT" | "PARTTIME" | "OJT">("STAFF");
  const [baseStartTime, setBaseStartTime] = useState("08:00");
  const [baseEndTime, setBaseEndTime] = useState("17:00");
  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function load() {
    const res = await fetch("/api/employees");
    if (res.ok) setEmployees(await res.json());
  }

  useEffect(() => {
    if (status === "authenticated" && session?.user.role === "ADMIN") load();
  }, [status, session]);

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>このページを表示する権限がありません。</p>
        <Link href="/dashboard">← ダッシュボードに戻る</Link>
      </div>
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, role, baseStartTime, baseEndTime, contactEmail: contactEmail || undefined }),
    });

    setLoading(false);

    if (!res.ok) {
      setError("追加できませんでした（管理者権限が必要です）");
      return;
    }

    setFullName("");
    setContactEmail("");
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

  async function handleUpdateEmail(emp: Employee, value: string) {
    await fetch(`/api/employees/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactEmail: value || null }),
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

  async function handleDelete(emp: Employee) {
    if (!confirm(`${emp.fullName} さんを完全に削除しますか？\nこの操作は元に戻せません。`)) return;
    await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
    load();
  }

  // 同じ役割(role)内で従業員の並び順（優先順位）を入れ替える。
  // 並び順の先頭ほど優先度が高く、「シフト調整を実行」の候補者表示順に使われる。
  async function moveEmployeePriority(roleGroup: Employee[], index: number, dir: -1 | 1) {
    const targetIndex = index + dir;
    if (targetIndex < 0 || targetIndex >= roleGroup.length) return;

    const reordered = [...roleGroup];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const orderedIds = reordered.map((e) => e.id);

    // 楽観的更新：サーバー応答を待たずに画面上の並びを即座に反映する
    setEmployees((prev) => {
      const priorityById = new Map(orderedIds.map((id, i) => [id, i]));
      return prev.map((e) => (priorityById.has(e.id) ? { ...e, priorityOrder: priorityById.get(e.id)! } : e));
    });

    await fetch("/api/employees/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: roleGroup[0].role, orderedIds }),
    });
    load();
  }

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
            <option value="RESPONSIBLE">責任者</option>
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
        <div style={{ minWidth: 180 }}>
          <label className="label">連絡先メールアドレス（任意）</label>
          <input className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "追加中..." : "追加"}
        </button>
      </form>

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        「↑」「↓」で同じ役割内の従業員の優先順位を変更できます。上にあるほど優先度が高く、
        「シフト調整を実行」で対応可能な候補者を表示する際の順序に使われます（役割ごとの優先順位はここでは変更されません）。
      </p>

      {ROLE_ORDER.map((roleKey) => {
        const roleGroup = employees.filter((e) => e.isActive && e.role === roleKey);
        if (roleGroup.length === 0) return null;

        return (
          <div key={roleKey} className="card" style={{ padding: 0, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, margin: 0, padding: "12px 12px 0" }}>{ROLE_LABEL[roleKey]}</h2>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px", width: 70 }}>優先順位</th>
                  <th style={{ padding: "10px 12px" }}>氏名</th>
                  <th style={{ padding: "10px 12px" }}>基本勤務時間</th>
                  <th style={{ padding: "10px 12px" }}>連絡先メール</th>
                  <th style={{ padding: "10px 12px" }}>状態</th>
                  <th style={{ padding: "10px 12px" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {roleGroup.map((emp, index) => (
                  <tr key={emp.id}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <span style={{ color: "var(--color-text-muted)", fontSize: 13, marginRight: 6 }}>{index + 1}</span>
                      <button
                        className="btn-secondary"
                        onClick={() => moveEmployeePriority(roleGroup, index, -1)}
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        disabled={index === 0}
                        title="優先順位を上げる"
                      >
                        ↑
                      </button>{" "}
                      <button
                        className="btn-secondary"
                        onClick={() => moveEmployeePriority(roleGroup, index, 1)}
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        disabled={index === roleGroup.length - 1}
                        title="優先順位を下げる"
                      >
                        ↓
                      </button>
                    </td>
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
                    <td style={{ padding: "8px 12px" }}>
                      <input
                        className="input"
                        type="email"
                        value={emp.contactEmail ?? ""}
                        onChange={(e) => handleUpdateEmail(emp, e.target.value)}
                        placeholder="未登録"
                        style={{ width: 170 }}
                      />
                    </td>
                    <td style={{ padding: "8px 12px" }}>在籍中</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      {editingId !== emp.id && (
                        <button className="btn-secondary" onClick={() => startEditName(emp)} style={{ padding: "5px 10px", marginRight: 6, fontSize: 12 }}>
                          名前変更
                        </button>
                      )}
                      <button className="btn-danger" onClick={() => handleDelete(emp)} style={{ padding: "5px 10px", fontSize: 12 }}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 12 }}>
        「削除」を押すと従業員を完全に削除します。
      </p>
    </div>
  );
}