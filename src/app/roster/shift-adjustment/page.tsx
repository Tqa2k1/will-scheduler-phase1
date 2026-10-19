"use client";

import { isManagerRole } from "@/lib/roles";

import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import AskSteps, { AskSection } from "@/components/ask/AskSteps";
import Notice from "@/components/ui/Notice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { monthStatusLabel, type MonthStatusInfo } from "@/lib/monthStatusShared";
import Icon from "@/components/ui/Icon";

type Candidate = { employeeId: string; employeeName: string; hasEmail: boolean; role: string };
type Invited = { employeeId: string; employeeName: string; status: string };
type Gap = {
  date: string;
  shiftTypeId: string;
  shiftTypeCode: string;
  shiftLabel: string;
  required: number;
  current: number;
  shortage: number;
  bandDetails?: string[];
  candidates: Candidate[];
  invited: Invited[];
};

type Recipient = {
  employeeId: string;
  fullName: string;
  email: string | null;
  status: "SENT" | "UNSENT" | "FAILED" | "NO_EMAIL";
  reason?: string;
};
type DeliveryPreview = { subject: string; text: string };
type DeliveryResult = {
  confirmed: boolean;
  reason: string | null;
  mode: string | null;
  totalEligible: number;
  sent: number;
  alreadySent: number;
  failed: number;
  skippedNoEmail: number;
  failures: { employeeId: string; employeeName: string; reason: string }[];
};

const RECIPIENT_LABEL: Record<Recipient["status"], { text: string; tone: "success" | "neutral" | "error" | "warning" }> = {
  SENT: { text: "送信済み", tone: "success" },
  UNSENT: { text: "未送信", tone: "neutral" },
  FAILED: { text: "送信失敗", tone: "error" },
  NO_EMAIL: { text: "メール未登録", tone: "warning" },
};

// 実際の回答状況をINC画面にそのまま表示するためのラベル（「送信した＝登録済み」にしない）
const INVITE_STATUS_LABEL: Record<string, string> = {
  INVITED: "招待メール送信済み（未回答）",
  PENDING: "本人が申請済み（承認待ち）",
  APPROVED: "本人が申請し承認済み",
  REJECTED: "本人が辞退／却下",
};

function gapKey(g: Gap) {
  return `${g.date}|${g.shiftTypeCode}`;
}

function ShiftAdjustmentContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const initialMonth = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

  const [month, setMonth] = useState(initialMonth);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "date|shiftCode|employeeId"
  const [sending, setSending] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [sentRecipients, setSentRecipients] = useState<{ employeeId?: string; employeeName: string; email: string }[]>([]);
  const [skippedNames, setSkippedNames] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [gapsLoaded, setGapsLoaded] = useState(false);
  const [gapsError, setGapsError] = useState(false);

  // ③④: 月の状態・メール配信（勤務シフト確定メール）
  const [monthStatus, setMonthStatus] = useState<MonthStatusInfo | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [mailMode, setMailMode] = useState<string>("dry-run");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<DeliveryResult | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  // keepResult=true: メール送信直後の再取得用。送信結果（送信先一覧）を消さずに画面の状態だけ更新する。
  async function runAdjustment(keepResult = false) {
    setLoading(true);
    setGapsError(false);
    if (!keepResult) {
      setGapsLoaded(false);
      setResultMsg(null);
      setSentRecipients([]);
      setSkippedNames([]);
    }
    const res = await fetch(`/api/roster/shift-adjustment?month=${month}`);
    setLoading(false);
    if (!res.ok) {
      setGapsError(true);
      if (!keepResult) setResultMsg("ASK②の実行に失敗しました。");
      return;
    }
    const data = await res.json();
    setGaps(data.gaps ?? []);
    setGapsLoaded(true);
    setPendingCount(data.pendingCount ?? 0);
    // 主にアルバイトのシフト調整に使う機能のため、デフォルトではアルバイト(PARTTIME)のみ選択状態にする。
    // INC・STAFF・契約社員など、それ以外は管理者が必要に応じて手動でチェックする。
    const initial = new Set<string>();
    for (const g of data.gaps ?? []) {
      for (const c of g.candidates) {
        if (c.role === "PARTTIME") initial.add(`${g.date}|${g.shiftTypeCode}|${c.employeeId}`);
      }
    }
    setSelected(initial);
  }

  // 月の状態・配信対象者・メールのプレビューを取得（メールは送信しない）
  async function loadDelivery(keepSelection = false) {
    const res = await fetch(`/api/roster/confirm-month?month=${month}`);
    if (!res.ok) return;
    const data = await res.json();
    setMonthStatus(data.monthStatus);
    setRecipients(data.recipients);
    setPreview(data.preview);
    setMailMode(data.mailMode);
    if (!keepSelection) {
      // 送信済み以外（未送信・送信失敗）を初期選択にする
      setChosen(new Set((data.recipients as Recipient[]).filter((r) => r.status === "UNSENT" || r.status === "FAILED").map((r) => r.employeeId)));
    }
  }

  // 月を開いたとき・切り替えたときに、状況（不足・状態・配信対象）を自動で確認する
  useEffect(() => {
    if (status !== "authenticated" || !session || !isManagerRole(session.user.role)) return;
    setDeliveryResult(null);
    setDeliveryError(null);
    runAdjustment();
    loadDelivery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, status]);

  function toggleRecipient(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deliver() {
    setDelivering(true);
    setDeliveryError(null);
    try {
      const ids = [...chosen];
      const resendSent = recipients.some((r) => r.status === "SENT" && chosen.has(r.employeeId));
      const res = await fetch("/api/roster/confirm-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, employeeIds: ids, resendAll: resendSent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setDeliveryError(data?.error && typeof data.error === "string" ? data.error : "メール配信に失敗しました。確定にはなっていません。");
        return;
      }
      setDeliveryResult(data);
      setMonthStatus(data.monthStatus);
      setRecipients(data.recipients);
      setChosen(new Set((data.recipients as Recipient[]).filter((r) => r.status === "UNSENT" || r.status === "FAILED").map((r) => r.employeeId)));
    } finally {
      setDelivering(false);
      setConfirmOpen(false);
    }
  }

  function toggle(gap: Gap, employeeId: string) {
    const key = `${gap.date}|${gap.shiftTypeCode}|${employeeId}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function sendEmails() {
    const selections: { employeeId: string; date: string; shiftLabel: string; shiftTypeId: string }[] = [];
    for (const g of gaps) {
      for (const c of g.candidates) {
        const key = `${g.date}|${g.shiftTypeCode}|${c.employeeId}`;
        if (selected.has(key)) {
          selections.push({
            employeeId: c.employeeId,
            date: g.date,
            shiftLabel: `${g.shiftTypeCode}（${g.shiftLabel}）`,
            shiftTypeId: g.shiftTypeId,
          });
        }
      }
    }
    if (selections.length === 0) {
      setResultMsg("送信対象が選択されていません。");
      return;
    }
    const people = new Set(selections.map((x) => x.employeeId)).size;
    if (!window.confirm(`選択した ${people}名 に、勤務可否を確認するGmailを個別に送信します（${selections.length}通）。\nよろしいですか？`)) return;
    setSending(true);
    const res = await fetch("/api/roster/shift-adjustment/send-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, selections }),
    });
    setSending(false);
    if (res.ok) {
      const data = await res.json();
      setResultMsg(
        `送信完了: 成功${data.sent}通（${data.sentPeople ?? 0}名） / メール未登録のためスキップ${data.skippedNoEmail}名 / 失敗${data.failed}通` +
          (data.mode === "dry-run" ? "\n※ dry-run: 実際にはメールを送信していません" : data.mode === "test" ? "\n※ テスト送信: 宛先をテスト用アドレスに差し替えています" : "") +
          (data.failures?.length ? `\n${data.failures.join("\n")}` : "")
      );
      // 同じ従業員が複数の日付で対象になっていても、1人につき1回だけ表示する
      const uniq = new Map<string, { employeeId?: string; employeeName: string; email: string }>();
      for (const r of (data.recipients ?? []) as { employeeId?: string; employeeName: string; email: string }[]) {
        uniq.set(r.employeeId ?? r.email, r);
      }
      setSentRecipients([...uniq.values()]);
      setSkippedNames([...new Set<string>(data.skippedNames ?? [])]);
      runAdjustment(true); // 送信結果（招待済み・未回答の状態）を画面に反映するため再取得する
    } else {
      const data = await res.json().catch(() => null);
      setResultMsg(`送信に失敗しました。${data?.detail || data?.error ? `\n詳細: ${data.detail || data.error}` : ""}`);
    }
  }

  // 送信対象として選択中の従業員（日付をまたいでも1人1回だけ）
  const selectedNames: string[] = [];
  {
    const seen = new Set<string>();
    for (const g of gaps) {
      for (const c of g.candidates) {
        if (selected.has(`${g.date}|${g.shiftTypeCode}|${c.employeeId}`) && !seen.has(c.employeeId)) {
          seen.add(c.employeeId);
          selectedNames.push(c.employeeName);
        }
      }
    }
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

  // ---- 状況の集計（①状況確認）----
  const shortageDates = new Set(gaps.filter((g) => g.shortage > 0).map((g) => g.date));
  const shortageTotal = gaps.reduce((sum, g) => sum + Math.max(0, g.shortage), 0);
  const unadjustedGaps = gaps.filter((g) => g.shortage > 0 && g.invited.length === 0); // まだ誰にも確認していない不足
  const confirmed = monthStatus?.status === "CONFIRMED";
  const needsRedelivery = !!monthStatus?.needsRedelivery;
  const deliverable = recipients.filter((r) => r.email);
  const sentCount = recipients.filter((r) => r.status === "SENT").length;
  const failedCount = recipients.filter((r) => r.status === "FAILED").length;

  // 今の段階: 1=状況確認 2=シフト調整 3=配信内容確認 4=メール配信 5=完了
  const currentStep = !gapsLoaded || !monthStatus ? 1 : gaps.length > 0 ? 2 : confirmed ? 5 : deliveryResult || failedCount > 0 ? 4 : 3;
  const STEPS = [
    { label: "状況確認", hint: "不足と月の状態を見る" },
    { label: "シフト調整", hint: "不足を埋める・勤務表を直す" },
    { label: "配信内容確認", hint: "宛先とメール文面を確認" },
    { label: "メール配信", hint: "配信して「確定」にする" },
  ];
  const NEXT_ACTION: Record<number, string> = {
    1: gapsError ? "不足状況を取得できませんでした。「状況を再確認」を押してやり直してください。" : "状況を読み込んでいます…",
    2: `人員が不足しているシフトが ${gaps.length}件（${shortageDates.size}日）あります。候補者へ勤務可否を確認するか、勤務表で調整してください。調整が済んだら「状況を再確認」を押してください。`,
    3: "不足はありません。配信先とメール文面を確認し、問題なければ「メール配信」へ進んでください。配信が完了すると「確定」になります。",
    4: "一部の宛先に配信できていません。失敗した宛先を確認して再送してください。全員に配信できるまで「確定」にはなりません。",
    5: needsRedelivery ? "再配信が必要です。" : "この月は確定済みです。確定後にシフトを修正した場合は「調整中」に戻り、再配信が必要になります。",
  };

  return (
    <div className="app-page">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "勤務表", href: "/roster" }, { label: "ASK②" }]}
        title="ASK②（シフト調整）"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="対象月" />
            <button className="btn-secondary" onClick={() => { runAdjustment(); loadDelivery(); }} disabled={loading}><Icon name="refresh" />
              {loading ? "確認中..." : "状況を再確認"}
            </button>
            <Link href={`/roster`} className="btn-secondary" style={{ textDecoration: "none" }}><Icon name="calendar" />勤務表を開く</Link>
          </div>
        }
      />

      <AskSteps steps={STEPS} current={currentStep} />
      <Notice tone={currentStep === 5 ? "success" : currentStep === 4 ? "warning" : "info"} title={currentStep === 5 ? "完了" : `今の段階：${STEPS[Math.min(currentStep, 4) - 1].label}`}>
        <span data-testid="next-action">{NEXT_ACTION[currentStep]}</span>
      </Notice>

      {/* 月の状態（調整中／確定） */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "16px 0" }} data-testid="month-status-card">
        <span style={{ fontWeight: 600 }}>{month.replace("-", "年")}月の状態</span>
        {monthStatus && (
          <Badge tone={confirmed ? "success" : "warning"} icon={confirmed ? "check" : "alert"}>
            <span data-testid="month-status-label">{monthStatusLabel(monthStatus)}</span>
          </Badge>
        )}
        {needsRedelivery && <Badge tone="error" icon="alert">再配信が必要</Badge>}
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {confirmed
            ? `従業員は全員分の確定シフトを閲覧できます${monthStatus?.confirmedAt ? `（確定: ${new Date(monthStatus.confirmedAt).toLocaleString("ja-JP")}）` : ""}`
            : needsRedelivery
              ? "確定後にシフトが修正されたため調整中に戻っています。再配信が完了するまで従業員にはシフトが表示されません。"
              : "メール配信が完了するまで、従業員には「調整中」とだけ表示され、シフトは見えません。"}
        </span>
      </div>

      {/* ①状況確認 */}
      <div className="ask-summary" data-testid="ask-summary">
        <div className="ask-summary__item"><div className="ask-summary__value" style={{ color: shortageDates.size > 0 ? "var(--color-danger)" : undefined }}>{shortageDates.size}日</div><div className="ask-summary__label">人員不足の日</div></div>
        <div className="ask-summary__item"><div className="ask-summary__value" style={{ color: shortageTotal > 0 ? "var(--color-danger)" : undefined }}>{shortageTotal}人</div><div className="ask-summary__label">不足人数の合計</div></div>
        <div className="ask-summary__item"><div className="ask-summary__value">{unadjustedGaps.length}件</div><div className="ask-summary__label">未調整の枠（誰にも未確認）</div></div>
        <div className="ask-summary__item"><div className="ask-summary__value">{pendingCount}件</div><div className="ask-summary__label">承認待ちの勤務希望</div></div>
      </div>

      {pendingCount > 0 && (
        <Notice tone="warning">
          この月に承認待ちの勤務希望が {pendingCount}件 あります。承認されるまで不足には反映されません。
          <Link href="/shift-requests" style={{ fontWeight: 600, marginLeft: 8 }}>応募者の確認・勤務者の確定へ →</Link>
        </Notice>
      )}

      <h2 className="ask-section__title" style={{ margin: "24px 0 4px" }}><span className="ask-section__no">①</span>状況確認</h2>
      {gapsLoaded && gaps.length === 0 && !loading && (
        <Notice tone="success">この月に人員が不足しているシフトはありません。</Notice>
      )}
      {!gapsLoaded && !gapsError && <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>読み込み中…</p>}
      {gapsError && <Notice tone="error">不足状況の取得に失敗しました。</Notice>}

      {resultMsg && (
        <div className="card msg msg--info msg--pre" role="status">
          {resultMsg}
          {sentRecipients.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>メール送信先（{sentRecipients.length}名）</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {sentRecipients.map((r, i) => (
                  <li key={r.employeeId ?? i}>
                    {r.employeeName} — {r.email}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skippedNames.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>メール未登録のため送信できなかった方（{skippedNames.length}名）</div>
              <div>{skippedNames.join("、")}</div>
            </div>
          )}
        </div>
      )}

      {gaps.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, marginBottom: 20, overflowX: "auto" }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>日付</th>
                  <th style={{ padding: "10px 12px" }}>シフト</th>
                  <th style={{ padding: "10px 12px" }}>必要人数</th>
                  <th style={{ padding: "10px 12px" }}>確定人数</th>
                  <th style={{ padding: "10px 12px" }}>希望人数（申請中）</th>
                  <th style={{ padding: "10px 12px" }}>不足</th>
                  <th style={{ padding: "10px 12px" }}>調整状況</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={gapKey(g)} data-testid="gap-row">
                    <td style={{ padding: "8px 12px" }}>{g.date}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {g.shiftTypeCode}（{g.shiftLabel}）
                      {g.bandDetails && g.bandDetails.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>不足時間帯: {g.bandDetails.join(" / ")}</div>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{g.required}人</td>
                    <td style={{ padding: "8px 12px" }}>{g.current}人</td>
                    <td style={{ padding: "8px 12px" }}>{g.invited.filter((i) => i.status === "PENDING").length}人</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-danger)", fontWeight: 600 }}>{g.shortage}人</td>
                    <td style={{ padding: "8px 12px" }}>
                      {g.invited.length === 0 ? <Badge tone="error" icon="alert">未調整</Badge> : <Badge tone="info" icon="info">確認中（{g.invited.length}名）</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="ask-section__title" style={{ margin: "24px 0 4px" }}><span className="ask-section__no">②</span>シフト調整</h2>
          {gaps.map((g) => (
            <div key={gapKey(g)} className="card" style={{ marginBottom: 12 }}>
              <p style={{ fontWeight: 600, marginTop: 0, marginBottom: 8 }}>
                {g.date} {g.shiftTypeCode}（{g.shiftLabel}） — 不足 {g.shortage}人
              </p>
              {g.invited.length > 0 && (
                <div style={{ marginBottom: 10, fontSize: 12, color: "var(--color-text-muted)" }}>
                  {g.invited.map((inv) => (
                    <div key={inv.employeeId}>
                      {inv.employeeName} — {INVITE_STATUS_LABEL[inv.status] ?? inv.status}
                    </div>
                  ))}
                </div>
              )}
              {g.candidates.length === 0 && (
                <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>対応可能な候補者がいません。</p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {g.candidates.map((c) => {
                  const key = `${g.date}|${g.shiftTypeCode}|${c.employeeId}`;
                  return (
                    <label key={c.employeeId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(g, c.employeeId)} />
                      {c.employeeName}
                      {!c.hasEmail && (
                        <span style={{ color: "var(--color-danger)", fontSize: 11 }}>（メール未登録）</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16 }}>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              送信対象: {selectedNames.length}名{selectedNames.length > 0 ? `（${selectedNames.join("、")}）` : ""}
            </span>
            <button className="btn" onClick={sendEmails} disabled={sending}><Icon name="mail" />
              {sending ? "送信中..." : "勤務可否を確認するメールを送信"}
            </button>
          </div>
        </>
      )}

      {/* ③配信内容確認 */}
      <h2 className="ask-section__title" style={{ margin: "32px 0 4px" }}><span className="ask-section__no">③</span>配信内容確認</h2>
      {gaps.length > 0 && (
        <Notice tone="warning">人員不足が残っています。このまま配信することもできますが、先に不足を解消することをおすすめします。</Notice>
      )}
      <div className="card" style={{ marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <strong>配信対象者（確定メール）</strong>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }} data-testid="recipient-counts">
            送信済み {sentCount}名 / 未送信 {recipients.filter((r) => r.status === "UNSENT").length}名 / 送信失敗 {failedCount}名 / メール未登録 {recipients.filter((r) => r.status === "NO_EMAIL").length}名
          </span>
        </div>
        {deliverable.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={deliverable.length > 0 && deliverable.every((r) => chosen.has(r.employeeId))}
              onChange={(e) => setChosen(e.target.checked ? new Set(deliverable.map((r) => r.employeeId)) : new Set())}
            />
            全員を選択
          </label>
        )}
        <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
          <table style={{ width: "100%" }}>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.employeeId} data-testid="recipient-row" data-status={r.status}>
                  <td style={{ padding: "6px 10px", width: 32 }}>
                    <input
                      type="checkbox"
                      aria-label={`${r.fullName}を送信対象にする`}
                      disabled={!r.email}
                      checked={chosen.has(r.employeeId)}
                      onChange={() => toggleRecipient(r.employeeId)}
                    />
                  </td>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.fullName}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--color-text-muted)" }}>{r.email ?? "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <Badge tone={RECIPIENT_LABEL[r.status].tone}>{RECIPIENT_LABEL[r.status].text}</Badge>
                    {r.reason && <div style={{ fontSize: 11, color: "var(--color-danger)" }}>{r.reason}</div>}
                  </td>
                </tr>
              ))}
              {recipients.length === 0 && (
                <tr><td style={{ padding: 12, color: "var(--color-text-muted)", fontSize: 13 }}>配信対象の従業員がいません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "8px 0 0" }}>
          全員（メール登録済み）に配信できたときだけ「確定」になります。送信対象を絞った場合、未送信の人が残る間は確定になりません。
        </p>

        {preview && (
          <div style={{ marginTop: 16 }}>
            <strong>メール文面のプレビュー</strong>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0" }}>件名: <span data-testid="preview-subject">{preview.subject}</span></div>
            <pre className="ask-mail-preview" data-testid="preview-body">{preview.text}</pre>
          </div>
        )}
      </div>

      {/* ④メール配信 */}
      <h2 className="ask-section__title" style={{ margin: "32px 0 4px" }}><span className="ask-section__no">④</span>メール配信</h2>
      {mailMode !== "live" && (
        <Notice tone="info">
          {mailMode === "dry-run" ? "開発モード（dry-run）です。実際にはメールを送信せず、ログに出力します。" : "テストモードです。宛先はテスト用アドレスに差し替えて送信します。"}
        </Notice>
      )}
      {deliveryError && <Notice tone="error">{deliveryError}</Notice>}
      {deliveryResult && (
        <div style={{ margin: "8px 0" }} data-testid="delivery-result">
          {deliveryResult.confirmed ? (
            <Notice tone="success" title="メール配信が完了し、この月を「確定」にしました">
              送信 {deliveryResult.sent}名{deliveryResult.alreadySent > 0 ? ` / 送信済み ${deliveryResult.alreadySent}名` : ""}
              {deliveryResult.skippedNoEmail > 0 ? ` / メール未登録 ${deliveryResult.skippedNoEmail}名` : ""}。従業員は全員分の確定シフトを閲覧できます。
            </Notice>
          ) : (
            <Notice tone="error" title="確定にはなっていません">
              {deliveryResult.reason === "NO_RECIPIENTS"
                ? "配信できる従業員（メールアドレス登録済み）がいません。"
                : deliveryResult.reason === "NOT_ALL_SENT"
                  ? "未送信の人が残っています。全員に配信すると確定になります。"
                  : deliveryResult.reason === "REVISED_DURING_DELIVERY"
                    ? "配信中にシフトが修正されました。もう一度配信してください。"
                    : `成功 ${deliveryResult.sent}名 / 失敗 ${deliveryResult.failed}名。失敗した宛先を確認し、再送してください（送信済みの人には再送しません）。`}
              {deliveryResult.failures.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {deliveryResult.failures.map((f) => (
                    <li key={f.employeeId}>{f.employeeName}：{f.reason}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 8 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>送信対象: {chosen.size}名</span>
        <button className="btn" data-testid="deliver-button" onClick={() => setConfirmOpen(true)} disabled={delivering || chosen.size === 0}><Icon name="mail" />
          {needsRedelivery ? "再配信する" : failedCount > 0 ? "失敗した宛先へ再送する" : "メール配信へ進む"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="勤務シフト確定メールを配信しますか？"
        confirmLabel={delivering ? "配信中…" : "配信する"}
        loading={delivering}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={deliver}
        message={
          `対象月: ${month.replace("-", "年")}月\n` +
          `送信先: ${chosen.size}名\n` +
          `件名: ${preview?.subject ?? ""}\n\n` +
          (gaps.length > 0 ? `⚠ 人員不足が ${gaps.length}件 残っています。\n` : "") +
          (mailMode === "dry-run" ? "※ 開発モード: 実際にはメールを送信しません。\n" : mailMode === "test" ? "※ テストモード: 宛先をテスト用アドレスに差し替えます。\n" : "") +
          "全員に配信できると、この月が「確定」になり、従業員がシフトを閲覧できるようになります。1通でも失敗した場合は確定になりません。"
        }
      />
    </div>
  );
}

export default function ShiftAdjustmentPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ShiftAdjustmentContent />
    </Suspense>
  );
}
