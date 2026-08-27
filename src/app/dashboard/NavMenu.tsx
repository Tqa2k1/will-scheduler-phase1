"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

type NavLink = { href: string; label: string };

export default function NavMenu({ links, userName, roleLabel }: { links: NavLink[]; userName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleLogout() {
    // ブラウザを閉じて再度開いた際にログイン状態を復元させないためのフラグをクリア
    try {
      sessionStorage.removeItem("whill_session_active");
    } catch {
      // ignore
    }
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>☰</span>
        メニュー
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 240,
            padding: 8,
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)", marginBottom: 6 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{userName}</p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>{roleLabel}</p>
          </div>

          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "8px 10px",
                borderRadius: 6,
                fontSize: 14,
                color: "var(--color-text)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {link.label}
            </Link>
          ))}

          <div style={{ borderTop: "1px solid var(--color-border)", marginTop: 6, paddingTop: 6 }}>
            <button
              onClick={handleLogout}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                fontSize: 14,
                color: "var(--color-danger)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
