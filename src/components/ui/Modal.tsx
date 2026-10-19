"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Icon from "./Icon";
import Button from "./Button";

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** フッターの操作ボタン。右寄せで並ぶ */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** 処理中など、背景クリック・Esc で閉じさせたくない場合は false */
  dismissible?: boolean;
  children: ReactNode;
};

/** タイトル・本文・フッターの構成を統一したモーダル。内容に合わせて幅を選ぶ。 */
export default function Modal({ open, title, description, onClose, footer, size = "md", dismissible = true, children }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 親が毎回新しい関数を渡してもフォーカスや背景ロックがやり直されないよう、最新の onClose を ref で保持する
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissible) onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }}>
      <div
        ref={panelRef}
        className={["ui-modal", size !== "md" && `ui-modal--${size}`].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-modal__header">
          <div>
            <h2 className="ui-modal__title" id={titleId}>{title}</h2>
            {description && <p className="ui-modal__desc">{description}</p>}
          </div>
          {dismissible && (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="閉じる">
              <Icon name="x" size={16} />
            </Button>
          )}
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
