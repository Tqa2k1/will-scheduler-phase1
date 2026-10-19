"use client";

import { forwardRef, useId, cloneElement, isValidElement, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import Icon from "./Icon";

type InvalidProp = { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & InvalidProp>(function Input(
  { invalid, className, ...rest },
  ref
) {
  return <input ref={ref} className={["ui-input", className].filter(Boolean).join(" ")} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & InvalidProp>(function Select(
  { invalid, className, ...rest },
  ref
) {
  return <select ref={ref} className={["ui-select", className].filter(Boolean).join(" ")} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & InvalidProp>(function Textarea(
  { invalid, className, ...rest },
  ref
) {
  return <textarea ref={ref} className={["ui-textarea", className].filter(Boolean).join(" ")} aria-invalid={invalid || undefined} {...rest} />;
});

type FieldProps = {
  label: string;
  /** 補足説明（入力のヒントなど） */
  help?: ReactNode;
  /** エラーメッセージ。指定すると入力欄が error 状態になる */
  error?: ReactNode;
  required?: boolean;
  /** Input / Select / Textarea を1つ渡す。id・aria 属性は自動で付与される */
  children: ReactElement<{ id?: string; invalid?: boolean; "aria-describedby"?: string }>;
  className?: string;
};

/** ラベル・補足・エラーをまとめる入力欄ラッパー。 */
export function Field({ label, help, error, required, children, className }: FieldProps) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, { id, invalid: children.props.invalid ?? Boolean(error), "aria-describedby": describedBy })
    : children;

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required && <span className="ui-field__required">必須</span>}
      </label>
      {control}
      {error && (
        <p className="ui-field__error" id={errorId} role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
      {help && !error && (
        <p className="ui-field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}
