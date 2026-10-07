"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

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

  // keepResult=true: メール送信直後の再取得用。送信結果（送信先一覧）を消さずに画面の状態だけ更新する。
  async function runAdjustment(keepResult = false) {
    setLoading(true);
    if (!keepResult) {
      setResultMsg(null);
      setSentRecipients([]);
      setSkippedNames([]);
    }
    const res = await fetch(`/api/roster/shift-adjustment?month=${month}`);
    setLoading(false);
    if (!res.ok) {
      if (!keepResult) setResultMsg("シフト調整の実行に失敗しました。");
      return;
    }
    const data = await res.json();
    setGaps(data.gaps ?? []);
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
        `送信完了: 成功${data.sent}名 / メール未登録のためスキップ${data.skippedNoEmail}名 / 失敗${data.failed}名` +
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
  if (!session || session.user.role !== "ADMIN") {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>このページを表示する権限がありません。</p>
        <Link href="/dashboard">← ダッシュボードに戻る</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/roster" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← 月間勤務表に戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>シフト調整</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn" onClick={() => runAdjustment()} disabled={loading}>
            {loading ? "確認中..." : "シフト調整を実行"}
          </button>
        </div>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        「シフト必要人数設定」で設定した必要人数（時間帯別の設定がある時間帯はそちらを優先）に対して不足している日を一覧表示します。
        22:00〜08:00のような日跨ぎシフトは開始日1件のシフトとして扱い、二重カウントしません。
        候補者は役割ごとの優先順位、および同じ役割内での従業員ごとの優先順位（従業員管理ページで設定）の順に表示されます。
        また、その日に既に依頼・申請済み（招待メール送信済み・返答待ち・承認済み・却下済みを含む）の従業員は候補者一覧に表示されず、
        代わりに回答状況を表示します。デフォルトではアルバイトのみチェック済みです。必要に応じて手動でチェックを追加・解除してください。
      </p>

      {resultMsg && (
        <div
          className="card"
          style={{ marginBottom: 16, background: "#eff6ff", borderColor: "#bfdbfe", fontSize: 13, whiteSpace: "pre-line" }}
        >
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

      {gaps.length === 0 && !loading && (
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          「シフト調整を実行」を押すと、この月の不足シフトが表示されます。
        </p>
      )}

      {gaps.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, marginBottom: 20 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>日付</th>
                  <th style={{ padding: "10px 12px" }}>シフト</th>
                  <th style={{ padding: "10px 12px" }}>必要人数</th>
                  <th style={{ padding: "10px 12px" }}>現在人数</th>
                  <th style={{ padding: "10px 12px" }}>不足</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={gapKey(g)}>
                    <td style={{ padding: "8px 12px" }}>{g.date}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {g.shiftTypeCode}（{g.shiftLabel}）
                      {g.bandDetails && g.bandDetails.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>不足時間帯: {g.bandDetails.join(" / ")}</div>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{g.required}人</td>
                    <td style={{ padding: "8px 12px" }}>{g.current}人</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-danger)", fontWeight: 600 }}>{g.shortage}人</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 16 }}>候補者の確認</h2>
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
            <button className="btn" onClick={sendEmails} disabled={sending}>
              {sending ? "送信中..." : "候補者に一括メール送信"}
            </button>
          </div>
        </>
      )}
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
