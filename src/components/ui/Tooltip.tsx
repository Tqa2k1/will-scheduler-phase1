"use client";

import { useId, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type Props = {
  content: ReactNode;
  side?: "top" | "bottom";
  /** フォーカス可能な要素（ボタン・リンクなど）を1つ渡す */
  children: ReactElement<{ "aria-describedby"?: string }>;
};

/**
 * ホバー／フォーカスで表示する短い補足。CSS のみで動作する。
 * 注意: overflow が hidden/auto の親の内側では端で切れることがある。
 */
export default function Tooltip({ content, side = "top", children }: Props) {
  const id = useId();
  return (
    <span className={["ui-tooltip", side === "bottom" && "ui-tooltip--bottom"].filter(Boolean).join(" ")}>
      {isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children}
      <span role="tooltip" id={id} className="ui-tooltip__bubble">{content}</span>
    </span>
  );
}
