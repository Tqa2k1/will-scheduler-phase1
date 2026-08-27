"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";

// sessionStorage は「タブ/ウィンドウを閉じると自動的に消える」性質を利用し、
// 「ブラウザを閉じて再度開いた場合はログイン画面に戻す」を実現する。
// 同一タブ内でのページ遷移・リロードでは sessionStorage は保持されるため、
// 再ログインは不要（要求どおり）。
//
// 仕組み:
// 1) ログイン成功時に SESSION_FLAG_KEY を sessionStorage にセットする（login/page.tsx側）。
// 2) このコンポーネントは、認証済み(session.user あり)なのに SESSION_FLAG_KEY が無い場合、
//    「Cookieだけが残っている＝ブラウザを再度開いた」と判断し、強制的にサインアウトする。
export const SESSION_FLAG_KEY = "whill_session_active";

export default function SessionGuard() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;

    let hasFlag = false;
    try {
      hasFlag = sessionStorage.getItem(SESSION_FLAG_KEY) === "1";
    } catch {
      // sessionStorageが使えない環境では何もしない（安全側に倒してログイン状態を維持）
      return;
    }

    if (!hasFlag) {
      signOut({ callbackUrl: "/login" });
    }
  }, [status, session]);

  return null;
}
