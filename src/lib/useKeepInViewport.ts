"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * 絶対配置のメニュー／ポップアップが画面（ビューポート）の外にはみ出さないようにする。
 * - 横: はみ出した分だけ translateX でずらす（PCなどで既に収まっている場合は何もしない）
 * - 縦: limitHeight=true のときだけ、画面に収まる高さに制限して内部スクロールにする
 * 画面の回転・リサイズ（portrait / landscape）のたびに再計算する。
 */
export function useKeepInViewport(
  ref: RefObject<HTMLElement>,
  active: boolean,
  options: { margin?: number; limitHeight?: boolean } = {}
) {
  const { margin = 8, limitHeight = false } = options;

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    function adjust() {
      if (!el) return;
      // いったん元の位置に戻してから測り直す
      el.style.transform = "";
      if (limitHeight) {
        el.style.maxHeight = "";
        el.style.overflowY = "";
      }

      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();

      let dx = 0;
      if (rect.right > vw - margin) dx = vw - margin - rect.right;
      if (rect.left + dx < margin) dx = margin - rect.left;
      if (dx !== 0) el.style.transform = `translateX(${Math.round(dx)}px)`;

      if (limitHeight) {
        const available = vh - Math.max(rect.top, margin) - margin;
        if (rect.height > available && available > 120) {
          el.style.maxHeight = `${Math.floor(available)}px`;
          el.style.overflowY = "auto";
        }
      }
    }

    adjust();
    window.addEventListener("resize", adjust);
    window.addEventListener("orientationchange", adjust);
    return () => {
      window.removeEventListener("resize", adjust);
      window.removeEventListener("orientationchange", adjust);
    };
  }, [ref, active, margin, limitHeight]);
}
