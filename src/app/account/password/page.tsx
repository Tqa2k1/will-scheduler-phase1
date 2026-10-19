"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Icon from "@/components/ui/Icon";

// パスワード変更（全ロール共通・自分自身のパスワードのみ）。旧「アカウント管理」画面内のフォームを独立させたもの。
// API（/api/users/change-password）と検証内容は従来どおり。
export default function PasswordPage() {
  const { data: session, status } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  if (status === "loading") return null;
  if (!session) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>ログインが必要です。</p>
        <Link href="/login">← ログイン画面へ</Link>
      </div>
    );
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
    const data = await res.json().catch(() => ({}));
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
    <div className="app-page">
      <PageHeader breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "パスワード変更" }]} title="パスワード変更" />
      <div className="card" style={{ maxWidth: 420 }}>
        <form onSubmit={handleChangePassword}>
          <label className="label" htmlFor="pw-current">現在のパスワード</label>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required style={{ marginBottom: 12 }} />

          <label className="label" htmlFor="pw-new">新しいパスワード</label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} style={{ marginBottom: 12 }} />

          <label className="label" htmlFor="pw-confirm">新しいパスワード（確認）</label>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} style={{ marginBottom: 12 }} />

          {pwError && <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>{pwError}</p>}
          {pwSuccess && <p role="status" style={{ color: "var(--color-ok)", fontSize: 13 }}>{pwSuccess}</p>}

          <button className="btn" type="submit" disabled={pwLoading}>
            <Icon name="lock" />
            {pwLoading ? "変更中..." : "パスワードを変更"}
          </button>
        </form>
      </div>
    </div>
  );
}
