import type { HTMLAttributes, TableHTMLAttributes } from "react";

type Props = TableHTMLAttributes<HTMLTableElement> & {
  /** 見出し行を上に固定する（スクロールする親の中で有効） */
  stickyHeader?: boolean;
  /** 外側のスクロール用ラッパーに渡す属性 */
  wrapProps?: HTMLAttributes<HTMLDivElement>;
};

/**
 * 表。横に長い場合は外側のラッパー内で横スクロールする。
 * 数値列には className="ui-num"、中央揃えには "ui-center"、操作列の中身には
 * <div className="ui-actions"> を使う。
 */
export default function Table({ stickyHeader = false, wrapProps, className, children, ...rest }: Props) {
  const { className: wrapClass, ...wrapRest } = wrapProps ?? {};
  return (
    <div className={["ui-table-wrap", wrapClass].filter(Boolean).join(" ")} {...wrapRest}>
      <table className={["ui-table", stickyHeader && "ui-table--sticky", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </table>
    </div>
  );
}
