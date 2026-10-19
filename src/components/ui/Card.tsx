import type { HTMLAttributes, ReactNode } from "react";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** 見出し右側の操作ボタンなど */
  actions?: ReactNode;
  /** 表など、内側に余白を付けたくない場合 */
  flush?: boolean;
};

/** 面のまとまり。入れ子にしないこと。 */
export default function Card({ title, description, actions, flush = false, className, children, ...rest }: Props) {
  const hasHeader = title || description || actions;
  return (
    <section className={["ui-card", className].filter(Boolean).join(" ")} {...rest}>
      {hasHeader && (
        <header className="ui-card__header">
          <div>
            {title && <h2 className="ui-card__title">{title}</h2>}
            {description && <p className="ui-card__desc">{description}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </header>
      )}
      <div className={flush ? "ui-card__body ui-card__body--flush" : "ui-card__body"}>{children}</div>
    </section>
  );
}
