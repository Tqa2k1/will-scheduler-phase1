"use client";

import { signOut } from "next-auth/react";
import Icon from "@/components/ui/Icon";

// ホーム画面のヘッダーに直接置くログアウトボタン（旧メニュー内の処理をそのまま移したもの）
export default function LogoutButton() {
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
    <button type="button" className="btn-secondary" onClick={handleLogout}>
      <Icon name="logout" />
      ログアウト
    </button>
  );
}
