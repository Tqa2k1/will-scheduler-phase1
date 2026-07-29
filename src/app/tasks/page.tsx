"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Task = {
  id: string;
  code: string;
  name: string;
  category: "CART" | "SPECIAL";
  isActive: boolean;
  description: string | null;
  operatingStartTime: string | null;
  operatingEndTime: string | null;
  requirements: Requirement[];
};

type Requirement = {
  id: string;
  cartPositionId: string;
  appliesToAllRoles: boolean;
  targetRoles: string[];
  requiredCount: number;
  note: string | null;
  isActive: boolean;
};

type RolePriority = { role: string; priorityOrder: number };

const ROLE_LABEL: Record<string, string> = {
  INC: "INC",
  STAFF: "社員",
  CONTRACT: "契約社員",
  PARTTIME: "バイト",
  OJT: "OJT",
};
const ASSIGNABLE_ROLES = ["STAFF", "CONTRACT", "PARTTIME", "OJT"];

export default function TasksPage() {
  const { data: session, status } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [priorities, setPriorities] = useState<RolePriority[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    const [taskRes, prioRes] = await Promise.all([
      fetch("/api/cart-positions"),
      fetch("/api/role-priorities"),
    ]);
    if (taskRes.ok) setTasks(await taskRes.json());
    if (prioRes.ok) setPriorities(await prioRes.json());
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

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  async function toggleActive(task: Task) {
    await fetch(`/api/cart-positions/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !task.isActive }),
    });
    load();
  }

  async function handleDeleteTask(task: Task) {
    if (!confirm(`この業務「${task.name}」を削除してもよろしいですか？`)) return;
    const res = await fetch(`/api/cart-positions/${task.id}`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      if (data.deactivated) alert(data.message);
      if (selectedTaskId === task.id) setSelectedTaskId(null);
      load();
    } else {
      alert("削除に失敗しました。");
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>業務管理</h1>
        <button className="btn" onClick={() => setCreateOpen(true)}>業務を作成</button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 24 }}>
        <table style={{ width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={{ padding: "10px 12px" }}>業務名</th>
              <th style={{ padding: "10px 12px" }}>コード</th>
              <th style={{ padding: "10px 12px" }}>区分</th>
              <th style={{ padding: "10px 12px" }}>稼働時間</th>
              <th style={{ padding: "10px 12px" }}>業務要件数</th>
              <th style={{ padding: "10px 12px" }}>状態</th>
              <th style={{ padding: "10px 12px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.5, background: selectedTaskId === t.id ? "var(--color-accent-soft)" : undefined }}>
                <td style={{ padding: "8px 12px", cursor: "pointer" }} onClick={() => setSelectedTaskId(t.id)}>{t.name}</td>
                <td style={{ padding: "8px 12px" }}>{t.code}</td>
                <td style={{ padding: "8px 12px" }}>{t.category === "CART" ? "カート業務" : "特殊区分"}</td>
                <td style={{ padding: "8px 12px" }}>
                  {t.operatingStartTime && t.operatingEndTime ? `${t.operatingStartTime}〜${t.operatingEndTime}` : "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>{t.requirements.length}件</td>
                <td style={{ padding: "8px 12px" }}>{t.isActive ? "使用中" : "停止中"}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <button className="btn-secondary" onClick={() => setSelectedTaskId(t.id)} style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }}>
                    要件を管理
                  </button>
                  <button className="btn-secondary" onClick={() => toggleActive(t)} style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }}>
                    {t.isActive ? "停止する" : "再開する"}
                  </button>
                  <button className="btn-danger" onClick={() => handleDeleteTask(t)} style={{ padding: "5px 10px", fontSize: 12 }}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTask && (
        <RequirementPanel task={selectedTask} onChanged={load} onClose={() => setSelectedTaskId(null)} />
      )}

      <PriorityPanel priorities={priorities} onChanged={load} />

      {createOpen && <CreateTaskModal onClose={() => setCreateOpen(false)} onCreated={load} />}
    </div>
  );
}

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"CART" | "SPECIAL">("CART");
  const [startTime, setStartTime] = useState("05:00");
  const [endTime, setEndTime] = useState("23:00");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!code.trim() || !name.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/cart-positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        category,
        description: description || undefined,
        operatingStartTime: category === "CART" ? startTime : undefined,
        operatingEndTime: category === "CART" ? endTime : undefined,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error?.toString?.() ?? "作成に失敗しました");
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>業務を作成</h2>

        <label className="label">業務コード（例: C）</label>
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} style={{ marginBottom: 10 }} />

        <label className="label">業務名（例: Cカート）</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />

        <label className="label">区分</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as any)} style={{ marginBottom: 10 }}>
          <option value="CART">カート業務（稼働時間あり）</option>
          <option value="SPECIAL">特殊区分（休憩・移動など）</option>
        </select>

        {category === "CART" && (
          <>
            <label className="label">稼働開始時間</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ marginBottom: 10 }} />
            <label className="label">稼働終了時間</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ marginBottom: 10 }} />
          </>
        )}

        <label className="label">説明（任意）</label>
        <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 10, minHeight: 60 }} />

        {error && <p style={{ color: "var(--color-danger)", fontSize: 13 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={handleSubmit} disabled={loading}>{loading ? "作成中..." : "作成する"}</button>
        </div>
      </div>
    </div>
  );
}

function RequirementPanel({ task, onChanged, onClose }: { task: Task; onChanged: () => void; onClose: () => void }) {
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [requiredCount, setRequiredCount] = useState(1);
  const [note, setNote] = useState("");

  function toggleRole(role: string) {
    setSelectedRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function handleAdd() {
    await fetch("/api/task-requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartPositionId: task.id,
        appliesToAllRoles: appliesToAll,
        targetRoles: appliesToAll ? [] : selectedRoles,
        requiredCount,
        note: note || undefined,
      }),
    });
    setRequiredCount(1);
    setNote("");
    setSelectedRoles([]);
    onChanged();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/task-requirements/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16, margin: 0 }}>
          業務要件 — {task.name}
        </h2>
        <button className="btn-secondary" onClick={onClose} style={{ padding: "5px 10px", fontSize: 12 }}>閉じる</button>
      </div>

      {task.requirements.length > 0 && (
        <table style={{ width: "100%", marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 12 }}>
              <th style={{ padding: "6px 8px" }}>対象役割</th>
              <th style={{ padding: "6px 8px" }}>必要人数</th>
              <th style={{ padding: "6px 8px" }}>メモ</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {task.requirements.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  {r.appliesToAllRoles ? "全役割" : r.targetRoles.map((role) => ROLE_LABEL[role] ?? role).join("、")}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{r.requiredCount}名</td>
                <td style={{ padding: "6px 8px", fontSize: 13, color: "var(--color-text-muted)" }}>{r.note}</td>
                <td style={{ padding: "6px 8px" }}>
                  <button className="btn-secondary" onClick={() => handleDelete(r.id)} style={{ padding: "3px 8px", fontSize: 11 }}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
        <div>
          <label className="label">対象</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 6 }}>
            <input type="checkbox" checked={appliesToAll} onChange={(e) => setAppliesToAll(e.target.checked)} />
            全役割対象
          </label>
          {!appliesToAll && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ASSIGNABLE_ROLES.map((role) => (
                <label key={role} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <input type="checkbox" checked={selectedRoles.includes(role)} onChange={() => toggleRole(role)} />
                  {ROLE_LABEL[role]}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="label">必要人数</label>
          <input className="input" type="number" min={1} value={requiredCount} onChange={(e) => setRequiredCount(Number(e.target.value))} style={{ width: 80 }} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="label">メモ（任意）</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn" onClick={handleAdd}>要件を追加</button>
      </div>
    </div>
  );
}

function PriorityPanel({ priorities, onChanged }: { priorities: RolePriority[]; onChanged: () => void }) {
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    setOrder(priorities.slice().sort((a, b) => a.priorityOrder - b.priorityOrder).map((p) => p.role));
  }, [priorities]);

  function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  async function handleSave() {
    await fetch("/api/role-priorities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: order.map((role, idx) => ({ role, priorityOrder: idx + 1 })) }),
    });
    onChanged();
  }

  return (
    <div className="card">
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16, marginTop: 0 }}>優先順位</h2>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -6 }}>
        自動アサイン時にどの役割を優先して割り当てるかの順序です（INCは業務アサインの対象外のため含まれません）。
      </p>
      <ol style={{ paddingLeft: 0, listStyle: "none", maxWidth: 320 }}>
        {order.map((role, idx) => (
          <li key={role} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ width: 20, color: "var(--color-text-muted)", fontSize: 13 }}>{idx + 1}</span>
            <span style={{ flex: 1, fontSize: 14 }}>{ROLE_LABEL[role]}</span>
            <button className="btn-secondary" onClick={() => move(idx, -1)} style={{ padding: "2px 8px", fontSize: 12 }} disabled={idx === 0}>↑</button>
            <button className="btn-secondary" onClick={() => move(idx, 1)} style={{ padding: "2px 8px", fontSize: 12 }} disabled={idx === order.length - 1}>↓</button>
          </li>
        ))}
      </ol>
      <button className="btn" onClick={handleSave} style={{ marginTop: 12 }}>優先順位を保存</button>
    </div>
  );
}
