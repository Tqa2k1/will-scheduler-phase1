"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Candidate = { employeeId: string; employeeName: string };
type Gap = {
  date: string;
  shiftTypeId: string;
  shiftTypeCode: string;
  shiftLabel: string;
  required: number;
  current: number;
  shortage: number;
  candidates: Candidate[];
};

function gapKey(g: Gap) {
  return `${g.date}|${g.shiftTypeCode}`;
}

export default function ShiftAdjustmentPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const initialMonth = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

  const [month, setMonth] = useState(initialMonth);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "date|shiftCode|employeeId"
  const [sending, setSending] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  async function runAdjustment() {
    setLoading(true);
    setResultMsg(null);
    const res = await fetch(`/api/roster/shift-adjustment?month=${month}`);
    setLoading(false);
    if (!res.ok) {
      setResultMsg("シフト調整の実行に失敗しました。");
      return;
    }
    const data = await res.json();
    setGaps(data.gaps ?? []);
    // デフォルトで全候補者を選択状態にしておく（管理者がチェックを外して調整する）
    const initial = new Set<string>();
    for (const g of data.gaps ?? []) {
      for (const c of g.candidates) initial.add(`${g.date}|${g.shiftTypeCode}|${c.employeeId}`);
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
    const selections: { employeeId: string; date: string; shiftLabel: string }[] = [];
    for (const g of gaps) {
      for (const c of g.candidates) {
        const key = `${g.date}|${g.shiftTypeCode}|${c.employeeId}`;
        if (selected.has(key)) {
          selections.push({ employeeId: c.employeeId, date: g.date, shiftLabel: `${g.shiftTypeCode}（${g.shiftLabel}）` });
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
        `送信完了: 成功${data.sent}件 / メール未登録のためスキップ${data.skippedNoEmail}件 / 失敗${data.failed}件` +
          (data.failures?.length ? `\n${data.failures.join("\n")}` : "")
      );
    } else {
      setResultMsg("送信に失敗しました。");
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
          <button className="btn" onClick={runAdjustment} disabled={loading}>
            {loading ? "確認中..." : "シフト調整を実行"}
          </button>
        </div>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        08:00〜17:00・13:00〜22:00・22:00〜08:00 の各シフトについて、必要人数（各4名）に対して不足している日を一覧表示します。
        22:00〜08:00は開始日1件のシフトとして扱い、二重カウントしません。
      </p>

      {resultMsg && (
        <p style={{ fontSize: 13, color: "var(--color-accent)", whiteSpace: "pre-line" }}>{resultMsg}</p>
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
                    <td style={{ padding: "8px 12px" }}>{g.shiftTypeCode}（{g.shiftLabel}）</td>
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
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={sendEmails} disabled={sending}>
              {sending ? "送信中..." : "候補者に一括メール送信"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
