"use client";

import Link from "next/link";
import { useState } from "react";

type Props = {
  role: string;
};

export default function DashboardMenu({ role }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: 120,
          height: 42,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        ☰ メニュー
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 50,
            width: 220,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 100,
          }}
        >
          <MenuLink href="/roster">
            月間勤務表
          </MenuLink>

          <MenuLink
            href={`/schedule/${new Date()
              .toISOString()
              .slice(0, 10)}`}
          >
            日別スケジュール
          </MenuLink>

          <MenuLink href="/shift-requests">
            勤務希望申請
          </MenuLink>

          {role === "ADMIN" && (
            <>
              <MenuLink href="/shift-adjustment">
                シフト調整
              </MenuLink>

              <MenuLink href="/tasks">
                業務管理
              </MenuLink>

              <MenuLink href="/employees">
                従業員管理
              </MenuLink>

              <MenuLink href="/users">
                アカウント管理
              </MenuLink>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "12px 14px",
        borderRadius: 6,
        color: "#333",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}