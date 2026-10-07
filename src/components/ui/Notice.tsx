import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type NoticeTone = "info" | "success" | "warning" | "error";

const ICONS: Record<NoticeTone, IconName> = { info: "info", success: "check", warning: "alert", error: "alert" };

type Props = { tone?: NoticeTone; title?: string; children: ReactNode; className?: string };

/** ページ内に残しておくメッセージ（処理結果・注意事項）。一時的な通知は Toast を使う。 */
export default function Notice({ tone = "info", title, children, className }: Props) {
  return (
    <div className={["ui-notice", `ui-notice--${tone}`, className].filter(Boolean).join(" ")} role={tone === "error" ? "alert" : "status"}>
      <span className="ui-notice__icon"><Icon name={ICONS[tone]} size={16} /></span>
      <div className="ui-notice__body">
        {title && <p className="ui-notice__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}
