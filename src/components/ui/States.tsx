import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import Button from "./Button";

/** 一覧などが空のときの表示。次にやることが分かるよう、操作を1つ添えられる。 */
export function EmptyState({
  title = "データがありません",
  description,
  icon = "inbox",
  action,
}: {
  title?: string;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="ui-state">
      <span className="ui-state__icon"><Icon name={icon} size={20} /></span>
      <p className="ui-state__title">{title}</p>
      {description && <p className="ui-state__desc">{description}</p>}
      {action && <div className="ui-state__action">{action}</div>}
    </div>
  );
}

/** 小さなスピナー + 文言（ボタン横・カード内などに置く）。 */
export function Loading({ label = "読み込み中..." }: { label?: string }) {
  return (
    <span className="ui-loading" role="status">
      <span className="ui-spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

/** ページ・カード全体の読み込み中表示。 */
export function LoadingState({ label = "読み込み中..." }: { label?: string }) {
  return (
    <div className="ui-state">
      <Loading label={label} />
    </div>
  );
}

/** 取得失敗などのエラー表示。再試行の操作を渡すと「再読み込み」ボタンが出る。 */
export function ErrorState({
  title = "エラーが発生しました",
  description = "しばらくしてからもう一度お試しください。",
  onRetry,
  retryLabel = "再読み込み",
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="ui-state ui-state--error" role="alert">
      <span className="ui-state__icon"><Icon name="alert" size={20} /></span>
      <p className="ui-state__title">{title}</p>
      {description && <p className="ui-state__desc">{description}</p>}
      {onRetry && (
        <div className="ui-state__action">
          <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  );
}
