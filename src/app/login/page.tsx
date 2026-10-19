"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SESSION_FLAG_KEY } from "../SessionGuard";
import Icon from "@/components/ui/Icon";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.error) {
      // "CredentialsSignin" は「メールアドレスまたはパスワードの不一致」。それ以外はサーバー側の問題（DB接続・環境変数など）
      setError(
        res.error === "CredentialsSignin"
          ? "メールアドレスまたはパスワードが正しくありません。"
          : "ログイン処理でサーバーエラーが発生しました。DB接続・環境変数（.env）の設定を確認してください。"
      );
      return;
    }

    // このタブ/ウィンドウが開いている間だけ有効なフラグ。ブラウザを閉じると自動的に消える。
    try {
      sessionStorage.setItem(SESSION_FLAG_KEY, "1");
    } catch {
      // sessionStorageが使えない環境では無視（ログイン自体は継続）
    }

    router.push("/dashboard");
  }

  return (
    <main className="auth-shell">
      <form onSubmit={handleSubmit} className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Assign ロゴ" width={56} height={56} className="auth-brand__logo" />
          <div>
            <h1 id="login-title" className="auth-brand__name">Assign</h1>
            <p className="auth-brand__sub">ログインして勤務スケジュールを管理</p>
          </div>
        </div>

        <div className="auth-form">
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="email">メールアドレス</label>
            <input id="email" className="ui-input" type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="ui-field">
            <label className="ui-field__label" htmlFor="password">パスワード</label>
            <input id="password" className="ui-input" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="ui-btn ui-btn--primary ui-btn--block" type="submit" disabled={loading}><Icon name="arrowRight" />
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>
      </form>
    </main>
  );
}
