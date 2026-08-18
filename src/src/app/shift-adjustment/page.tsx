"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type WindowStatus = {
  code: "早番" | "遅番" | "明番";
  startTime: string;
  endTime: string;
  requiredCount: number;
  actualCount: number;
  shortage: number;
};
type DateStatus = { date: string; windows: WindowStatus[] };

export default function ShiftAdjustmentPage() {
  const { data: session, status } = useSession();
  const [dates, setDates] = useState<DateStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/shift-adjustment");
    if (!res.ok) return;
    const data = await res.json();
    setDates(data.dates ?? []);
  }

  useEffect(() => {
    if (status === "authenticated" && session?.user.role === "ADMIN") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleAdjust(date: string, windowCode: string) {
    if (!confirm(`${date} の ${windowCode} について、出勤できそうな従業員へシフト調整メールを送信します。よろしいですか？`)) return;
    const key = `${date}-${windowCode}`;
    setSendingKey(key);
    setLoading(true);
    const res = await fetch("/api/shift-adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, windowCode }),
    });
    setLoading(false);
    setSendingKey(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      alert(data?.error ?? "送信に失敗しました");
      return;
    }
    if (data.sentCount === 0) {
      alert(data.message ?? "送信対象の候補者が見つかりませんでした");
    } else {
      alert(`${data.sentCount}名にメールを送信しました。${data.failedCount ? `（${data.failedCount}件送信失敗）` : ""}`);
    }
    load();
  }

  if (status === "loading") return null;
  if (!session) return null;
  if (session.user.role !== "ADMIN") {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>
        <p>この画面は管理者のみ利用できます。</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>シフト調整</h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: -8 }}>
        今後30日のうち、ダイヤ（早番/遅番/明番、各4名）の人員が不足している日を表示します。
        「シフト調整」を押すと、出勤できそうな従業員へ希望勤務(KIBO)登録を促すメールを送信します。
        送信するだけで自動的に配置されるわけではありません — 従業員がKIBO登録した後、
        「勤務希望申請」画面から管理者が確認・承認してください。
      </p>

      {dates.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>今後30日間、人員不足のダイヤはありません。</p>
        </div>
      )}

      {dates.map((d) => (
        <div key={d.date} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, marginTop: 0 }}>{d.date}</h3>
          <table style={{ width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                <th style={{ padding: "6px 8px" }}>ダイヤ</th>
                <th style={{ padding: "6px 8px" }}>時間</th>
                <th style={{ padding: "6px 8px" }}>必要人数</th>
                <th style={{ padding: "6px 8px" }}>出勤予定</th>
                <th style={{ padding: "6px 8px" }}>不足</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {d.windows.map((w) => (
                <tr key={w.code}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{w.code}</td>
                  <td style={{ padding: "6px 8px" }}>{w.startTime}〜{w.endTime}</td>
                  <td style={{ padding: "6px 8px" }}>{w.requiredCount}</td>
                  <td style={{ padding: "6px 8px" }}>{w.actualCount}</td>
                  <td style={{ padding: "6px 8px", color: w.shortage > 0 ? "var(--color-danger)" : "var(--color-ok)", fontWeight: 700 }}>
                    {w.shortage}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {w.shortage > 0 && (
                      <button
                        className="btn"
                        style={{ padding: "5px 10px", fontSize: 12 }}
                        disabled={loading}
                        onClick={() => handleAdjust(d.date, w.code)}
                      >
                        {sendingKey === `${d.date}-${w.code}` ? "送信中..." : "シフト調整"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
