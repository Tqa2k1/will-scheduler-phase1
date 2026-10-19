"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";

type MyRequest = {
  id: string;
  workDate: string;
  status: "INVITED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCEL_REQUESTED" | "CANCELED" | "NOT_SELECTED";
  requestedAt: string;
  requestedStartTime: string | null;
  requestedEndTime: string | null;
  shiftType: { code: string; defaultStartTime: string; defaultEndTime: string } | null;
};

// 登録状態のラベル（現行の勤務希望申請画面の表記をそのまま使う）
const STATUS_LABEL: Record<MyRequest["status"], string> = {
  INVITED: "勤務の依頼あり（未回答）",
  PENDING: "承認待ち",
  APPROVED: "承認済み",
  REJECTED: "却下／辞退",
  CANCEL_REQUESTED: "取消申請中（INCの承認待ち）",
  CANCELED: "取消済み",
  NOT_SELECTED: "不採用",
};
const STATUS_COLOR: Record<MyRequest["status"], string> = {
  INVITED: "var(--color-warn)",
  PENDING: "var(--color-text-muted)",
  APPROVED: "var(--color-ok)",
  REJECTED: "var(--color-danger)",
  CANCEL_REQUESTED: "var(--color-warn)",
  CANCELED: "var(--color-text-muted)",
  NOT_SELECTED: "var(--color-text-muted)",
};

export default function HistoryPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [notLinked, setNotLinked] = useState(false);
  const [monthFilter, setMonthFilter] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      const res = await fetch("/api/shift-claims", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.myRequests ?? []);
      setNotLinked(!!data.notLinked);
    })();
  }, [status]);

  if (status === "loading") return null;
  if (!session) return null;

  const rows = [...requests]
    .map((r) => ({ ...r, date: new Date(r.workDate).toISOString().slice(0, 10) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
  const shown = monthFilter ? rows.filter((r) => r.date.startsWith(monthFilter)) : rows;

  function timeOf(r: MyRequest) {
    if (r.requestedStartTime && r.requestedEndTime) return `${r.requestedStartTime}〜${r.requestedEndTime}`;
    if (r.shiftType) return `${r.shiftType.defaultStartTime}〜${r.shiftType.defaultEndTime}`;
    return "—";
  }

  return (
    <div className="app-page">
      <PageHeader
        breadcrumbs={[{ label: "ホーム", href: "/dashboard" }, { label: "勤務希望履歴" }]}
        title="勤務希望履歴"
        actions={
          <>
            <select className="input" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="">すべての月</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
          </>
        }
      />


      {notLinked ? (
        <div className="card msg msg--warning" role="status">
          <p style={{ margin: 0 }}>このアカウントにはまだ従業員情報が紐付けられていません。管理者にお問い合わせください。</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: 13 }}>
                <th style={{ padding: "10px 12px" }}>登録日</th>
                <th style={{ padding: "10px 12px" }}>対象月</th>
                <th style={{ padding: "10px 12px" }}>日付</th>
                <th style={{ padding: "10px 12px" }}>勤務時間</th>
                <th style={{ padding: "10px 12px" }}>状態</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--color-text-muted)" }}>勤務希望の履歴はありません</td></tr>
              )}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "8px 12px" }}>{new Date(r.requestedAt).toLocaleDateString("ja-JP")}</td>
                  <td style={{ padding: "8px 12px" }}>{r.date.slice(0, 7)}</td>
                  <td style={{ padding: "8px 12px" }}>{r.date}</td>
                  <td style={{ padding: "8px 12px" }}>{timeOf(r)}</td>
                  <td style={{ padding: "8px 12px", color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
