"use client";

import type { ReactNode } from "react";
import Modal from "./Modal";
import Button from "./Button";

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 削除など元に戻せない操作は "danger" */
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 確認ダイアログ（window.confirm の置き換え用。後続フェーズで既存の confirm() から順次移行する）。 */
export default function ConfirmDialog({
  open, title, message, confirmLabel = "確認", cancelLabel = "キャンセル", tone = "primary", loading = false, onConfirm, onCancel,
}: Props) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={onCancel}
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div style={{ whiteSpace: "pre-line" }}>{message}</div>
    </Modal>
  );
}
