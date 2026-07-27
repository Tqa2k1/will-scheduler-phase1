"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

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

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("メールアドレスまたはパスワードが正しくありません。");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ width: 400 }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          勤務管理システム
        </h1>

        <p
          style={{
            color: "var(--color-text-muted)",
            marginTop: 0,
            marginBottom: 24,
            fontSize: 14,
            textAlign: "center",
          }}
        >
          勤務表・シフト管理システム
        </p>

        <label className="label" htmlFor="email">
          メールアドレス
        </label>

        <input
          id="email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ marginBottom: 16 }}
        />

        <label className="label" htmlFor="password">
          パスワード
        </label>

        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ marginBottom: 20 }}
        />

        {error && (
          <p
            style={{
              color: "var(--color-danger)",
              fontSize: 14,
              marginTop: -12,
              marginBottom: 16,
            }}
          >
            {error}
          </p>
        )}

        <button
          className="btn"
          type="submit"
          disabled={loading}
          style={{ width: "100%" }}
        >
          {loading ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}