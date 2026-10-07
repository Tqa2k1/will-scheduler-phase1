"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";

type User = { id: string; email: string; name: string; role: string; employeeId: string | null; employee: { fullName: string } | null };
type Employee = { id: string; fullName: string; isActive?: boolean };

const ROLE_LABEL: Record<string, string> = { ADMIN: "管理者", EMPLOYEE: "従業員", INC: "INC" };

export default function UsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // パスワード変更フォーム用（本人のみ・全ロール共通）
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  const isAdmin = session?.user.role === "ADMIN";

  async function load() {
    const [uRes, eRes] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/employees", { cache: "no-store" }),
    ]);
    if (uRes.ok) setUsers(await uRes.json());
    // 削除済み（isActive=false）の従業員は紐付け候補に出さない
    if (eRes.ok) setEmployees((await eRes.json() as Employee[]).filter((e) => e.isActive !== false));
  }

  useEffect(() => {
    if (status === "authenticated" && session.user.role === "ADMIN") load();
  }, [status, session]);

  // 従業員管理で従業員を追加・削除・変更してから戻った時に、最新の従業員一覧を自動で再取得する
  useRefetchOnFocus(load, status === "authenticated" && session?.user.role === "ADMIN");

  // 紐付け候補: 在籍中で、他のアカウントに紐付いていない従業員（User.employeeId は一意のため）
  const linkedIds = new Set(users.map((u) => u.employeeId).filter((id): id is string => !!id));
  const selectableFor = (currentId: string | null) => employees.filter((e) => !linkedIds.has(e.id) || e.id === currentId);

  if (status === "loading") return null;
  if (!session) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>ログインが必要です。</p>
        <Link href="/login">← ログイン画面へ</Link>
      </div>
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role, employeeId: employeeId || undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error?.toString?.() ?? "作成に失敗しました");
      return;
    }
    setEmail(""); setName(""); setPassword(""); setEmployeeId("");
    load();
  }

  async function handleLinkChange(user: User, newEmployeeId: string) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: newEmployeeId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error?.toString?.() ?? "紐付けの変更に失敗しました");
    }
    load();
  }

  async function handleDelete(user: User) {
    // 削除するのはログインアカウントのみ。紐付いている従業員・シフトのデータは削除されない。
    const ok = window.confirm(
      `アカウント「${user.name}（${user.email}）」を削除します。\n` +
        "削除するとこのアカウントではログインできなくなります。\n" +
        "（紐付いている従業員データ・シフトデータは削除されません）\n\n" +
        "よろしいですか？"
    );
    if (!ok) return;
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error?.toString?.() ?? "アカウントの削除に失敗しました");
    }
    load();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (newPassword !== confirmPassword) {
      setPwError("新しいパスワードと確認用パスワードが一致しません");
      return;
    }

    setPwLoading(true);
    const res = await fetch("/api/users/change-password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    const data = await res.json();
    setPwLoading(false);

    if (!res.ok) {
      setPwError(data.error ?? "パスワードの変更に失敗しました");
      return;
    }

    setPwSuccess("パスワードを変更しました。");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>アカウント管理</h1>

      {/* パスワード変更 — 全ロール共通（自分自身のパスワードのみ変更可能） */}
      <div className="card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>パスワードを変更</h2>
        <form onSubmit={handleChangePassword}>
          <label className="label">現在のパスワード</label>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            style={{ marginBottom: 12 }}
          />

          <label className="label">新しいパスワード</label>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            style={{ marginBottom: 12 }}
          />

          <label className="label">新しいパスワード（確認）</label>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            style={{ marginBottom: 12 }}
          />

          {pwError && <p style={{ color: "var(--color-danger)", fontSize: 13 }}>{pwError}</p>}
          {pwSuccess && <p style={{ color: "var(--color-ok)", fontSize: 13 }}>{pwSuccess}</p>}

          <button className="btn" type="submit" disabled={pwLoading}>
            {pwLoading ? "変更中..." : "パスワードを変更"}
          </button>
        </form>
      </div>

      {!isAdmin && (
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          アカウントの作成・一覧はこのページの管理者専用機能です。
        </p>
      )}

      {isAdmin && (
        <>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
            従業員用アカウントを作成すると、そのアカウントは月間・日別スケジュールの閲覧のみ可能になります（編集・削除・従業員管理・業務管理は不可）。
            自分のスケジュールを表示するには、下の表で必ず「紐付け従業員」を設定してください。
          </p>

          <form onSubmit={handleCreate} className="card" style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 180 }}>
              <label className="label">メールアドレス</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div style={{ minWidth: 140 }}>
              <label className="label">表示名</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div style={{ minWidth: 140 }}>
              <label className="label">初期パスワード</label>
              <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>

            <div>
              <label className="label">権限</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
                <option value="EMPLOYEE">従業員（閲覧のみ）</option>
                <option value="ADMIN">管理者</option>
              </select>
            </div>

            <div style={{ minWidth: 160 }}>
              <label className="label">紐付ける従業員（任意）</label>
              <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">なし</option>
                {selectableFor(null).map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.fullName}</option>
                ))}
              </select>
            </div>

            <button className="btn" type="submit" disabled={loading}>
              {loading ? "作成中..." : "アカウントを作成"}
            </button>
          </form>

          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>メールアドレス</th>
                  <th style={{ padding: "10px 12px" }}>表示名</th>
                  <th style={{ padding: "10px 12px" }}>権限</th>
                  <th style={{ padding: "10px 12px" }}>紐付け従業員</th>
                  <th style={{ padding: "10px 12px" }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ padding: "8px 12px" }}>{u.email}</td>
                    <td style={{ padding: "8px 12px" }}>{u.name}</td>
                    <td style={{ padding: "8px 12px" }}>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {u.role === "EMPLOYEE" ? (
                        <select
                          className="input"
                          value={u.employeeId ?? ""}
                          onChange={(e) => handleLinkChange(u, e.target.value)}
                          style={{ minWidth: 160 }}
                        >
                          <option value="">未設定（要設定）</option>
                          {selectableFor(u.employeeId).map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.fullName}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <button
                        className="btn-secondary"
                        onClick={() => handleDelete(u)}
                        disabled={u.id === session.user.id}
                        title={u.id === session.user.id ? "自分自身のアカウントは削除できません" : undefined}
                        style={{ color: "var(--color-danger)" }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
