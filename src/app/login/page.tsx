"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SESSION_FLAG_KEY } from "../SessionGuard";

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
      setError("メールアドレスまたはパスワードが正しくありません。");
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, marginBottom: 4 }}>
          WHILL 勤務管理システム
        </h1>
        <p style={{ color: "var(--color-text-muted)", marginTop: 0, marginBottom: 24, fontSize: 14 }}>
          ログインして勤務スケジュールを管理
        </p>

        <label className="label" htmlFor="email">メールアドレス</label>
        <input id="email" className="input" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required style={{ marginBottom: 16 }} />

        <label className="label" htmlFor="password">パスワード</label>
        <input id="password" className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} required style={{ marginBottom: 20 }} />

        {error && (
          <p style={{ color: "var(--color-danger)", fontSize: 14, marginTop: -12, marginBottom: 16 }}>{error}</p>
        )}

        <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
