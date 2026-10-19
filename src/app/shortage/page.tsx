"use client";

import { isManagerRole } from "@/lib/roles";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Notice from "@/components/ui/Notice";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import AskSteps from "@/components/ask/AskSteps";
import { nextMonthJst } from "@/lib/jst";
import Icon from "@/components/ui/Icon";

type Gap = { date: string; dateLabel: string; shiftLabel: string; required: number; current: number; requested: number; shortage: number; bandDetails: string[] };
type Preview = {
  month: string;
  deadline: { iso: string; label: string } | null;
  mailMode: "live" | "dry-run" | "test";
  gaps: Gap[];
  totalShortage: number;
  recipients: {
    total: number;
    willSend: string[];
    alreadySent: string[];
    previouslyFailed: { name: string; reason: string }[];
    excludedByAllowlist: string[];
    allowlistActive: boolean;
    skippedNoEmail: string[];
  };
  confirmedAt: string | null;
  notifiedAt: string | null;
};
type ConfirmResult = {
  confirmed: boolean;
  dateCount: number;
  totalShortage: number;
  notified: boolean;
  reason?: string;
  mode?: string;
  targetTotal?: number;
  sent?: number;
  alreadySent?: number;
  alreadySentNames?: string[];
  skippedNoEmail?: string[];
  excludedByAllowlist?: string[];
  failures?: { name: string; reason: string }[];
};

function defaultMonth() {
  return nextMonthJst();
}

const MODE_LABEL: Record<string, string> = {
  "dry-run": "dry-run（実際にはメールを送信しません）",
  test: "テスト送信（宛先をテスト用アドレスに差し替えて送信します）",
};

export default function ShortagePage() {
  const { data: session, status } = useSession();
  const [month, setMonth] = useState(defaultMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingNotify, setPendingNotify] = useState<boolean | null>(null); // 確認ダイアログ表示中（true=メール送信あり）

  async function loadPreview() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/shortage/preview?month=${month}`, { cache: "no-store" });
    setLoading(false);
    if (!res.ok) {
      setPreview(null);
      setError("不足状況の取得に失敗しました。");
      return;
    }
    setPreview(await res.json());
  }

  useEffect(() => {
    if (status === "authenticated" && isManagerRole(session.user.role)) {
      setResult(null);
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, month]);

  // 確認ダイアログの本文（何が起きるかを具体的に示して、誤操作を防ぐ）
  function confirmLines(notify: boolean): string {
    if (!preview) return "";
    const lines: string[] = [`${month} の人員不足を確定します。`, `不足: ${preview.gaps.length}件（合計 ${preview.totalShortage}名）`];
    if (notify) {
      lines.push(
        `1回目のGmailを、役割が「バイト」で、まだ送信されていない（または送信に失敗した）${preview.recipients.willSend.length}名 に送信します。`,
        `（送信済みのため再送しない: ${preview.recipients.alreadySent.length}名 / メール未登録でスキップ: ${preview.recipients.skippedNoEmail.length}名）`
      );
      if (preview.recipients.allowlistActive) lines.push("※ テスト用の送信先制限（MAIL_ALLOWLIST）が有効です。リスト外の方には送信されません。");
      if (preview.mailMode !== "live") lines.push(`※ ${MODE_LABEL[preview.mailMode]}`);
    } else {
      lines.push("メールは送信しません。");
    }
    return lines.join("\n");
  }

  async function runConfirm(notify: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/shortage/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, notify }),
    });
    setBusy(false);
    setPendingNotify(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "人員不足の確定に失敗しました。");
      return;
    }
    setResult(data);
    loadPreview();
  }

  if (status === "loading") return null;
  if (!session || !isManagerRole(session.user.role)) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>このページを表示する権限がありません。</p>
        <Link href="/dashboard">← ホームに戻る</Link>
      </div>
    );
  }

  // ---- 画面用の集計 ----
  const gapsCount = preview?.gaps.length ?? 0;
  const gapDates = new Set((preview?.gaps ?? []).map((g) => g.date));
  const requestedTotal = (preview?.gaps ?? []).reduce((sum, g) => sum + g.requested, 0);
  const alreadyConfirmed = !!preview?.confirmedAt;
  // 今の段階: 1=不足の確認 2=確定内容の確認（確定前） 3=確定・メール送信 4=完了
  const currentStep = !preview || loading ? 1 : result ? 4 : alreadyConfirmed && !(preview.recipients.willSend.length > 0 && gapsCount > 0) ? 4 : 2;
  const STEPS = [
    { label: "不足の確認", hint: "不足の日・シフト・人数を見る" },
    { label: "確定内容の確認", hint: "送信先・期限を確認する" },
    { label: "確定・メール送信", hint: "確認ダイアログのあとに実行" },
    { label: "完了", hint: "次はASK②・応募者の確認へ" },
  ];
  const NEXT: Record<number, string> = {
    1: "不足状況を読み込んでいます…",
    2: gapsCount === 0 ? "この月に人員不足はありません。メールを送らずに確定することもできます。" : `不足 ${gapsCount}件（${gapDates.size}日）を確認し、送信先に問題がなければ「人員不足を確定してGmail送信」を押してください。`,
    3: "確定を実行しています…",
    4: "不足の確定が完了しています。従業員の勤務希望が集まったら「応募者の確認・勤務者の確定」で勤務者を確定し、不足が残る場合は ASK② で調整します。",
  };

  return (
    <div className="app-page">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "ASK①" }]}
        title="ASK①（人員不足の確定）"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="対象月" />
            <button className="btn-secondary" onClick={loadPreview} disabled={loading}><Icon name="refresh" />{loading ? "確認中..." : "状況を再確認"}</button>
          </div>
        }
      />

      <AskSteps steps={STEPS} current={currentStep} />
      <Notice tone={currentStep === 4 ? "success" : "info"} title={currentStep === 4 ? "完了" : `今の段階：${STEPS[currentStep - 1].label}`}>
        <span data-testid="next-action">{NEXT[currentStep]}</span>
      </Notice>

      {preview && preview.mailMode !== "live" && (
        <div style={{ marginTop: 12 }}><Notice tone="warning">メール送信モード: {MODE_LABEL[preview.mailMode]}</Notice></div>
      )}
      {error && <div style={{ marginTop: 12 }}><Notice tone="error">{error}</Notice></div>}
      {result && (
        <div style={{ marginTop: 12 }} data-testid="confirm-result">
          <Notice tone="success" title={`人員不足を確定しました（不足あり: ${result.dateCount}日 / 合計 ${result.totalShortage}名）`}>
            {result.notified ? (
              <div style={{ whiteSpace: "pre-line" }}>
                送信対象 {result.targetTotal ?? 0}名 ／ 成功 {result.sent ?? 0}件{result.mode === "dry-run" ? "（dry-run: 実際には送信していません）" : ""} ／ 失敗 {result.failures?.length ?? 0}件 ／ スキップ{" "}
                {(result.skippedNoEmail?.length ?? 0) + (result.alreadySent ?? 0) + (result.excludedByAllowlist?.length ?? 0)}件
                {(result.failures?.length ?? 0) > 0 && (
                  <div style={{ color: "var(--color-danger)" }}>失敗: {result.failures!.map((f) => `${f.name}（${f.reason}）`).join("\n")}</div>
                )}
                {(result.skippedNoEmail?.length ?? 0) > 0 && <div>スキップ（メール未登録）: {result.skippedNoEmail!.join("、")}</div>}
                {(result.alreadySent ?? 0) > 0 && <div>スキップ（送信済みのため再送しない）: {result.alreadySentNames!.join("、")}</div>}
                {(result.excludedByAllowlist?.length ?? 0) > 0 && <div>スキップ（テスト用の送信先制限により対象外）: {result.excludedByAllowlist!.join("、")}</div>}
                {(result.failures?.length ?? 0) > 0 && <div>失敗した方は、もう一度「人員不足を確定してGmail送信」を押すと、失敗した方だけに再送します。</div>}
              </div>
            ) : (
              <div>{result.reason}</div>
            )}
          </Notice>
        </div>
      )}

      {loading && <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>確認中...</p>}

      {preview && !loading && (
        <>
          {/* ①不足の確認 */}
          <div className="ask-summary" style={{ marginTop: 16 }} data-testid="ask-summary">
            <div className="ask-summary__item"><div className="ask-summary__value" style={{ color: gapDates.size > 0 ? "var(--color-danger)" : undefined }}>{gapDates.size}日</div><div className="ask-summary__label">人員不足の日</div></div>
            <div className="ask-summary__item"><div className="ask-summary__value" style={{ color: preview.totalShortage > 0 ? "var(--color-danger)" : undefined }}>{preview.totalShortage}名</div><div className="ask-summary__label">不足人数の合計</div></div>
            <div className="ask-summary__item"><div className="ask-summary__value">{requestedTotal}名</div><div className="ask-summary__label">勤務希望（申請中）</div></div>
            <div className="ask-summary__item"><div className="ask-summary__value">{preview.recipients.willSend.length}名</div><div className="ask-summary__label">今回メールを送る人</div></div>
          </div>

          <h2 className="ask-section__title" style={{ margin: "24px 0 4px" }}><span className="ask-section__no">①</span>不足の確認</h2>
          <div className="card" style={{ padding: 0, marginBottom: 16, overflowX: "auto" }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>日付</th>
                  <th style={{ padding: "10px 12px" }}>時間帯</th>
                  <th style={{ padding: "10px 12px" }}>必要</th>
                  <th style={{ padding: "10px 12px" }}>確定</th>
                  <th style={{ padding: "10px 12px" }}>希望（申請中）</th>
                  <th style={{ padding: "10px 12px" }}>不足</th>
                </tr>
              </thead>
              <tbody>
                {preview.gaps.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>この月に人員不足はありません</td></tr>
                )}
                {preview.gaps.map((g, i) => (
                  <tr key={`${g.date}-${g.shiftLabel}-${i}`} data-testid="gap-row">
                    <td style={{ padding: "8px 12px" }}>{g.dateLabel}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {g.shiftLabel}
                      {g.bandDetails.length > 0 && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>不足時間帯: {g.bandDetails.join(" / ")}</div>}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{g.required}名</td>
                    <td style={{ padding: "8px 12px" }}>{g.current}名</td>
                    <td style={{ padding: "8px 12px" }}>{g.requested}名</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-danger)", fontWeight: 600 }}>{g.shortage}名</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ②確定内容の確認 */}
          <h2 className="ask-section__title" style={{ margin: "24px 0 4px" }}><span className="ask-section__no">②</span>確定内容の確認</h2>
          <div className="card" style={{ marginBottom: 16, fontSize: 13, display: "grid", gap: 8 }}>
            <div>登録期限: <strong>{preview.deadline?.label}</strong>（対象月の前月10日。期限後も登録は可能です）</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>1回目メールの送信状況:</span>
              <Badge tone="info">今回送信 {preview.recipients.willSend.length}名</Badge>
              <Badge tone="success">送信済み {preview.recipients.alreadySent.length}名（再送しません）</Badge>
              {preview.recipients.previouslyFailed.length > 0 && <Badge tone="error" icon="alert">前回失敗 {preview.recipients.previouslyFailed.length}名</Badge>}
              {preview.recipients.skippedNoEmail.length > 0 && <Badge tone="warning" icon="alert">メール未登録 {preview.recipients.skippedNoEmail.length}名</Badge>}
            </div>
            {preview.recipients.willSend.length > 0 && <div style={{ color: "var(--color-text-muted)" }}>送信先: {preview.recipients.willSend.join("、")}</div>}
            {preview.recipients.skippedNoEmail.length > 0 && <div style={{ color: "var(--color-danger)" }}>メール未登録のためスキップ: {preview.recipients.skippedNoEmail.join("、")}</div>}
            {preview.recipients.previouslyFailed.length > 0 && (
              <div style={{ color: "var(--color-danger)" }}>前回の送信に失敗: {preview.recipients.previouslyFailed.map((f) => `${f.name}（${f.reason}）`).join("、")}</div>
            )}
            {preview.confirmedAt && <div style={{ color: "var(--color-text-muted)" }}>最終確定: {new Date(preview.confirmedAt).toLocaleString("ja-JP")}</div>}
            {preview.notifiedAt && <div style={{ color: "var(--color-text-muted)" }}>1回目メール送信済み: {new Date(preview.notifiedAt).toLocaleString("ja-JP")}</div>}
          </div>

          {/* ③確定・メール送信 */}
          <h2 className="ask-section__title" style={{ margin: "24px 0 4px" }}><span className="ask-section__no">③</span>確定・メール送信</h2>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => setPendingNotify(false)} disabled={busy} data-testid="confirm-only"><Icon name="check" />
              メールを送らずに確定のみ
            </button>
            <button className="btn" onClick={() => setPendingNotify(true)} disabled={busy || preview.gaps.length === 0} data-testid="confirm-send"><Icon name="mail" />
              {busy ? "処理中..." : "人員不足を確定してGmail送信"}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingNotify !== null}
        title={pendingNotify ? "人員不足を確定してメールを送信しますか？" : "メールを送らずに人員不足を確定しますか？"}
        confirmLabel={pendingNotify ? "確定して送信する" : "確定する"}
        loading={busy}
        onCancel={() => setPendingNotify(null)}
        onConfirm={() => pendingNotify !== null && runConfirm(pendingNotify)}
        message={pendingNotify === null ? "" : confirmLines(pendingNotify)}
      />
    </div>
  );
}
