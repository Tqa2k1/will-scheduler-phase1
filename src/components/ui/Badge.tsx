import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "error";

type Props = {
  tone?: BadgeTone;
  /** 色だけに頼らないため、状態を表すバッジにはアイコンを付けること */
  icon?: IconName;
  children: ReactNode;
  className?: string;
};

export default function Badge({ tone = "neutral", icon, children, className }: Props) {
  return (
    <span className={["ui-badge", `ui-badge--${tone}`, className].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
