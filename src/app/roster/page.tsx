"use client";

import { isManagerRole } from "@/lib/roles";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { rosterCellParts } from "@/lib/workTime";
import { useKeepInViewport } from "@/lib/useKeepInViewport";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import Notice from "@/components/ui/Notice";
import Icon from "@/components/ui/Icon";
import AiAssistModal from "@/components/AiAssistModal";
import type { MonthStatusInfo } from "@/lib/monthStatusShared";
import { monthStatusLabel, orderSelfFirst } from "@/lib/monthStatusShared";

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

type ShortageBand = { shiftTypeId: string; shiftTypeCode: string; shiftLabel: string; shortage: number; notice?: string[] };
type ShortageInfo = { confirmed: boolean; confirmedAt?: string; shortagesByDate: Record<string, { totalShortage: number; bands: ShortageBand[] }> };

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

export default function RosterPage() {
  const { data: session } = useSession();
  const isAdmin = isManagerRole(session?.user.role);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [patterns, setPatterns] = useState<RotationPattern[]>([]);

  const [editCell, setEditCell] = useState<{ employeeId: string; day: number } | null>(null);
  const [patternModalOpen, setPatternModalOpen] = useState(false);
  const [monthlyAutoAssignOpen, setMonthlyAutoAssignOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [shortageInfo, setShortageInfo] = useState<ShortageInfo>({ confirmed: false, shortagesByDate: {} });
  // 月の状態（調整中／確定）。従業員は「確定」の月だけシフトを閲覧できる（APIも同じ条件でデータを絞っている）
  const [monthStatus, setMonthStatus] = useState<MonthStatusInfo | null>(null);
  const [selfEmployeeId, setSelfEmployeeId] = useState<string | null>(null);
  const [deliveryMsg, setDeliveryMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const monthStr = `${year}-${pad2(month)}`;
  const numDays = daysInMonth(year, month);
  const days = Array.from({ length: numDays }, (_, i) => i + 1);

  async function load() {
    const [rosterRes, shiftRes, patternRes, shortageRes] = await Promise.all([
      fetch(`/api/roster?month=${monthStr}`),
      isAdmin ? fetch(`/api/shift-types`) : Promise.resolve(null),
      isAdmin ? fetch(`/api/rotation-patterns`) : Promise.resolve(null),
      // 「人員不足」は管理者・INCの勤務表だけに表示する（従業員の勤務表では表示しない）
      isAdmin ? fetch(`/api/roster/shift-adjustment/confirm?month=${monthStr}`) : Promise.resolve(null),
    ]);
    if (rosterRes.ok) {
      const data = await rosterRes.json();
      setEmployees(data.employees);
      setEntries(data.entries);
      setMonthStatus(data.monthStatus ?? null);
      setSelfEmployeeId(data.selfEmployeeId ?? null);
    } else {
      setEmployees([]);
      setEntries([]);
      setMonthStatus(null);
    }
    if (shiftRes?.ok) setShiftTypes(await shiftRes.json());
    if (patternRes?.ok) setPatterns(await patternRes.json());
    if (shortageRes?.ok) setShortageInfo(await shortageRes.json());
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr, isAdmin]);

  // 従業員の表示順: ログイン本人を一番上、その後は氏名順（APIの並びを維持）
  const orderedEmployees = useMemo(() => (isAdmin ? employees : orderSelfFirst(employees, selfEmployeeId)), [employees, selfEmployeeId, isAdmin]);
  const isConfirmed = monthStatus?.status === "CONFIRMED";

  // 従業員管理などで従業員を追加・削除・変更してから戻った時に、最新の内容を自動で再取得する
  useRefetchOnFocus(load);

  const entryMap = useMemo(() => {
    const map = new Map<string, RosterEntry>();
    for (const e of entries) {
      const d = new Date(e.workDate).getUTCDate();
      map.set(`${e.employeeId}-${d}`, e);
    }
    return map;
  }, [entries]);

  async function saveCell(payload: {
    employeeId: string;
    workDate: string;
    status: string;
    shiftTypeId: string | null;
    overrideStartTime: string | null;
    overrideEndTime: string | null;
  }) {
    const res = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditCell(null);
    if (res.ok) {
      const data = await res.json();
      if (data.backfill && (data.backfill.backfilledSlots > 0 || data.backfill.unfilledSlots > 0)) {
        const b = data.backfill;
        let msg = "";
        if (b.backfilledSlots > 0) msg += `${b.backfilledSlots}件の業務を優先順位に従って自動的に他の人に振り替えました。`;
        if (b.unfilledSlots > 0) msg += `\n⚠ ${b.unfilledSlots}件は代わりが見つからず、人員不足のままです（アサイン表で赤色表示）。`;
        alert(msg);
      }
    }
    load();
  }

  async function handleConfirmMonth() {
    if (!confirm(`${monthStr} の勤務シフトをメール配信します。\n全員への配信が正常に完了すると「確定」になり、従業員がシフトを閲覧できるようになります。\nよろしいですか？\n（配信前の確認・送信先の選択は「ASK②」で行えます）`)) return;
    setConfirming(true);
    setDeliveryMsg(null);
    try {
      const res = await fetch("/api/roster/confirm-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: monthStr }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeliveryMsg({ kind: "error", text: "メール配信に失敗しました。確定にはなっていません。" });
      } else if (data.confirmed) {
        setDeliveryMsg({ kind: "ok", text: `メール配信が完了し、${monthStr} を「確定」にしました（送信 ${data.sent}件${data.alreadySent ? ` / 送信済み ${data.alreadySent}件` : ""}${data.mode === "dry-run" ? "・開発モードのため実際には送信していません" : ""}）。` });
      } else if (data.reason === "NO_RECIPIENTS") {
        setDeliveryMsg({ kind: "error", text: "配信できる従業員（メールアドレス登録済み）がいないため、確定にしていません。" });
      } else {
        setDeliveryMsg({ kind: "error", text: `送信に失敗した宛先があるため、確定にしていません（成功 ${data.sent}件 / 失敗 ${data.failed}件）。ASK②で失敗した宛先を確認して再送してください。` });
      }
    } finally {
      setConfirming(false);
      load();
    }
  }

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/dashboard" style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
        ← ホームに戻る
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 20px", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: 0 }}>
          勤務表 — {year}年{month}月
          {monthStatus && (
            <span
              style={{
                marginLeft: 12, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, verticalAlign: "middle",
                background: isConfirmed ? "var(--color-success-bg)" : "var(--color-warning-bg)",
                color: isConfirmed ? "var(--color-success-text)" : "var(--color-warning-text)",
                border: `1px solid ${isConfirmed ? "var(--color-success-text)" : "var(--color-warning-border)"}`,
              }}
              data-testid="month-status-badge"
            >
              {isAdmin ? monthStatusLabel(monthStatus) : isConfirmed ? "確定" : "調整中"}
            </span>
          )}
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}月</option>
            ))}
          </select>
          <input className="input" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} />
        </div>
      </div>

      {/* 操作ボタン: ASK① → ASK② → アサイン作成 → Excel出力 → AI依頼 → パターン設定（メール配信は画面右下） */}
      <div className="roster-actions" role="toolbar" aria-label="勤務表の操作">
        {isAdmin && (
          <Link href={`/shortage?month=${monthStr}`} className="btn-secondary" data-testid="btn-ask1">
            <Icon name="megaphone" />
            ASK①
          </Link>
        )}
        {isAdmin && (
          <Link href={`/roster/shift-adjustment?month=${monthStr}`} className="btn-secondary" data-testid="btn-ask2">
            <Icon name="userCheck" />
            ASK②
          </Link>
        )}
        {isAdmin && (
          <button className="btn-secondary" onClick={() => setMonthlyAutoAssignOpen(true)} data-testid="btn-assign-create">
            <Icon name="calendarCheck" />
            アサイン作成
          </button>
        )}
        {(isAdmin || isConfirmed) && (
          <a className="btn-secondary" href={`/api/export/roster-excel?month=${monthStr}`} data-testid="btn-excel">
            <Icon name="sheet" />
            Excel出力
          </a>
        )}
        {isAdmin && (
          <button className="btn-secondary" onClick={() => setAiModalOpen(true)} data-testid="btn-ai">
            <Icon name="sparkles" />
            AI依頼
          </button>
        )}
        {isAdmin && (
          <button className="btn-secondary" onClick={() => setPatternModalOpen(true)} data-testid="btn-pattern">
            <Icon name="sliders" />
            パターン設定
          </button>
        )}
      </div>

      {isAdmin && shortageInfo.confirmed && (
        <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: -12, marginBottom: 12 }}>
          人員不足の表示は {new Date(shortageInfo.confirmedAt!).toLocaleString("ja-JP")} 時点でINCが確定した内容です。
        </p>
      )}

      {isAdmin && monthStatus && !isConfirmed && (
        <Notice tone="warning" className="roster-notice">
          {monthStatus.needsRedelivery
            ? "確定後にシフトが修正されたため、この月は「調整中」に戻っています。従業員には再配信が完了するまでシフトが表示されません。"
            : "この月は「調整中」です。メール配信が完了するまで、従業員にはシフトが表示されません。"}
        </Notice>
      )}
      {isAdmin && deliveryMsg && (
        <Notice tone={deliveryMsg.kind === "ok" ? "success" : "error"}>{deliveryMsg.text}</Notice>
      )}

      {!isAdmin && loaded && !isConfirmed && (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }} data-testid="adjusting-panel">
          <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, marginBottom: 8 }}>調整中</div>
          <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: 14 }}>
            {year}年{month}月の勤務スケジュールは調整中です。確定後（確定メールの配信後）に表示されます。
          </p>
        </div>
      )}

      {(isAdmin || (loaded && isConfirmed)) && (
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 30,minWidth:120,width:120,background:"var(--color-surface-2)" ,}}>氏名</th>
              {days.map((d) => {
                const wd = new Date(year, month - 1, d).getDay();
                const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
                return (
                  <th key={d} style={{ ...thStyle, minWidth: 64, color: wd === 0 ? "var(--color-danger)" : wd === 6 ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                    <Link href={`/schedule/${dateStr}`} style={{ color: "inherit" }}>
                      {d}<br /><span style={{ fontSize: 10 }}>{WEEKDAY_JP[wd]}</span>
                    </Link>
                  </th>
                );
              })}
            </tr>
            {isAdmin && (
            <tr>
              <th style={{ ...thStyle, position: "sticky", left: 0, zIndex: 30, minWidth: 120, width: 120, background: "var(--color-surface-2)", fontWeight: 400, fontSize: 11, color: "var(--color-text-muted)" }}>
                人員不足
              </th>
              {days.map((d) => {
                const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
                const dayShortage = shortageInfo.shortagesByDate[dateStr];
                if (!dayShortage || dayShortage.totalShortage <= 0) {
                  return <th key={d} style={{ ...thStyle, minWidth: 56 }} />;
                }
                return (
                  <th key={d} style={{ ...thStyle, minWidth: 56 }}>
                    <span style={{ fontSize: 11, color: "var(--color-danger)", fontWeight: 600 }}>
                      {dayShortage.totalShortage}人不足
                    </span>
                  </th>
                );
              })}
            </tr>
            )}
          </thead>
          <tbody>
            {orderedEmployees.map((emp) => {
              const isSelf = !isAdmin && emp.id === selfEmployeeId;
              return (
              <tr key={emp.id} data-self={isSelf ? "true" : undefined} style={isSelf ? { background: "var(--color-accent-soft)" } : undefined}>
                <td style={{ ...tdStyle, position: "sticky", left: 0,zIndex: 20,minWidth: 120,width: 120,background: isSelf ? "var(--color-accent-soft)" : "var(--color-surface)", fontWeight: 600, whiteSpace: "nowrap", borderLeft: isSelf ? "3px solid var(--color-accent)" : undefined }}>
                  {emp.fullName}
                  {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-accent)" }}>あなた</span>}
                </td>
                {days.map((d) => {
                  const entry = entryMap.get(`${emp.id}-${d}`);
                  // Excel出力と同じ関数(rosterCellParts)で表示内容を決める（画面とExcelの不一致を防ぐ）
                  const { label } = rosterCellParts(entry, emp);
                  const isEditing = editCell?.employeeId === emp.id && editCell?.day === d;
                  return (
                    <td key={d} style={{ ...tdStyle, textAlign: "center", cursor: isAdmin ? "pointer" : "default", position: "relative" }}
                      onClick={() => isAdmin && setEditCell({ employeeId: emp.id, day: d })}
                    >
                      {/* 勤務時間のみ表示（シフト名〔早番・遅番など〕は表示しない） */}
                      <span style={{ fontSize: 13, fontWeight: entry?.status === "WORK" ? 600 : 400, color: entry && entry.status !== "WORK" ? "var(--color-text-muted)" : "var(--color-text)", whiteSpace: "nowrap" }}>
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
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* メール配信: 画面右下に固定（勤務表・他のボタンと重ならない位置。下余白を確保） */}
      {isAdmin && (
        <div className="roster-mail-dock">
          <button className="btn roster-mail-dock__btn" onClick={handleConfirmMonth} disabled={confirming} data-testid="btn-mail">
            <Icon name="mail" />
            {confirming ? "送信中..." : "メール配信"}
          </button>
        </div>
      )}


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

      {monthlyAutoAssignOpen && (
        <MonthlyAutoAssignModal
          defaultYear={year}
          defaultMonth={month}
          onClose={() => setMonthlyAutoAssignOpen(false)}
        />
      )}

      {aiModalOpen && (
        <AiAssistModal
          monthStr={monthStr}
          employees={employees}
          onClose={() => setAiModalOpen(false)}
          onApplied={load}
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
  // 画面端のセルでも、ポップアップが画面の外にはみ出さないようにする
  const popRef = useRef<HTMLDivElement>(null);
  useKeepInViewport(popRef, true);

  return (
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      className="card"
      style={{ position: "absolute", top: "100%", left: 0, zIndex: 30, width: 260, maxWidth: "calc(100vw - 16px)", boxSizing: "border-box", textAlign: "left", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
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
        <button className="btn-secondary" onClick={onClose}><Icon name="x" />キャンセル</button>
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
          <Icon name="save" />
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
  const [continueToYearEnd, setContinueToYearEnd] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
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
      body: JSON.stringify({
        employeeIds: selectedIds,
        rotationPatternId: patternId,
        anchorDate,
        rangeStart,
        rangeEnd,
        continueToYearEnd,
        overwriteExisting,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      let msg = `${data.updatedCount}件を更新しました（有休/調整休により保護: ${data.skippedLeaveCount}件）`;
      if (data.skippedExistingMonthCount > 0) {
        const detail = (data.skippedMonthsByEmployee ?? [])
          .map((s: { employeeName: string; months: string[] }) => `${s.employeeName}: ${s.months.join("、")}`)
          .join(" / ");
        msg += `\n⚠ 既存データがあるためスキップした月があります（${data.skippedExistingMonthCount}日分）: ${detail}`;
      }
      setResultMsg(msg);
      setTimeout(onApplied, 1400);
    } else {
      setResultMsg("適用に失敗しました。");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>パターン設定</h2>
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

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 6 }}>
          <input type="checkbox" checked={continueToYearEnd} onChange={(e) => setContinueToYearEnd(e.target.checked)} />
          この後、同じ年の12月末まで自動的に継続して生成する（サイクルは途切れずそのまま続きます）
        </label>
        {continueToYearEnd && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 12, marginLeft: 20, color: "var(--color-text-muted)" }}>
            <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} />
            既にデータがある月も上書きする（通常はオフのまま推奨。オフの場合、既存データがある月はスキップされます）
          </label>
        )}

        {resultMsg && <p style={{ fontSize: 13, color: "var(--color-accent)", whiteSpace: "pre-line" }}>{resultMsg}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn-secondary" onClick={onClose}><Icon name="x" />キャンセル</button>
          <button className="btn" onClick={handleApply} disabled={loading || selectedIds.length === 0}><Icon name="check" />
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

// アサイン作成 — 既存の1日単位のAuto Assign API（/api/schedule/auto-assign）を
// 月内の日数分だけ順番に呼び出す。1リクエスト＝1日分なので、既存ロジックは一切変更せず、
// タイムアウトのリスクも増やさない（バッチ処理として1日ずつ実行）。
function MonthlyAutoAssignModal({
  defaultYear, defaultMonth, onClose,
}: {
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
}) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [phase, setPhase] = useState<"config" | "running" | "done">("config");
  const [currentDay, setCurrentDay] = useState(0);
  const [totalShortage, setTotalShortage] = useState(0);
  const [failedDays, setFailedDays] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  const numDays = daysInMonth(year, month);

  async function handleStart() {
    setChecking(true);
    const monthStr = `${year}-${pad2(month)}`;
    const checkRes = await fetch(`/api/schedule/auto-assign?month=${monthStr}`);
    const checkData = checkRes.ok ? await checkRes.json() : { existingCount: 0 };
    setChecking(false);

    if (checkData.existingCount > 0) {
      const ok = confirm(
        `${monthStr} には既に ${checkData.existingCount} 件の配置データがあります。\n` +
        `続行すると、この月の既存データはすべて上書きされます。よろしいですか？`
      );
      if (!ok) return;
    }

    setPhase("running");
    setCurrentDay(0);
    setTotalShortage(0);
    setFailedDays([]);

    let shortageSum = 0;
    const failures: string[] = [];

    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
      try {
        const res = await fetch("/api/schedule/auto-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateStr }),
        });
        if (res.ok) {
          const data = await res.json();
          shortageSum += data.shortageCount ?? 0;
        } else {
          failures.push(dateStr);
        }
      } catch {
        failures.push(dateStr);
      }
      setCurrentDay(d);
    }

    setTotalShortage(shortageSum);
    setFailedDays(failures);
    setPhase("done");
  }

  return (
    <div className="modal-backdrop" onClick={phase === "running" ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 0 }}>アサイン作成</h2>

        {phase === "config" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label className="label">年</label>
                <input className="input" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">月</label>
                <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={onClose}><Icon name="x" />キャンセル</button>
              <button className="btn" onClick={handleStart} disabled={checking}><Icon name="play" />
                {checking ? "確認中..." : "実行する"}
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <p style={{ fontSize: 14 }}>自動割当てを実行しています...</p>
            <div style={{ background: "var(--color-surface-2)", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 8 }}>
              <div
                style={{
                  width: `${(currentDay / numDays) * 100}%`,
                  background: "var(--color-accent)",
                  height: "100%",
                  transition: "width 0.15s ease",
                }}
              />
            </div>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {currentDay} / {numDays} 日
            </p>
          </>
        )}

        {phase === "done" && (
          <>
            <p style={{ fontSize: 14 }}>
              {year}年{month}月 の自動割当てが完了しました（{numDays}日分）。
            </p>
            {totalShortage > 0 && (
              <p style={{ fontSize: 13, color: "var(--color-warn)" }}>
                ⚠ 人員不足のコマが合計 {totalShortage} 件あります。アサイン表で赤色表示を確認してください。
              </p>
            )}
            {failedDays.length > 0 && (
              <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
                ⚠ 以下の日付は失敗しました: {failedDays.join("、")}
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn" onClick={onClose}><Icon name="x" />閉じる</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// AI追加 — 現時点ではUIと拡張用の構造だけを用意する（実際のAI提案ロジックは未実装）。
// 将来ここに「不足人員の自動提案」「シフト最適化提案」等を追加していく想定。
