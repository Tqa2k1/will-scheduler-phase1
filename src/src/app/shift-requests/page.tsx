"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type AvailableDate = { date: string; shortageCount: number };
type MyRequest = {
  workDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  desiredStartTime?: string | null;
  desiredEndTime?: string | null;
};
type PendingClaim = {
  id: string;
  workDate: string;
  status: string;
  desiredStartTime?: string | null;
  desiredEndTime?: string | null;
  employee: { fullName: string };
};
type KiboWindow = { targetMonth: string; isOpen: boolean; deadlineDay: number };

// 希望勤務(KIBO)で選べる3ダイヤ。src/lib/shiftWindowStaffing.ts の SHIFT_WINDOWS と同じ内容。
const KIBO_WINDOWS = [
  { code: "早番", start: "08:00", end: "17:00" },
  { code: "遅番", start: "13:00", end: "22:00" },
  { code: "明番", start: "22:00", end: "08:00" },
];

const STATUS_LABEL: Record<string, string> = { PENDING: "未確認", APPROVED: "確定", REJECTED: "却下" };

export default function ShiftRequestsPage() {
  const { data: session, status } = useSession();
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [allClaims, setAllClaims] = useState<PendingClaim[]>([]);
  const [kiboWindow, setKiboWindow] = useState<KiboWindow | null>(null);
  const [kiboDate, setKiboDate] = useState("");
  const [kiboWindowCode, setKiboWindowCode] = useState(KIBO_WINDOWS[0].code);
  const [notLinked, setNotLinked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/shift-claims");
    if (!res.ok) return;
    const data = await res.json();
    if (session?.user.role === "ADMIN") {
      setPending(data.pending ?? []);
      setAllClaims(data.all ?? []);
    } else {
      setAvailableDates(data.availableDates ?? []);
      setMyRequests(data.myRequests ?? []);
      setNotLinked(!!data.notLinked);
      setKiboWindow(data.kiboWindow ?? null);
      if (!kiboDate && data.kiboWindow) setKiboDate(`${data.kiboWindow.targetMonth}-01`);
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

  async function handleKiboSubmit() {
    if (!kiboDate) return;
    const w = KIBO_WINDOWS.find((x) => x.code === kiboWindowCode)!;
    setLoading(true);
    const res = await fetch("/api/shift-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workDate: kiboDate, desiredStartTime: w.start, desiredEndTime: w.end }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "登録に失敗しました");
      return;
    }
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
                  <th style={{ padding: "10px 12px" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>承認待ちの申請はありません</td></tr>
                )}
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: "8px 12px" }}>{p.employee.fullName}</td>
                    <td style={{ padding: "8px 12px" }}>{new Date(p.workDate).toISOString().slice(0, 10)}</td>
                    <td style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
                      <button className="btn" onClick={() => handleDecision(p.id, "APPROVED")} style={{ padding: "5px 10px", fontSize: 12 }}>承認</button>
                      <button className="btn-danger" onClick={() => handleDecision(p.id, "REJECTED")} style={{ padding: "5px 10px", fontSize: 12 }}>却下</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 15 }}>希望勤務（KIBO）登録一覧</h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
            従業員が登録した希望勤務（KIBO）の一覧です。KIBOは登録のみで、確定させるには上の「承認」操作が必要です。
          </p>
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 12px" }}>従業員</th>
                  <th style={{ padding: "10px 12px" }}>希望日</th>
                  <th style={{ padding: "10px 12px" }}>希望ダイヤ</th>
                  <th style={{ padding: "10px 12px" }}>状態</th>
                </tr>
              </thead>
              <tbody>
                {allClaims.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>登録はありません</td></tr>
                )}
                {allClaims.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: "8px 12px" }}>{c.employee.fullName}</td>
                    <td style={{ padding: "8px 12px" }}>{new Date(c.workDate).toISOString().slice(0, 10)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {c.desiredStartTime && c.desiredEndTime ? `${c.desiredStartTime}〜${c.desiredEndTime}` : "（時間帯指定なし）"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{STATUS_LABEL[c.status] ?? c.status}</td>
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
          <h2 style={{ fontSize: 15 }}>希望勤務（KIBO）登録</h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
            働きたい日とダイヤ（早番/遅番/明番）を選んで登録できます。KIBOは希望の登録のみで、
            自動的に確定するわけではありません。確定は管理者の承認をお待ちください。
            {kiboWindow && (
              <>
                <br />
                現在登録できるのは <strong>{kiboWindow.targetMonth}</strong> 分です
                （毎月{kiboWindow.deadlineDay}日まで受付。
                {kiboWindow.isOpen ? "現在受付中です。" : "今月の受付は締め切られました。"}）
              </>
            )}
          </p>
          <div className="card" style={{ marginBottom: 24, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>希望日</label>
              <input
                className="input"
                type="date"
                value={kiboDate}
                onChange={(e) => setKiboDate(e.target.value)}
                disabled={!kiboWindow?.isOpen}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>希望時間</label>
              <select
                className="input"
                value={kiboWindowCode}
                onChange={(e) => setKiboWindowCode(e.target.value)}
                disabled={!kiboWindow?.isOpen}
              >
                {KIBO_WINDOWS.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code}（{w.start}〜{w.end}）
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" onClick={handleKiboSubmit} disabled={loading || !kiboWindow?.isOpen}>
              KIBOする
            </button>
          </div>

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

          <div className="card">
            <h2 style={{ fontSize: 15, marginTop: 0 }}>自分の申請履歴</h2>
            {myRequests.length === 0 && <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>申請履歴はありません。</p>}
            {myRequests.map((r) => (
              <div key={r.workDate} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>
                  {new Date(r.workDate).toISOString().slice(0, 10)}
                  {r.desiredStartTime && r.desiredEndTime ? `（${r.desiredStartTime}〜${r.desiredEndTime}）` : ""}
                </span>
                <span style={{
                  color: r.status === "APPROVED" ? "var(--color-ok)" : r.status === "REJECTED" ? "var(--color-danger)" : "var(--color-text-muted)",
                }}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
