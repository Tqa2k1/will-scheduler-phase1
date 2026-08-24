"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type AvailableDate = { date: string; shortageCount: number };
type KiboOption = { date: string; shiftTypeId: string; shiftTypeCode: string; shiftLabel: string };
type MyRequest = { workDate: string; status: "PENDING" | "APPROVED" | "REJECTED" };
type PendingClaim = { id: string; workDate: string; status: string; employee: { fullName: string }; shiftType: { code: string; defaultStartTime: string; defaultEndTime: string } | null };

export default function ShiftRequestsPage() {
  const { data: session, status } = useSession();
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);
  const [kiboOptions, setKiboOptions] = useState<KiboOption[]>([]);
  const [selectedKibo, setSelectedKibo] = useState<Set<string>>(new Set());
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [notLinked, setNotLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [kiboSubmitting, setKiboSubmitting] = useState(false);

  async function load() {
    const res = await fetch("/api/shift-claims");
    if (!res.ok) return;
    const data = await res.json();
    if (session?.user.role === "ADMIN") {
      setPending(data.pending ?? []);
    } else {
      setAvailableDates(data.availableDates ?? []);
      setKiboOptions(data.kiboOptions ?? []);
      setMyRequests(data.myRequests ?? []);
      setNotLinked(!!data.notLinked);
    }
  }

  useEffect(() => {
    if (status === "authenticated") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleClaim(date: string) {
    setLoading(true);
    await fetch("/api/shift-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workDate: date }),
    });
    setLoading(false);
    load();
  }

  function toggleKibo(key: string) {
    setSelectedKibo((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submitKibo() {
    setKiboSubmitting(true);
    for (const option of kiboOptions) {
      const key = `${option.date}|${option.shiftTypeId}`;
      if (!selectedKibo.has(key)) continue;
      await fetch("/api/shift-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate: option.date, shiftTypeId: option.shiftTypeId }),
      });
    }
    setKiboSubmitting(false);
    setSelectedKibo(new Set());
    load();
  }

  async function handleDecision(id: string, decision: "APPROVED" | "REJECTED") {
    await fetch(`/api/shift-claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    load();
  }

  if (status === "loading") return null;
  if (!session) return null;

  const isAdmin = session.user.role === "ADMIN";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>勤務希望申請</h1>

      {isAdmin ? (
        <>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
            従業員からの勤務希望申請を確認し、承認または却下してください。承認すると自動的に月間勤務表に反映されます。
          </p>
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>従業員</th>
                  <th style={{ padding: "10px 12px" }}>希望日</th>
                  <th style={{ padding: "10px 12px" }}>シフト</th>
                  <th style={{ padding: "10px 12px" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>承認待ちの申請はありません</td></tr>
                )}
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: "8px 12px" }}>{p.employee.fullName}</td>
                    <td style={{ padding: "8px 12px" }}>{new Date(p.workDate).toISOString().slice(0, 10)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {p.shiftType ? `${p.shiftType.code}（${p.shiftType.defaultStartTime}〜${p.shiftType.defaultEndTime}）` : "未指定"}
                    </td>
                    <td style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
                      <button className="btn" onClick={() => handleDecision(p.id, "APPROVED")} style={{ padding: "5px 10px", fontSize: 12 }}>承認</button>
                      <button className="btn-danger" onClick={() => handleDecision(p.id, "REJECTED")} style={{ padding: "5px 10px", fontSize: 12 }}>却下</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : notLinked ? (
        <div className="card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
          <p style={{ margin: 0, color: "var(--color-warn)" }}>
            このアカウントにはまだ従業員情報が紐付けられていません。管理者にお問い合わせください。
          </p>
        </div>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
            人員が不足している日が表示されます。「申請」を押すと管理者に希望が送られます。管理者が承認するまで確定しません。
          </p>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>申請できる日</h2>
            {availableDates.length === 0 && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>現在、申請可能な日はありません。</p>
            )}
            {availableDates.map((d) => (
              <div key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                <span>{d.date}（不足 {d.shortageCount}名）</span>
                <button className="btn" onClick={() => handleClaim(d.date)} disabled={loading} style={{ padding: "5px 12px", fontSize: 12 }}>
                  申請
                </button>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>希望勤務登録（KIBO）</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -4 }}>
              管理者のシフト調整により、あなたが対応可能と判定されたシフトです。希望するものにチェックして送信してください。
              KIBOは自動で確定するものではなく、管理者が確認のうえ承認します。
            </p>
            {kiboOptions.length === 0 && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>現在、対応可能なシフトはありません。</p>
            )}
            {kiboOptions.map((o) => {
              const key = `${o.date}|${o.shiftTypeId}`;
              return (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
                  <input type="checkbox" checked={selectedKibo.has(key)} onChange={() => toggleKibo(key)} />
                  {o.date} {o.shiftTypeCode}（{o.shiftLabel}）
                </label>
              );
            })}
            {kiboOptions.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={submitKibo} disabled={kiboSubmitting || selectedKibo.size === 0}>
                  {kiboSubmitting ? "送信中..." : "KIBOする"}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 15, marginTop: 0 }}>自分の申請履歴</h2>
            {myRequests.length === 0 && <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>申請履歴はありません。</p>}
            {myRequests.map((r) => (
              <div key={r.workDate} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{new Date(r.workDate).toISOString().slice(0, 10)}</span>
                <span style={{
                  color: r.status === "APPROVED" ? "var(--color-ok)" : r.status === "REJECTED" ? "var(--color-danger)" : "var(--color-text-muted)",
                }}>
                  {r.status === "PENDING" ? "承認待ち" : r.status === "APPROVED" ? "承認済み" : "却下"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
