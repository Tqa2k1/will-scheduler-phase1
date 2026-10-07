"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

type ToastTone = "success" | "error" | "warning" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string; title?: string };
type ShowOptions = { title?: string; duration?: number };

type ToastApi = {
  success: (message: string, opts?: ShowOptions) => void;
  error: (message: string, opts?: ShowOptions) => void;
  warning: (message: string, opts?: ShowOptions) => void;
  info: (message: string, opts?: ShowOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, IconName> = { success: "check", error: "alert", warning: "alert", info: "info" };
// 読み切れるよう、エラーは長めに表示する
const DEFAULT_DURATION: Record<ToastTone, number> = { success: 4000, info: 5000, warning: 7000, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string, opts?: ShowOptions) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, tone, message, title: opts?.title }]);
      timers.current.set(id, setTimeout(() => dismiss(id), opts?.duration ?? DEFAULT_DURATION[tone]));
    },
    [dismiss]
  );

  useEffect(() => {
    const current = timers.current;
    return () => current.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => show("success", m, o),
      error: (m, o) => show("error", m, o),
      warning: (m, o) => show("warning", m, o),
      info: (m, o) => show("info", m, o),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`ui-toast ui-toast--${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <span className="ui-toast__icon"><Icon name={ICONS[t.tone]} size={16} /></span>
            <div className="ui-toast__body">
              {t.title && <p className="ui-toast__title">{t.title}</p>}
              <p className="ui-toast__msg">{t.message}</p>
            </div>
            <button type="button" className="ui-toast__close" onClick={() => dismiss(t.id)} aria-label="閉じる">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Toast を表示する。ToastProvider（app/providers.tsx で設定済み）の内側で使うこと。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast は ToastProvider の内側で使用してください");
  return ctx;
}
