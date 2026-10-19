"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";

type AiChange = { employeeId?: string; employeeName: string; date: string; newStatus: "WORK" | "OFF" | "PAID_LEAVE" | "ADJUST_LEAVE" };

type Row = { employeeName: string; dateLabel: string; shiftLabel?: string; reason?: string; kind?: string };
type Weekly = { employeeName: string; weekStart: string; totalHours: number; limit: number | null };
type ConfirmPreview = {
  message: string; scope: unknown; pendingCount: number;
  result: { signature: string; approved: Row[]; notSelected: Row[]; held: Row[]; weekly: Weekly[] };
};
type ConfirmDone = { confirmed: Row[]; notConfirmed: Row[]; message: string };

const AI_STATUS_LABEL: Record<string, string> = { WORK: "出勤", OFF: "公休", PAID_LEAVE: "有休", ADJUST_LEAVE: "調整休" };

// 月間勤務表の「AI依頼」。勤務表画面と「応募者の確認・勤務者の確定」画面で共通に使う（同じAPI・同じプロンプト）。
// AIは変更案を返すだけで、勤務表に反映されるのは、INCが内容を確認して「適用」を押したものだけ。
export default function AiAssistModal({
  monthStr, employees = [], onClose, onApplied, confirmMode = false,
}: {
  confirmMode?: boolean; // true: 「応募者の確認・勤務者の確定」画面から。勤務希望の確定もAIに依頼できる
  monthStr: string;
  employees?: { id: string; fullName: string }[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [changes, setChanges] = useState<AiChange[]>([]);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  // 勤務希望の確定（AI依頼）: ① AIが確定案を作る（保存なし） → ② 「この内容で確定する」で既存の一括確定を実行
  const [kind, setKind] = useState<"roster" | "confirm">(confirmMode ? "confirm" : "roster");
  const [cPreview, setCPreview] = useState<ConfirmPreview | null>(null);
  const [cDone, setCDone] = useState<ConfirmDone | null>(null);
  const [cError, setCError] = useState<string | null>(null);
  const [cBusy, setCBusy] = useState(false);

  async function confirmPreview() {
    setCBusy(true); setCError(null); setCPreview(null); setCDone(null);
    const res = await fetch("/api/shift-claims/ai-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview", month: monthStr, prompt }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setCBusy(false);
    if (!res || !res.ok || !data?.result) { setCError(data?.error ?? "AIによる確定案の作成に失敗しました。"); return; }
    setCPreview(data);
  }
  async function confirmExecute() {
    if (!cPreview) return;
    if (!window.confirm(`${cPreview.result.approved.length}件の勤務希望を確定し、${cPreview.result.notSelected.length}件を不採用にします。よろしいですか？`)) return;
    setCBusy(true); setCError(null);
    const res = await fetch("/api/shift-claims/ai-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "execute", month: monthStr, signature: cPreview.result.signature, scope: cPreview.scope }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setCBusy(false);
    if (!res || !res.ok || !data?.ok) { setCError(data?.error ?? "確定処理に失敗しました。"); return; }
    setCDone(data); setCPreview(null);
    onApplied();
  }

  const employeeIdByName = new Map(employees.map((e) => [e.fullName, e.id]));

  async function handleSubmit() {
    setLoading(true);
    setResultMsg(null);
    setChanges([]);
    setAppliedKeys(new Set());
    const res = await fetch("/api/roster/ai-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: monthStr, prompt }),
    });
    setLoading(false);
    const data = await res.json().catch(() => null);
    setResultMsg(data?.message ?? "エラーが発生しました。");
    // バックエンドが提案してきた具体的な変更案（changes）を保持する。
    // 実際にDBへ反映するのは、管理者が「適用」を押した時のみ（AIが勝手に変更することはない）。
    setChanges(Array.isArray(data?.changes) ? data.changes : []);
  }

  async function applyChange(change: AiChange): Promise<boolean> {
    // APIが検証済みのemployeeIdを返す（同姓同名でも取り違えない）。無ければ氏名で探す。
    const employeeId = change.employeeId ?? employeeIdByName.get(change.employeeName);
    if (!employeeId) {
      alert(`従業員「${change.employeeName}」が見つかりません（名前が一致しないため適用できません）。`);
      return false;
    }
    const key = `${change.employeeId ?? change.employeeName}-${change.date}`;
    setApplyingKey(key);
    // 既存の月間勤務表セル編集と同じAPI（/api/roster）をそのまま利用する
    const res = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        workDate: change.date,
        status: change.newStatus,
        shiftTypeId: null,
        overrideStartTime: null,
        overrideEndTime: null,
      }),
    });
    setApplyingKey(null);
    if (!res.ok) {
      alert(`「${change.employeeName} — ${change.date}」を適用できませんでした。`);
      return false;
    }
    setAppliedKeys((prev) => new Set(prev).add(key));
    onApplied();
    return true;
  }

  async function applyAll() {
    const rest = changes.filter((c) => !appliedKeys.has(`${c.employeeId ?? c.employeeName}-${c.date}`)).length;
    if (rest === 0 || !window.confirm(`提案された変更 ${rest}件 をすべて勤務表に適用します。内容を確認済みですか？`)) return;
    for (const c of changes) {
      const key = `${c.employeeId ?? c.employeeName}-${c.date}`;
      if (appliedKeys.has(key)) continue;
      await applyChange(c);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>AI依頼</h2>
        {confirmMode && (
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 13 }}>
            <label><input type="radio" checked={kind === "confirm"} onChange={() => setKind("confirm")} /> 勤務希望の確定</label>
            <label><input type="radio" checked={kind === "roster"} onChange={() => setKind("roster")} /> 勤務表の調整案</label>
          </div>
        )}
        {kind === "confirm" ? (
          <ConfirmPane
            monthStr={monthStr} prompt={prompt} setPrompt={setPrompt} busy={cBusy} error={cError}
            preview={cPreview} done={cDone} onClose={onClose} onPreview={confirmPreview} onExecute={confirmExecute}
          />
        ) : (<>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          {monthStr} の勤務表について、AIが不足人員の補完・調整案を提案します。提案内容は一覧で確認し、
          「適用」を押したものだけが実際に勤務表に反映されます（AIが自動でデータベースを変更することはありません）。
        </p>

        <label className="label">依頼内容（任意）</label>
        <textarea
          className="input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ minHeight: 80, marginBottom: 12 }}
          placeholder="例：不足しているシフトを提案してほしい"
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn-secondary" onClick={onClose}><Icon name="x" />閉じる</button>
          <button className="btn" onClick={handleSubmit} disabled={loading}><Icon name="sparkles" />
            {loading ? "送信中..." : "AIに依頼する"}
          </button>
        </div>

        {resultMsg && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "pre-line", marginBottom: 12 }}>
            {resultMsg}
          </p>
        )}

        {changes.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="label" style={{ margin: 0 }}>提案された変更（{changes.length}件）</label>
              <button className="btn-secondary" onClick={applyAll} style={{ padding: "4px 10px", fontSize: 12 }}>
                <Icon name="check" />
                すべて適用
              </button>
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 6 }}>
              {changes.map((c) => {
                const key = `${c.employeeId ?? c.employeeName}-${c.date}`;
                const isApplied = appliedKeys.has(key);
                const employeeExists = !!c.employeeId || employeeIdByName.has(c.employeeName);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", borderBottom: "1px solid var(--color-border)", fontSize: 13,
                    }}
                  >
                    <span>
                      {c.employeeName} — {c.date} → <strong>{AI_STATUS_LABEL[c.newStatus] ?? c.newStatus}</strong>
                      {!employeeExists && <span style={{ color: "var(--color-danger)" }}>（従業員が見つかりません）</span>}
                    </span>
                    <button
                      className="btn-secondary"
                      onClick={() => applyChange(c)}
                      disabled={isApplied || applyingKey === key || !employeeExists}
                      style={{ padding: "3px 10px", fontSize: 12 }}
                    >
                      <Icon name="check" size={14} />
                      {isApplied ? "適用済み" : applyingKey === key ? "適用中..." : "適用"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        </>)}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "4px 8px", color: "var(--color-text-muted)", fontWeight: 500 };
const td: React.CSSProperties = { padding: "4px 8px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };

function RowTable({ title, rows, showReason }: { title: string; rows: Row[]; showReason?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="label">{title}（{rows.length}件）</label>
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 6 }}>
        <table style={{ width: "100%", fontSize: 12 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={td}>{r.employeeName}</td>
                <td style={td}>{r.dateLabel}{r.shiftLabel ? ` ${r.shiftLabel}` : ""}</td>
                {showReason && <td style={td}>{r.kind ? `[${r.kind}] ` : ""}{r.reason}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfirmPane({
  monthStr, prompt, setPrompt, busy, error, preview, done, onClose, onPreview, onExecute,
}: {
  monthStr: string; prompt: string; setPrompt: (v: string) => void; busy: boolean; error: string | null;
  preview: ConfirmPreview | null; done: ConfirmDone | null; onClose: () => void; onPreview: () => void; onExecute: () => void;
}) {
  return (
    <>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        {monthStr} の申請中の勤務希望を、AIが依頼内容（人・期間）を読み取り、既存の確定ルール（必要人数まで・労働時間の少ない人を優先・同日重複なし・バイトは週20時間まで）で選びます。
        まず確定案を表示し、「この内容で確定する」を押したときだけ実際に確定されます。
      </p>
      <label className="label">依頼内容（任意。空欄＝全員分）</label>
      <textarea className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 70, marginBottom: 12 }}
        placeholder="例：全員分の勤務希望を確定して。大川原さんだけ確定して。11/10までの分だけ確定して。" data-testid="ai-confirm-prompt" />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn-secondary" onClick={onClose}><Icon name="x" />閉じる</button>
        <button className="btn" onClick={onPreview} disabled={busy} data-testid="ai-confirm-preview"><Icon name="sparkles" />{busy && !preview ? "確認中..." : "AIに確定案を作らせる"}</button>
      </div>

      {error && <div className="card msg msg--error" role="alert" style={{ marginBottom: 10, fontSize: 13 }} data-testid="ai-confirm-error">{error}</div>}

      {preview && (
        <>
          <p style={{ fontSize: 13, whiteSpace: "pre-line" }}>{preview.message}</p>
          <RowTable title="確定予定" rows={preview.result.approved} />
          <RowTable title="不採用予定" rows={preview.result.notSelected} showReason />
          <RowTable title="確定できない（申請中のまま）" rows={preview.result.held} showReason />
          {preview.result.weekly.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label className="label">週ごとの労働時間（既存＋今回の確定分）</label>
              <table style={{ width: "100%", fontSize: 12 }}>
                <thead><tr><th style={th}>従業員</th><th style={th}>週（日曜〜）</th><th style={th}>合計</th></tr></thead>
                <tbody>
                  {preview.result.weekly.map((w, i) => (
                    <tr key={i}><td style={td}>{w.employeeName}</td><td style={td}>{w.weekStart}</td>
                      <td style={td}>{w.totalHours}h{w.limit ? ` / 上限${w.limit}h` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn" onClick={onExecute} disabled={busy || preview.result.approved.length + preview.result.notSelected.length === 0} data-testid="ai-confirm-execute">
              <Icon name="check" />{busy ? "確定中..." : "この内容で確定する"}
            </button>
          </div>
        </>
      )}

      {done && (
        <div data-testid="ai-confirm-done">
          <p className="msg msg--info card" style={{ fontSize: 13 }}>{done.message}</p>
          <RowTable title="確定した勤務希望" rows={done.confirmed} />
          <RowTable title="確定されなかった勤務希望（対象日と理由）" rows={done.notConfirmed} showReason />
        </div>
      )}
    </>
  );
}
