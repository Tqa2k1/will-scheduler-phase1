"use client";

import { isManagerRole } from "@/lib/roles";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import AiAssistModal from "@/components/AiAssistModal";
import { nextMonthJst } from "@/lib/jst";
import Icon from "@/components/ui/Icon";

// INC（管理者）用: 勤務希望の一覧・フィルター・承認/却下・取消の承認・勤務者の一括確定。
// 従業員向けの機能は「勤務希望登録」(/shift-requests/register) と「勤務希望履歴」(/shift-requests/history)。
type Status = "INVITED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCEL_REQUESTED" | "CANCELED" | "NOT_SELECTED";
type Claim = {
  id: string; employeeId: string; employeeName: string; role: string; priorityOrder: number;
  date: string; dateLabel: string; shiftTypeId: string | null; shiftLabel: string;
  requestedStartTime: string | null; requestedEndTime: string | null; status: Status;
  decidedAt: string | null; decidedBy: string | null; cancelRequestedAt: string | null;
  meetsSlot: boolean; meetsReason: string | null; monthNetMinutes: number; monthDays: number;
};
type Slot = { key: string; date: string; dateLabel: string; shiftTypeId: string; shiftLabel: string; required: number; current: number; requested: number; shortage: number };
type Preview = {
  empty?: boolean; noop?: boolean; committed?: boolean; message?: string; signature: string; pendingCount: number;
  slots: { key: string; date: string; dateLabel: string; shiftLabel: string; need: number; applicants: number; assigned: { claimId: string; employeeName: string; override: { start: string; end: string } | null }[]; notSelected: { employeeName: string; reason: string }[]; held: { employeeName: string; reason: string }[]; remainingShortage: number }[];
  totals: { employeeId: string; employeeName: string; addedDays: number; addedMinutes: number; totalDays: number; totalMinutes: number }[];
  unfilled: { date: string; dateLabel: string; shiftLabel: string; shortage: number; applicants: number }[];
  counts: { approved: number; notSelected: number; held: number; unfilled: number };
};

const STATUS_LABEL: Record<Status, string> = {
  PENDING: "申請中", APPROVED: "確定済み", CANCEL_REQUESTED: "取消申請中", NOT_SELECTED: "不採用",
  CANCELED: "取消済み", REJECTED: "却下／辞退", INVITED: "招待中（未回答）",
};
const ROLE_LABEL: Record<string, string> = { INC: "INC", RESPONSIBLE: "責任者", STAFF: "社員", OJT: "OJT", CONTRACT: "契約社員", PARTTIME: "バイト" };
const hours = (m: number) => `${(m / 60).toFixed(1)}h`;
const th = { padding: "8px 10px", whiteSpace: "nowrap" as const };
const td = { padding: "6px 10px", verticalAlign: "top" as const };

export default function ShiftRequestsAdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [month, setMonth] = useState(nextMonthJst());
  const [claims, setClaims] = useState<Claim[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fDate, setFDate] = useState("");
  const [fShift, setFShift] = useState("");
  const [fEmp, setFEmp] = useState("");
  const [fStatus, setFStatus] = useState<string>("PENDING");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false); // この月の勤務希望登録を停止中か
  const [holdBusy, setHoldBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false); // AI依頼（勤務表の「AI依頼」と同じ機能）

  const isManager = isManagerRole(session?.user.role);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/shift-claims?month=${month}`, { cache: "no-store" });
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setClaims(data.claims ?? []);
    setSlots(data.slots ?? []);
    setStopped(!!data.registrationStopped);
  }

  async function toggleHold() {
    if (holdBusy) return;
    const next = !stopped;
    const label = month.replace("-", "年") + "月";
    const msg = next
      ? `${label}の勤務希望登録を停止します。\n停止中は従業員が新規登録・変更できません（登録済みのデータは削除されません。申請中の取消はできます）。\nよろしいですか？`
      : `${label}の勤務希望登録を再開します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    setHoldBusy(true);
    const res = await fetch("/api/shift-claims/registration-hold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, stopped: next }) });
    setHoldBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(`処理に失敗しました。\n${err?.error ?? ""}`);
      return;
    }
    setStopped(next);
    setBulkMsg(next ? `${label}の勤務希望登録を停止しました。` : `${label}の勤務希望登録を再開しました。`);
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    if (isManager) load();
    else router.replace("/shift-requests/register"); // 従業員は登録画面へ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isManager, month]);

  async function api(url: string, body?: unknown) {
    const res = await fetch(url, { method: body === undefined ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  }

  async function decide(id: string, decision: string, confirmMsg?: string) {
    if (busyId) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(id);
    const { ok, data } = await api(`/api/shift-claims/${id}`, { decision });
    setBusyId(null);
    if (!ok) alert(`処理に失敗しました。\n${data?.error ?? "しばらくしてから再度お試しください。"}`);
    load();
  }

  async function openPreview() {
    setBulkBusy(true);
    setBulkMsg(null);
    const res = await fetch("/api/shift-claims/bulk-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, dryRun: true }) });
    const data = await res.json().catch(() => null);
    setBulkBusy(false);
    if (!res.ok) { setBulkMsg(data?.error ?? "プレビューに失敗しました"); return; }
    if (data.empty) { setBulkMsg(data.message ?? "確定対象の勤務希望がありません"); return; }
    setPreview(data);
  }

  async function commit() {
    if (!preview || bulkBusy) return;
    if (!window.confirm(`勤務者を確定します（確定 ${preview.counts.approved}名分 / 不採用 ${preview.counts.notSelected}件）。\nよろしいですか？`)) return;
    setBulkBusy(true);
    const res = await fetch("/api/shift-claims/bulk-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, dryRun: false, signature: preview.signature }) });
    const data = await res.json().catch(() => null);
    setBulkBusy(false);
    setPreview(null);
    if (!res.ok) setBulkMsg(`確定に失敗しました（何も登録されていません）: ${data?.error ?? ""}`);
    else if (data.empty || data.noop) setBulkMsg(data.message ?? "確定対象の勤務希望がありません");
    else setBulkMsg(`勤務者を確定しました（確定 ${data.approved}名分 / 不採用 ${data.notSelected}件 / 未確定の枠 ${data.counts.unfilled}件）`);
    load();
  }

  const shiftOptions = useMemo(() => [...new Set(claims.map((c) => c.shiftLabel))].sort(), [claims]);
  const empOptions = useMemo(() => [...new Map(claims.map((c) => [c.employeeId, c.employeeName])).entries()], [claims]);
  const filtered = claims.filter(
    (c) => (!fDate || c.date === fDate) && (!fShift || c.shiftLabel === fShift) && (!fEmp || c.employeeId === fEmp) && (fStatus === "ALL" || c.status === fStatus)
  );

  // 募集枠ごとの応募状況（フィルター反映後の応募者）
  const slotRows = useMemo(() => {
    const map = new Map<string, { date: string; dateLabel: string; shiftLabel: string; slot?: Slot; list: Claim[] }>();
    for (const s of slots) if (!fDate || s.date === fDate) if (!fShift || s.shiftLabel === fShift) map.set(s.key, { date: s.date, dateLabel: s.dateLabel, shiftLabel: s.shiftLabel, slot: s, list: [] });
    for (const c of filtered) {
      const key = `${c.date}|${c.shiftTypeId ?? "-"}`;
      const row = map.get(key) ?? { date: c.date, dateLabel: c.dateLabel, shiftLabel: c.shiftLabel, list: [] };
      row.list.push(c);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shiftLabel.localeCompare(b.shiftLabel));
  }, [slots, filtered, fDate, fShift]);

  if (status === "loading") return null;
  if (!session || !isManager) return null;

  return (
    <div className="app-page app-page--wide">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "応募者の確認・勤務者の確定" }]}
        title="応募者の確認・勤務者の確定"
        actions={
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className={stopped ? "btn" : "btn-secondary"} onClick={toggleHold} disabled={holdBusy} data-testid="hold-toggle"><Icon name={stopped ? "play" : "pause"} />
            {holdBusy ? "処理中..." : stopped ? "登録を再開する" : "登録を停止する"}
          </button>
          <button className="btn-secondary" onClick={() => setAiOpen(true)} data-testid="ai-open"><Icon name="sparkles" /> AI依頼</button>
          <button className="btn" onClick={openPreview} disabled={bulkBusy}><Icon name="userCheck" />{bulkBusy ? "処理中..." : "勤務者を確定（プレビュー）"}</button>
        </div>
          </>
        }
      />

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }} data-testid="hold-status">
        <strong>{month.replace("-", "年")}月の勤務希望登録</strong>
        <span className={stopped ? "msg msg--warning" : "msg msg--info"} style={{ padding: "2px 10px", borderRadius: 999, fontWeight: 600 }}>{stopped ? "停止中" : "受付中"}</span>
        <span style={{ color: "var(--color-text-muted)" }}>
          {stopped ? "従業員は新規登録・変更ができません（申請中の取消はできます）。" : "従業員が勤務希望を登録・変更できます。"}
        </span>
      </div>
      {bulkMsg && <div className="card msg msg--info" role="status">{bulkMsg}</div>}

      {/* フィルター */}
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 13 }}>
        <input className="input" type="date" value={fDate} min={`${month}-01`} max={`${month}-31`} onChange={(e) => setFDate(e.target.value)} aria-label="日付" />
        <select className="input" value={fShift} onChange={(e) => setFShift(e.target.value)} aria-label="シフト・時間帯">
          <option value="">シフト・時間帯: すべて</option>
          {shiftOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={fEmp} onChange={(e) => setFEmp(e.target.value)} aria-label="従業員">
          <option value="">従業員: すべて</option>
          {empOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="ステータス">
          <option value="PENDING">申請中（確定待ち）</option>
          <option value="CANCEL_REQUESTED">取消申請中</option>
          <option value="APPROVED">確定済み（確定結果）</option>
          <option value="NOT_SELECTED">不採用</option>
          <option value="CANCELED">取消済み</option>
          <option value="REJECTED">却下／辞退</option>
          <option value="INVITED">招待中（未回答）</option>
          <option value="ALL">すべて</option>
        </select>
        <button className="btn-secondary" onClick={() => { setFDate(""); setFShift(""); setFEmp(""); setFStatus("PENDING"); }}><Icon name="x" />条件をクリア</button>
        {loading && <span style={{ color: "var(--color-text-muted)" }}>読み込み中...</span>}
      </div>

      {/* 募集枠ごとの応募状況 */}
      <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>募集枠ごとの応募状況</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 20 }}>
        <table style={{ width: "100%", minWidth: 620 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={th}>日付</th><th style={th}>時間帯</th><th style={th}>必要 / 確定 / 希望（申請中） / 不足</th><th style={th}>応募</th><th style={th}>応募者（当月確定済み実労働・優先順位）</th>
            </tr>
          </thead>
          <tbody>
            {slotRows.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>該当する枠・応募はありません</td></tr>}
            {slotRows.map((r) => (
              <tr key={`${r.date}-${r.shiftLabel}`} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={td}>{r.dateLabel}</td>
                <td style={td}>{r.shiftLabel}</td>
                <td style={td}>{r.slot ? <>{r.slot.required} / {r.slot.current} / {r.slot.requested} / <strong style={{ color: "var(--color-danger)" }}>{r.slot.shortage}</strong></> : <span style={{ color: "var(--color-text-muted)" }}>不足なし</span>}</td>
                <td style={td}>{r.list.length}人</td>
                <td style={td}>
                  {r.list.length === 0 ? "—" : r.list.map((c) => (
                    <div key={c.id}>{c.employeeName}（{hours(c.monthNetMinutes)}・優先{c.priorityOrder}）<span style={{ color: "var(--color-text-muted)" }}> {STATUS_LABEL[c.status]}</span></div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 応募一覧 */}
      <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>勤務希望一覧（{filtered.length}件）</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 900 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
              <th style={th}>従業員</th><th style={th}>日付</th><th style={th}>勤務帯</th><th style={th}>希望時間</th><th style={th}>当月確定済み実労働</th><th style={th}>優先順位</th><th style={th}>枠の条件</th><th style={th}>状態</th><th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>該当する勤務希望はありません</td></tr>}
            {filtered.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={td}>{c.employeeName}<div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{ROLE_LABEL[c.role] ?? c.role}</div></td>
                <td style={td}>{c.dateLabel}</td>
                <td style={td}>{c.shiftLabel}</td>
                <td style={td}>{c.requestedStartTime && c.requestedEndTime ? `${c.requestedStartTime}〜${c.requestedEndTime}` : "枠の全時間"}</td>
                <td style={td}>{hours(c.monthNetMinutes)}（{c.monthDays}日）</td>
                <td style={td}>{c.priorityOrder}</td>
                <td style={td} title={c.meetsReason ?? ""}>{c.meetsSlot ? "OK" : <span style={{ color: "var(--color-danger)" }}>未達（自動確定しない）</span>}</td>
                <td style={td}>{STATUS_LABEL[c.status]}{c.decidedBy && c.status !== "PENDING" && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{c.decidedBy}</div>}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {c.status === "PENDING" && (
                    <>
                      <button className="btn" disabled={!!busyId} onClick={() => decide(c.id, "APPROVED", `${c.employeeName}さんを ${c.dateLabel} ${c.shiftLabel} で確定します。よろしいですか？`)} style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }}><Icon name="check" />確定</button>
                      <button className="btn-danger" disabled={!!busyId} onClick={() => decide(c.id, "REJECTED", "この勤務希望を却下します。よろしいですか？")} style={{ padding: "5px 10px", fontSize: 12 }}><Icon name="x" />却下</button>
                    </>
                  )}
                  {c.status === "CANCEL_REQUESTED" && (
                    <>
                      <button className="btn" disabled={!!busyId} onClick={() => decide(c.id, "CANCEL_APPROVED", `${c.employeeName}さんの ${c.dateLabel} の勤務を取り消し、勤務表から削除します。よろしいですか？`)} style={{ padding: "5px 10px", fontSize: 12, marginRight: 6 }}><Icon name="check" />取消を承認</button>
                      <button className="btn-secondary" disabled={!!busyId} onClick={() => decide(c.id, "CANCEL_REJECTED", "取消申請を却下し、確定済みに戻します。よろしいですか？")} style={{ padding: "5px 10px", fontSize: 12 }}><Icon name="x" />取消を却下</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aiOpen && <AiAssistModal confirmMode monthStr={month} onClose={() => setAiOpen(false)} onApplied={load} />}

      {/* 一括確定のプレビュー */}
      {preview && (
        <div onClick={() => !bulkBusy && setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 8 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 880, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto" }}>
            <h3 style={{ marginTop: 0 }}>勤務者の一括確定 — プレビュー（{month}）</h3>
            <p style={{ fontSize: 13, margin: "0 0 8px" }}>
              確定 <strong>{preview.counts.approved}</strong>名分 ／ 不採用 <strong>{preview.counts.notSelected}</strong>件 ／ 条件未達で保留 <strong>{preview.counts.held}</strong>件 ／ 未確定（不足）の枠 <strong>{preview.counts.unfilled}</strong>件
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 640, fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}><th style={th}>日付</th><th style={th}>時間帯</th><th style={th}>不足</th><th style={th}>割り当て結果</th></tr></thead>
                <tbody>
                  {preview.slots.map((s) => (
                    <tr key={s.key} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={td}>{s.dateLabel}</td><td style={td}>{s.shiftLabel}</td><td style={td}>{s.need}名</td>
                      <td style={td}>
                        {s.assigned.map((a) => <div key={a.claimId}>✔ {a.employeeName}{a.override ? `（${a.override.start}〜${a.override.end}）` : ""}</div>)}
                        {s.notSelected.map((n, i) => <div key={i} style={{ color: "var(--color-text-muted)" }}>不採用: {n.employeeName}</div>)}
                        {s.held.map((h, i) => <div key={i} style={{ color: "var(--color-warn)" }}>保留: {h.employeeName}（{h.reason}）</div>)}
                        {s.remainingShortage > 0 && <div style={{ color: "var(--color-danger)", fontWeight: 600 }}>未確定（不足 {s.remainingShortage}名）</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 style={{ margin: "14px 0 6px" }}>従業員ごとの合計（当月・休憩控除後の実労働）</h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 480, fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}><th style={th}>従業員</th><th style={th}>今回追加</th><th style={th}>確定後の合計</th></tr></thead>
                <tbody>
                  {preview.totals.map((t) => (
                    <tr key={t.employeeId} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={td}>{t.employeeName}</td>
                      <td style={td}>+{t.addedDays}日 / +{hours(t.addedMinutes)}</td>
                      <td style={td}>{t.totalDays}日 / {hours(t.totalMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.unfilled.length > 0 && (
              <>
                <h4 style={{ margin: "14px 0 6px", color: "var(--color-danger)" }}>人員が足りない枠（未確定のまま維持）</h4>
                <div style={{ fontSize: 13 }}>{preview.unfilled.map((u, i) => <div key={i}>{u.dateLabel} {u.shiftLabel}：不足 {u.shortage}名（応募 {u.applicants}人）</div>)}</div>
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn-secondary" onClick={() => setPreview(null)} disabled={bulkBusy}><Icon name="x" />キャンセル</button>
              <button className="btn" onClick={commit} disabled={bulkBusy || (preview.counts.approved === 0 && preview.counts.notSelected === 0)}><Icon name="check" />{bulkBusy ? "確定中..." : "確定する"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
