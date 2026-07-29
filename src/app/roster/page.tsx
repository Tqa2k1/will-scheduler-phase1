"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { resolveWorkTime, formatTimeRange, STATUS_LABEL } from "@/lib/workTime";

type Employee = {
  id: string;
  fullName: string;
  baseStartTime: string | null;
  baseEndTime: string | null;
};
type ShiftType = { id: string; code: string; name: string; defaultStartTime: string; defaultEndTime: string };
type RotationPattern = { id: string; code: string; name: string };
type RosterEntry = {
  employeeId: string;
  workDate: string;
  shiftTypeId: string | null;
  status: "WORK" | "OFF" | "PAID_LEAVE" | "ADJUST_LEAVE";
  overrideStartTime: string | null;
  overrideEndTime: string | null;
  shiftType: ShiftType | null;
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

export default function RosterPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [patterns, setPatterns] = useState<RotationPattern[]>([]);

  const [editCell, setEditCell] = useState<{ employeeId: string; day: number } | null>(null);
  const [patternModalOpen, setPatternModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const monthStr = `${year}-${pad2(month)}`;
  const numDays = daysInMonth(year, month);
  const days = Array.from({ length: numDays }, (_, i) => i + 1);

  async function load() {
    const [rosterRes, shiftRes, patternRes] = await Promise.all([
      fetch(`/api/roster?month=${monthStr}`),
      fetch(`/api/shift-types`),
      fetch(`/api/rotation-patterns`),
    ]);
    if (rosterRes.ok) {
      const data = await rosterRes.json();
      setEmployees(data.employees);
      setEntries(data.entries);
    }
    if (shiftRes.ok) setShiftTypes(await shiftRes.json());
    if (patternRes.ok) setPatterns(await patternRes.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  const entryMap = useMemo(() => {
    const map = new Map<string, RosterEntry>();
    for (const e of entries) {
      const d = new Date(e.workDate).getUTCDate();
      map.set(`${e.employeeId}-${d}`, e);
    }
    return map;
  }, [entries]);

  function cellLabel(emp: Employee, entry: RosterEntry | undefined): string {
    if (!entry || entry.status !== "WORK") {
      return entry ? STATUS_LABEL[entry.status] : "";
    }
    const resolved = resolveWorkTime({
      overrideStartTime: entry.overrideStartTime,
      overrideEndTime: entry.overrideEndTime,
      shiftType: entry.shiftType,
      baseStartTime: emp.baseStartTime,
      baseEndTime: emp.baseEndTime,
    });
    return resolved ? formatTimeRange(resolved) : "出勤";
  }

  async function saveCell(payload: {
    employeeId: string;
    workDate: string;
    status: string;
    shiftTypeId: string | null;
    overrideStartTime: string | null;
    overrideEndTime: string | null;
  }) {
    await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditCell(null);
    load();
  }

  async function handleConfirmMonth() {
    if (!confirm(`${monthStr} の勤務シフトを確定し、メール登録済みの従業員に通知を送信します。よろしいですか？`)) return;
    setConfirming(true);
    const res = await fetch("/api/roster/confirm-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: monthStr }),
    });
    setConfirming(false);
    if (res.ok) {
      const data = await res.json();
      alert(`通知メールを送信しました（成功: ${data.sent}件 / 失敗: ${data.failed}件 / 対象: ${data.totalEligible}件）`);
    } else {
      alert("スケジュール確定に失敗しました。");
    }
  }

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ダッシュボードに戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>
          月間勤務表 — {year}年{month}月
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
          <input className="input" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
          {isAdmin && <button className="btn-secondary" onClick={() => setPatternModalOpen(true)}>パターン適用</button>}
          {isAdmin && (
            <button className="btn" onClick={handleConfirmMonth} disabled={confirming}>
              {confirming ? "送信中..." : "月間スケジュール確定"}
            </button>
          )}
          <a className="btn-secondary" href={`/api/export/roster-excel?month=${monthStr}`}>Excel出力</a>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 2 }}>氏名</th>
              {days.map((d) => {
                const wd = new Date(year, month - 1, d).getDay();
                const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
                return (
                  <th key={d} style={{ ...thStyle, minWidth: 56, color: wd === 0 ? "var(--color-danger)" : wd === 6 ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                    <Link href={`/schedule/${dateStr}`} style={{ color: "inherit" }}>
                      {d}<br /><span style={{ fontSize: 10 }}>{WEEKDAY_JP[wd]}</span>
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={{ ...tdStyle, position: "sticky", left: 0, background: "var(--color-surface)", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {emp.fullName}
                </td>
                {days.map((d) => {
                  const entry = entryMap.get(`${emp.id}-${d}`);
                  const label = cellLabel(emp, entry);
                  const isEditing = editCell?.employeeId === emp.id && editCell?.day === d;
                  return (
                    <td key={d} style={{ ...tdStyle, textAlign: "center", cursor: isAdmin ? "pointer" : "default", position: "relative" }}
                      onClick={() => isAdmin && setEditCell({ employeeId: emp.id, day: d })}
                    >
                      <span style={{ fontSize: 12, color: label === "公休" ? "var(--color-text-muted)" : "var(--color-text)" }}>
                        {label}
                      </span>
                      {isAdmin && isEditing && (
                        <CellEditor
                          employee={emp}
                          entry={entry}
                          shiftTypes={shiftTypes}
                          workDate={`${year}-${pad2(month)}-${pad2(d)}`}
                          onSave={saveCell}
                          onClose={() => setEditCell(null)}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 16 }}>
        セルをクリックすると編集できます。
        <Link href={`/schedule/${year}-${pad2(month)}-01`}> 日別スケジュール</Link>
        （例：<code>/schedule/2026-07-01</code>）で当日の詳細を編集できます。
      </p>

      {patternModalOpen && (
        <PatternModal
          employees={employees}
          patterns={patterns}
          defaultRangeStart={`${year}-${pad2(month)}-01`}
          defaultRangeEnd={`${year}-${pad2(month)}-${pad2(numDays)}`}
          onClose={() => setPatternModalOpen(false)}
          onApplied={() => {
            setPatternModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CellEditor({
  employee, entry, shiftTypes, workDate, onSave, onClose,
}: {
  employee: Employee;
  entry: RosterEntry | undefined;
  shiftTypes: ShiftType[];
  workDate: string;
  onSave: (payload: any) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(entry?.status ?? "WORK");
  const [shiftTypeId, setShiftTypeId] = useState(entry?.shiftTypeId ?? "");
  const [overrideStart, setOverrideStart] = useState(entry?.overrideStartTime ?? "");
  const [overrideEnd, setOverrideEnd] = useState(entry?.overrideEndTime ?? "");

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="card"
      style={{ position: "absolute", top: "100%", left: 0, zIndex: 30, width: 260, textAlign: "left", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
    >
      <label className="label">状態</label>
      <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ marginBottom: 10 }}>
        <option value="WORK">出勤</option>
        <option value="OFF">公休</option>
        <option value="PAID_LEAVE">有休</option>
        <option value="ADJUST_LEAVE">調整休</option>
      </select>

      {status === "WORK" && (
        <>
          <label className="label">シフト区分（任意）</label>
          <select className="input" value={shiftTypeId} onChange={(e) => setShiftTypeId(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="">未選択（基本勤務時間を使用）</option>
            {shiftTypes.map((s) => (
              <option key={s.id} value={s.id}>{s.code}（{s.defaultStartTime}〜{s.defaultEndTime}）</option>
            ))}
          </select>

          <label className="label">この日だけの時間変更（任意）</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input className="input" type="time" value={overrideStart} onChange={(e) => setOverrideStart(e.target.value)} />
            <input className="input" type="time" value={overrideEnd} onChange={(e) => setOverrideEnd(e.target.value)} />
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn-secondary" onClick={onClose}>キャンセル</button>
        <button
          className="btn"
          onClick={() =>
            onSave({
              employeeId: employee.id,
              workDate,
              status,
              shiftTypeId: status === "WORK" ? (shiftTypeId || null) : null,
              overrideStartTime: status === "WORK" ? (overrideStart || null) : null,
              overrideEndTime: status === "WORK" ? (overrideEnd || null) : null,
            })
          }
        >
          保存
        </button>
      </div>
    </div>
  );
}

function PatternModal({
  employees, patterns, defaultRangeStart, defaultRangeEnd, onClose, onApplied,
}: {
  employees: Employee[];
  patterns: RotationPattern[];
  defaultRangeStart: string;
  defaultRangeEnd: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [patternId, setPatternId] = useState(patterns[0]?.id ?? "");
  const [anchorDate, setAnchorDate] = useState(defaultRangeStart);
  const [rangeStart, setRangeStart] = useState(defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState(defaultRangeEnd);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleApply() {
    if (selectedIds.length === 0 || !patternId) return;
    setLoading(true);
    const res = await fetch("/api/roster/apply-pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeIds: selectedIds, rotationPatternId: patternId, anchorDate, rangeStart, rangeEnd }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setResultMsg(`${data.updatedCount}件を更新しました（保護のためスキップ: ${data.skippedCount}件）`);
      setTimeout(onApplied, 900);
    } else {
      setResultMsg("適用に失敗しました。");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>パターン適用</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          出勤・公休のサイクルのみを設定します（勤務時間は変更されません）。有休・調整休の日は保護され上書きされません。
        </p>

        <label className="label">対象従業員</label>
        <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 6, padding: 8, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={selectedIds.length === employees.length && employees.length > 0}
              onChange={(e) => setSelectedIds(e.target.checked ? employees.map((x) => x.id) : [])}
            />
            全員選択
          </label>
          {employees.map((emp) => (
            <label key={emp.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 2 }}>
              <input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => toggle(emp.id)} />
              {emp.fullName}
            </label>
          ))}
        </div>

        <label className="label">ローテーションパターン</label>
        <select className="input" value={patternId} onChange={(e) => setPatternId(e.target.value)} style={{ marginBottom: 12 }}>
          {patterns.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label className="label">基準日（サイクル1日目）</label>
        <input className="input" type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} style={{ marginBottom: 12 }} />

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="label">適用開始日</label>
            <input className="input" type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="label">適用終了日</label>
            <input className="input" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
          </div>
        </div>

        {resultMsg && <p style={{ fontSize: 13, color: "var(--color-accent)" }}>{resultMsg}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={handleApply} disabled={loading || selectedIds.length === 0}>
            {loading ? "適用中..." : "適用する"}
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 8px",
  textAlign: "center",
  fontSize: 12,
  color: "var(--color-text-muted)",
  background: "var(--color-surface-2)",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 13,
};
