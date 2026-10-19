"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Notice from "@/components/ui/Notice";
import Icon from "@/components/ui/Icon";
import { nextMonthJst } from "@/lib/jst";

type Status = "INVITED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCEL_REQUESTED" | "CANCELED" | "NOT_SELECTED";
type Band = { shiftTypeId: string; shiftLabel: string; shortage: number; startTime: string; endTime: string; notice: string[]; overLimit: boolean };
type Claim = { id: string; status: Status; shiftTypeId: string | null; shiftLabel: string; startTime: string | null; endTime: string | null };
type Day = { date: string; totalShortage: number; working: boolean; myStatus: Status | null; myClaim: Claim | null; bands: Band[] };
type MyMonth = {
  notLinked?: boolean;
  employeeName?: string;
  deadline?: { iso: string; label: string } | null;
  pastDeadline?: boolean;
  registrationStopped?: boolean; // INCが対象月の登録を停止中
  confirmed?: boolean;
  days?: Day[];
  myWork?: { date: string; label: string }[];
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
const REGISTERABLE: (Status | null)[] = [null, "INVITED", "PENDING", "REJECTED", "CANCELED", "NOT_SELECTED"];

function defaultMonth() {
  return nextMonthJst(); // JST基準で「翌月」
}

// 新規登録・変更（申請中のみ）ができる日か
// 登録停止中（stopped）は新規登録・変更ができない（取消はできる）
function canRegister(d: Day, stopped = false) {
  return !stopped && !d.working && d.bands.length > 0 && REGISTERABLE.includes(d.myStatus);
}
// 日付をタップして何か操作（登録・変更・取消）ができるか
function canOpen(d: Day, stopped = false) {
  return canRegister(d, stopped) || d.myStatus === "PENDING" || d.myStatus === "APPROVED" || d.myStatus === "CANCEL_REQUESTED";
}

function statusLabel(d: Day) {
  switch (d.myStatus) {
    case "PENDING": return "登録済み（承認待ち）";
    case "APPROVED": return "確定済み";
    case "CANCEL_REQUESTED": return "取消申請中";
    case "CANCELED": return d.bands.length ? "" : "取消済み";
    case "NOT_SELECTED": return d.bands.length ? "" : "不採用";
  }
  if (d.working) return "出勤予定あり";
  return "";
}

function RegisterContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [month, setMonth] = useState(searchParams.get("month") ?? defaultMonth());
  const [data, setData] = useState<MyMonth | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/shift-claims/my-month?month=${month}`, { cache: "no-store" });
    setLoading(false);
    if (res.ok) setData(await res.json());
  }

  useEffect(() => {
    if (status === "authenticated") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, month]);

  if (status === "loading") return null;
  if (!session) return null;

  const [y, m] = month.split("-").map(Number);
  const numDays = new Date(y, m, 0).getDate();
  const firstWd = new Date(y, m - 1, 1).getDay();
  const dayMap = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const workMap = new Map((data?.myWork ?? []).map((w) => [w.date, w.label]));
  const cells: (number | null)[] = [...Array(firstWd).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)];
  const modalDay = modalDate ? dayMap.get(modalDate) : undefined;
  const stopped = !!data?.registrationStopped;

  return (
    <div className="app-page">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "勤務希望登録" }]}
        title="勤務希望登録"
        actions={
          <>
            <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </>
        }
      />

      
      {data?.notLinked ? (
        <div className="card msg msg--warning" role="status">
          <p style={{ margin: 0 }}>このアカウントにはまだ従業員情報が紐付けられていません。管理者にお問い合わせください。</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
            <div>氏名: <strong>{data?.employeeName ?? session.user.name}</strong></div>
            {data?.deadline && (
              <div>
                登録期限: <strong>{data.deadline.label}</strong>
                {data.pastDeadline && <span style={{ color: "var(--color-text-muted)" }}>（期限を過ぎていますが、登録は可能です）</span>}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Link href="/shift-requests/history" className="btn-secondary" style={{ minHeight: 30, padding: "3px 10px" }}>
                <Icon name="history" size={14} />
                勤務希望履歴
              </Link>
            </div>
          </div>

          {stopped && (
            <Notice tone="warning" title={`${y}年${m}月の勤務希望登録は現在停止中です`}>
              新規登録・変更はできません（登録済みの内容はそのまま残ります。申請中のものの取消はできます）。再開されるまでお待ちください。
            </Notice>
          )}

          {loading && <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>読み込み中...</p>}

          {data && !data.confirmed && !loading && (
            <div className="card" style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
              この月の人員不足はまだ確定されていません。管理者が確定すると、ここに不足日が表示されます。
            </div>
          )}

          {data?.confirmed && (
            <div className="card" style={{ padding: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
                {WEEKDAY_JP.map((w, i) => (
                  <div key={w} style={{ textAlign: "center", fontSize: 12, padding: 4, color: i === 0 ? "var(--color-danger)" : i === 6 ? "var(--color-accent)" : "var(--color-text-muted)" }}>{w}</div>
                ))}
                {cells.map((d, i) => {
                  if (d === null) return <div key={`b${i}`} />;
                  const date = `${month}-${String(d).padStart(2, "0")}`;
                  const info = dayMap.get(date);
                  const work = workMap.get(date);
                  const clickable = !!info && canOpen(info, stopped);
                  const shortageOpen = !!info && canRegister(info, stopped) && !info.myClaim?.status?.startsWith("PEND");
                  const label = info ? statusLabel(info) : "";
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && setModalDate(date)}
                      style={{
                        minHeight: 64,
                        padding: 4,
                        borderRadius: 6,
                        textAlign: "center",
                        fontSize: 12,
                        cursor: clickable ? "pointer" : "default",
                        background: shortageOpen ? "var(--color-error-bg)" : info || work ? "var(--color-surface-2)" : "var(--color-surface)",
                        border: `1px solid ${shortageOpen ? "var(--color-danger)" : clickable ? "var(--color-accent)" : "var(--color-border)"}`,
                        color: "var(--color-text)",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{d}</div>
                      {work && <div style={{ fontSize: 11, color: "var(--color-ok)", lineHeight: 1.3 }}>勤務 {work}</div>}
                      {info && (
                        <div style={{ fontSize: 11, color: shortageOpen ? "var(--color-danger)" : "var(--color-text-muted)", lineHeight: 1.3 }}>
                          {label || (info.totalShortage > 0 ? `人員不足 ${info.totalShortage}名` : "")}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {data.days && data.days.length === 0 && (
                <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>この月に人員不足の日はありません。</p>
              )}
            </div>
          )}
        </>
      )}

      {modalDate && modalDay && (
        <RegisterModal
          key={modalDate}
          date={modalDate}
          day={modalDay}
          stopped={stopped}
          onClose={() => setModalDate(null)}
          onDone={() => {
            setModalDate(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RegisterModal({ date, day, stopped, onClose, onDone }: { date: string; day: Day; stopped: boolean; onClose: () => void; onDone: () => void }) {
  const claim = day.myClaim;
  const editing = claim?.status === "PENDING";
  const firstOk = (editing && day.bands.find((b) => b.shiftTypeId === claim?.shiftTypeId)) || day.bands.find((b) => !b.overLimit);
  const [bandId, setBandId] = useState(firstOk?.shiftTypeId ?? "");
  const [startTime, setStartTime] = useState((editing && claim?.startTime) || firstOk?.startTime || "");
  const [endTime, setEndTime] = useState((editing && claim?.endTime) || firstOk?.endTime || "");
  const [submitting, setSubmitting] = useState(false); // 二重送信防止（処理中はボタンを無効化）
  const selected = day.bands.find((b) => b.shiftTypeId === bandId);
  const showForm = canRegister(day, stopped);

  function select(b: Band) {
    setBandId(b.shiftTypeId);
    setStartTime(b.startTime);
    setEndTime(b.endTime);
  }

  async function submit() {
    if (!bandId || !startTime || !endTime || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/shift-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workDate: date, shiftTypeId: bandId, requestedStartTime: startTime, requestedEndTime: endTime }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(`${editing ? "変更" : "登録"}に失敗しました。\n${err?.error ?? "しばらくしてから再度お試しください。"}`);
      return;
    }
    onDone();
  }

  async function cancel() {
    if (!claim || submitting) return;
    const approved = claim.status === "APPROVED";
    const msg = approved
      ? `${date} の確定済みの勤務の取消を申請します。\nINCが承認すると勤務表から削除されます。よろしいですか？`
      : `${date} の勤務希望を取り消します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    const res = await fetch(`/api/shift-claims/${claim.id}/cancel`, { method: "POST" });
    setSubmitting(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(`取消に失敗しました。\n${err?.error ?? "しばらくしてから再度お試しください。"}`);
      return;
    }
    onDone();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 380, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>勤務希望 — {date}</h3>

        {claim && (
          <div style={{ fontSize: 13, marginBottom: 12, padding: 8, background: "var(--color-surface-2)", borderRadius: 6 }}>
            現在の状態: <strong>{claim.status === "PENDING" ? "登録済み（承認待ち）" : claim.status === "APPROVED" ? "確定済み" : claim.status === "CANCEL_REQUESTED" ? "取消申請中（INCの承認待ち）" : ""}</strong>
            {claim.shiftLabel && <div>勤務帯: {claim.shiftLabel}</div>}
            {claim.startTime && claim.endTime && <div>希望時間: {claim.startTime}〜{claim.endTime}</div>}
          </div>
        )}

        {showForm && (
          <>
            <label className="label">不足している勤務帯{editing ? "（変更する場合は選び直してください）" : ""}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {day.bands.map((b) => (
                <label key={b.shiftTypeId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: b.overLimit ? 0.5 : 1 }}>
                  <input type="radio" name="band" disabled={b.overLimit} checked={bandId === b.shiftTypeId} onChange={() => select(b)} />
                  {b.shiftLabel}（{b.shortage}名不足）{b.overLimit && "※週20時間を超えるため登録できません"}
                </label>
              ))}
            </div>

            {selected && selected.notice.length > 0 && (
              <div style={{ color: "var(--color-danger)", fontSize: 12, marginBottom: 12 }}>
                {selected.notice.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}

            <label className="label">実際に勤務できる時間</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <span>〜</span>
              <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={onClose} disabled={submitting}><Icon name="x" />閉じる</button>
          {(claim?.status === "PENDING" || claim?.status === "APPROVED") && (
            <button className="btn-danger" onClick={cancel} disabled={submitting}><Icon name="trash" />
              {claim.status === "APPROVED" ? "取消を申請" : "取り消す"}
            </button>
          )}
          {showForm && (
            <button className="btn" onClick={submit} disabled={submitting || !bandId || !startTime || !endTime}><Icon name="save" />
              {submitting ? "送信中..." : editing ? "変更する" : "登録する"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
