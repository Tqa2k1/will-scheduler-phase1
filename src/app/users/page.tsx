"use client";

import { isManagerRole } from "@/lib/roles";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Icon from "@/components/ui/Icon";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";

// アカウント設定 = 旧「従業員管理」＋旧「アカウント管理」を1画面に統合したもの。
//  - 従業員情報（氏名・役割・基本勤務時間・連絡先・優先順位）は Employee、ログイン情報（ID=メール・権限）は User。
//  - 氏名の「正のデータ」は Employee.fullName（紐付け済みアカウントの表示名はサーバー側で自動同期される）。
//  - ログインアカウントを持たない従業員も、この画面で表示・管理できる。
//  - ログインアカウントの作成・削除は管理者(ADMIN)のみ。従業員情報の編集は管理者・INC。
type Role = "INC" | "RESPONSIBLE" | "STAFF" | "CONTRACT" | "PARTTIME" | "OJT";
type Employee = {
  id: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  baseStartTime: string | null;
  baseEndTime: string | null;
  contactEmail: string | null;
  priorityOrder: number;
};
type User = { id: string; email: string; name: string; role: string; employeeId: string | null; employee: { fullName: string } | null };

const ROLE_LABEL: Record<string, string> = { STAFF: "社員", CONTRACT: "契約社員", PARTTIME: "バイト", INC: "INC", RESPONSIBLE: "責任者", OJT: "OJT" };
const ROLE_ORDER: Role[] = ["STAFF", "CONTRACT", "PARTTIME", "RESPONSIBLE", "INC", "OJT"];
const USER_ROLE_LABEL: Record<string, string> = { ADMIN: "管理者", EMPLOYEE: "従業員", INC: "INC" };

type AccountDraft = { email: string; password: string; role: "ADMIN" | "INC" | "EMPLOYEE" };
const emptyAccount: AccountDraft = { email: "", password: "", role: "EMPLOYEE" };

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  const e = data?.error;
  return typeof e === "string" ? e : fallback;
}

export default function AccountSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "employee"; emp: Employee } | { kind: "user"; user: User } | null>(null);
  const [busy, setBusy] = useState(false);

  const isManager = isManagerRole(session?.user.role);
  const isAdmin = session?.user.role === "ADMIN";

  async function load() {
    const eRes = await fetch("/api/employees", { cache: "no-store" });
    if (eRes.ok) setEmployees(await eRes.json());
    if (isAdmin) {
      const uRes = await fetch("/api/users", { cache: "no-store" });
      if (uRes.ok) setUsers(await uRes.json());
    }
  }

  useEffect(() => {
    if (status === "authenticated" && isManager) load();
    // 従業員アカウントには管理画面がないため、旧URL（/users）からはパスワード変更へ誘導する
    if (status === "authenticated" && !isManager) router.replace("/account/password");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);
  useRefetchOnFocus(load, status === "authenticated" && isManager);

  if (status === "loading") return null;
  if (!session) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>ログインが必要です。</p>
        <Link href="/login">← ログイン画面へ</Link>
      </div>
    );
  }
  if (!isManager) return null;

  const userByEmployee = new Map(users.filter((u) => u.employeeId).map((u) => [u.employeeId as string, u]));
  const unlinkedUsers = users.filter((u) => !u.employeeId);
  const linkedIds = new Set(users.map((u) => u.employeeId).filter((id): id is string => !!id));
  const activeEmployees = employees.filter((e) => e.isActive);
  const selectableFor = (currentId: string | null) => activeEmployees.filter((e) => !linkedIds.has(e.id) || e.id === currentId);

  async function moveEmployeePriority(roleGroup: Employee[], index: number, dir: -1 | 1) {
    const targetIndex = index + dir;
    if (targetIndex < 0 || targetIndex >= roleGroup.length) return;
    const reordered = [...roleGroup];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const orderedIds = reordered.map((e) => e.id);
    // 楽観的更新（画面の並びを即座に反映）
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

  async function handleLinkChange(user: User, newEmployeeId: string) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: newEmployeeId || null }),
    });
    if (!res.ok) setMessage({ kind: "error", text: await readError(res, "紐付けの変更に失敗しました") });
    load();
  }

  async function runDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const res =
      confirmDelete.kind === "employee"
        ? await fetch(`/api/employees/${confirmDelete.emp.id}`, { method: "DELETE" })
        : await fetch(`/api/users/${confirmDelete.user.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) setMessage({ kind: "error", text: await readError(res, "削除に失敗しました") });
    setConfirmDelete(null);
    setEditing(null);
    load();
  }

  return (
    <div className="app-page app-page--wide">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "アカウント設定" }]}
        title="アカウント設定"
        actions={
          <button className="btn" onClick={() => setCreating(true)} data-testid="btn-add-employee">
            <Icon name="userPlus" />
            従業員を追加
          </button>
        }
      />

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} style={{ color: message.kind === "error" ? "var(--color-danger)" : "var(--color-ok)", fontSize: 13 }}>
          {message.text}
        </p>
      )}

      {ROLE_ORDER.map((roleKey) => {
        const group = activeEmployees.filter((e) => e.role === roleKey);
        if (group.length === 0) return null;
        return (
          <div key={roleKey} className="card" style={{ padding: 0, marginBottom: 20, overflowX: "auto" }}>
            <h2 style={{ fontSize: 15, margin: 0, padding: "12px 12px 0" }}>{ROLE_LABEL[roleKey]}</h2>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px", width: 110 }}>優先順位</th>
                  <th style={{ padding: "10px 12px" }}>氏名</th>
                  {isAdmin && <th style={{ padding: "10px 12px" }}>ログインID</th>}
                  {isAdmin && <th style={{ padding: "10px 12px" }}>権限</th>}
                  <th style={{ padding: "10px 12px" }}>基本勤務時間</th>
                  <th style={{ padding: "10px 12px" }}>連絡先メール</th>
                </tr>
              </thead>
              <tbody>
                {group.map((emp, index) => {
                  const account = userByEmployee.get(emp.id);
                  return (
                    <tr
                      key={emp.id}
                      className="clickable-row"
                      tabIndex={0}
                      role="button"
                      aria-label={`${emp.fullName}を編集`}
                      data-testid={`employee-row-${emp.id}`}
                      onClick={() => setEditing(emp)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(emp); } }}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <span style={{ color: "var(--color-text-muted)", fontSize: 13, marginRight: 6 }}>{index + 1}</span>
                        <button className="btn-secondary" onClick={() => moveEmployeePriority(group, index, -1)} style={{ padding: "2px 8px", minHeight: 28 }} disabled={index === 0} aria-label="優先順位を上げる" title="優先順位を上げる">
                          <Icon name="arrowUp" size={14} />
                        </button>{" "}
                        <button className="btn-secondary" onClick={() => moveEmployeePriority(group, index, 1)} style={{ padding: "2px 8px", minHeight: 28 }} disabled={index === group.length - 1} aria-label="優先順位を下げる" title="優先順位を下げる">
                          <Icon name="arrowDown" size={14} />
                        </button>
                      </td>
                      <td style={{ padding: "8px 12px" }}>{emp.fullName}</td>
                      {isAdmin && <td style={{ padding: "8px 12px" }}>{account ? account.email : <span style={{ color: "var(--color-text-muted)" }}>アカウントなし</span>}</td>}
                      {isAdmin && <td style={{ padding: "8px 12px" }}>{account ? USER_ROLE_LABEL[account.role] ?? account.role : "—"}</td>}
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{emp.baseStartTime && emp.baseEndTime ? `${emp.baseStartTime}〜${emp.baseEndTime}` : "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{emp.contactEmail ?? <span style={{ color: "var(--color-text-muted)" }}>未登録</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {isAdmin && unlinkedUsers.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 20, overflowX: "auto" }} data-testid="unlinked-accounts">
          <h2 style={{ fontSize: 15, margin: 0, padding: "12px 12px 0" }}>従業員に紐付いていないアカウント</h2>
          <table style={{ width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                <th style={{ padding: "10px 12px" }}>ログインID</th>
                <th style={{ padding: "10px 12px" }}>表示名</th>
                <th style={{ padding: "10px 12px" }}>権限</th>
                <th style={{ padding: "10px 12px" }}>紐付け従業員</th>
                <th style={{ padding: "10px 12px" }}></th>
              </tr>
            </thead>
            <tbody>
              {unlinkedUsers.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: "8px 12px" }}>{u.email}</td>
                  <td style={{ padding: "8px 12px" }}>{u.name}</td>
                  <td style={{ padding: "8px 12px" }}>{USER_ROLE_LABEL[u.role] ?? u.role}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <select className="input" aria-label={`${u.email}の紐付け従業員`} value="" onChange={(e) => handleLinkChange(u, e.target.value)} style={{ minWidth: 160 }}>
                      <option value="">{u.role === "EMPLOYEE" ? "未設定（要設定）" : "なし"}</option>
                      {selectableFor(null).map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.fullName}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    <button
                      className="btn-danger"
                      onClick={() => setConfirmDelete({ kind: "user", user: u })}
                      disabled={u.id === session.user.id}
                      title={u.id === session.user.id ? "自分自身のアカウントは削除できません" : undefined}
                      style={{ padding: "5px 10px", minHeight: 30 }}
                    >
                      <Icon name="trash" size={14} />
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <EmployeeModal
          mode="create"
          isAdmin={isAdmin}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {editing && (
        <EmployeeModal
          mode="edit"
          emp={editing}
          account={userByEmployee.get(editing.id) ?? null}
          isAdmin={isAdmin}
          selfUserId={session.user.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDeleteEmployee={() => setConfirmDelete({ kind: "employee", emp: editing })}
          onDeleteAccount={(u) => setConfirmDelete({ kind: "user", user: u })}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        tone="danger"
        loading={busy}
        title={confirmDelete?.kind === "user" ? "アカウントを削除" : "従業員を削除"}
        confirmLabel="削除する"
        message={
          confirmDelete?.kind === "user"
            ? `アカウント「${confirmDelete.user.name}（${confirmDelete.user.email}）」を削除します。\n削除するとこのアカウントではログインできなくなります。\n（紐付いている従業員データ・シフトデータは削除されません）`
            : confirmDelete?.kind === "employee"
            ? `${confirmDelete.emp.fullName} さんを削除しますか？\nこの操作は元に戻せません。\n（紐付いているログインアカウントは残り、従業員の紐付けのみ解除されます）`
            : ""
        }
        onConfirm={runDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function EmployeeModal({
  mode, emp, account, isAdmin, selfUserId, onClose, onSaved, onDeleteEmployee, onDeleteAccount,
}: {
  mode: "create" | "edit";
  emp?: Employee;
  account?: User | null;
  isAdmin: boolean;
  selfUserId?: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleteEmployee?: () => void;
  onDeleteAccount?: (u: User) => void;
}) {
  const [fullName, setFullName] = useState(emp?.fullName ?? "");
  const [role, setRole] = useState<Role>(emp?.role ?? "STAFF");
  const [start, setStart] = useState(emp?.baseStartTime ?? "08:00");
  const [end, setEnd] = useState(emp?.baseEndTime ?? "17:00");
  const [contactEmail, setContactEmail] = useState(emp?.contactEmail ?? "");
  const [withAccount, setWithAccount] = useState(false);
  const [acc, setAcc] = useState<AccountDraft>(emptyAccount);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 既存の従業員にアカウントを後から作成する場合も、同じフォームを使う
  const showAccountForm = isAdmin && (mode === "create" ? withAccount : !account);
  const accountRequested = isAdmin && (mode === "create" ? withAccount : acc.email.trim() !== "");

  async function createAccount(employeeId: string) {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: acc.email.trim(), password: acc.password, role: acc.role, employeeId }),
    });
    if (!res.ok) throw new Error(await readError(res, "アカウントの作成に失敗しました"));
  }

  async function save() {
    if (!fullName.trim()) { setError("氏名を入力してください"); return; }
    if (accountRequested && (!acc.email.trim() || acc.password.length < 6)) { setError("ログインID（メール）と6文字以上の初期パスワードを入力してください"); return; }
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const res = await fetch("/api/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName.trim(), role, baseStartTime: start, baseEndTime: end, contactEmail: contactEmail.trim() || undefined }),
        });
        if (!res.ok) throw new Error("追加できませんでした（権限または入力内容を確認してください）");
        const created = await res.json();
        if (accountRequested) await createAccount(created.id);
      } else if (emp) {
        const res = await fetch(`/api/employees/${emp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName.trim(), baseStartTime: start || null, baseEndTime: end || null, contactEmail: contactEmail.trim() || null }),
        });
        if (!res.ok) throw new Error(await readError(res, "保存に失敗しました"));
        if (accountRequested) await createAccount(emp.id);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={mode === "create" ? "従業員を追加" : "従業員情報を編集"}
      size="lg"
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          {mode === "edit" && onDeleteEmployee && (
            <button className="btn-danger" style={{ marginRight: "auto" }} onClick={onDeleteEmployee} data-testid="btn-delete-employee">
              <Icon name="trash" />
              従業員を削除
            </button>
          )}
          <button className="btn-secondary" onClick={onClose} disabled={saving}><Icon name="x" />キャンセル</button>
          <button className="btn" onClick={save} disabled={saving} data-testid="btn-save-employee">
            <Icon name="save" />
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label className="label" htmlFor="emp-name">氏名</label>
          <input id="emp-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="emp-role">役割</label>
          {mode === "create" ? (
            <select id="emp-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <input id="emp-role" className="input" value={ROLE_LABEL[role]} disabled />
          )}
        </div>
        <div>
          <label className="label" htmlFor="emp-start">基本勤務時間（開始）</label>
          <input id="emp-start" className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="emp-end">基本勤務時間（終了）</label>
          <input id="emp-end" className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="emp-mail">連絡先メールアドレス（任意）</label>
          <input id="emp-mail" className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@example.com" />
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--color-border)" }} data-testid="account-section">
          <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>ログインアカウント</h3>
          {mode === "edit" && account && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>ログインID: <strong>{account.email}</strong></span>
              <span>権限: <strong>{USER_ROLE_LABEL[account.role] ?? account.role}</strong></span>
              <button
                className="btn-danger"
                style={{ marginLeft: "auto" }}
                onClick={() => onDeleteAccount?.(account)}
                disabled={account.id === selfUserId}
                title={account.id === selfUserId ? "自分自身のアカウントは削除できません" : undefined}
              >
                <Icon name="trash" />
                アカウントを削除
              </button>
            </div>
          )}
          {mode === "create" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input type="checkbox" checked={withAccount} onChange={(e) => setWithAccount(e.target.checked)} data-testid="chk-with-account" />
              ログインアカウントも作成する
            </label>
          )}
          {mode === "edit" && !account && <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 10px" }}>ログインアカウントはまだありません。</p>}
          {showAccountForm && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div>
                <label className="label" htmlFor="acc-email">ログインID（メールアドレス）</label>
                <input id="acc-email" className="input" type="email" value={acc.email} onChange={(e) => setAcc({ ...acc, email: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="acc-pass">初期パスワード（6文字以上）</label>
                <input id="acc-pass" className="input" type="text" value={acc.password} onChange={(e) => setAcc({ ...acc, password: e.target.value })} minLength={6} />
              </div>
              <div>
                <label className="label" htmlFor="acc-role">権限</label>
                <select id="acc-role" className="input" value={acc.role} onChange={(e) => setAcc({ ...acc, role: e.target.value as AccountDraft["role"] })}>
                  <option value="EMPLOYEE">従業員（閲覧のみ）</option>
                  <option value="INC">INC（シフト管理者）</option>
                  <option value="ADMIN">管理者</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}
