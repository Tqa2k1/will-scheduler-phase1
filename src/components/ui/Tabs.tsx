"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = { id: string; label: string; badge?: ReactNode; disabled?: boolean };

type Props = {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
};

/** 切り替えタブ（表示内容の出し分けは呼び出し側で行う）。左右キーで移動できる。 */
export default function Tabs({ items, value, onChange, ariaLabel }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    if (idx < 0) return;
    const next = enabled[(idx + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
    e.preventDefault();
  }

  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          ref={(el) => { refs.current[item.id] = el; }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}
