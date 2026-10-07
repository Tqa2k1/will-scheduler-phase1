import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "./Icon";

export type Breadcrumb = { label: string; href?: string };

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** 階層が深いページだけで使う */
  breadcrumbs?: Breadcrumb[];
  /** 右側の主な操作 */
  actions?: ReactNode;
};

/** すべてのページ共通の見出し領域（パンくず → タイトル → 説明 → 操作）。 */
export default function PageHeader({ title, description, breadcrumbs, actions }: Props) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header__main">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="ui-breadcrumb" aria-label="パンくずリスト">
            {breadcrumbs.map((b, i) => (
              <span key={`${b.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {b.href ? <Link href={b.href}>{b.label}</Link> : <span aria-current="page">{b.label}</span>}
                {i < breadcrumbs.length - 1 && <Icon name="chevronRight" size={12} />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__desc">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  );
}
