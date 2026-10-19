import { useEffect, useRef } from "react";

// タブに戻ってきた時（別タブ・別画面で従業員/業務を追加・削除・変更した直後など）に、
// 画面のデータを自動で再取得する。編集中の入力内容には触れない（load関数のみ呼ぶ）。
export function useRefetchOnFocus(load: () => void | Promise<void>, enabled = true) {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
