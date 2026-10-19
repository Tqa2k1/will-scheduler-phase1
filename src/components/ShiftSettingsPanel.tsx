"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

type TimeBand = { startTime: string; endTime: string; requiredCount: number };
type Shift = {
  id: string;
  code: string;
  defaultStartTime: string;
  defaultEndTime: string;
  requiredCount: number | null;
  timeBands: TimeBand[];
};

// 入力中の値（数値は入力途中の空欄を許すため文字列で持つ）
type Draft = {
  code: string;
  start: string;
  end: string;
  required: string;
  bands: { start: string; end: string; required: string }[];
};

function toDraft(s: Shift): Draft {
  return {
    code: s.code,
    start: s.defaultStartTime,
    end: s.defaultEndTime,
    required: String(s.requiredCount ?? 0),
    bands: s.timeBands.map((b) => ({ start: b.startTime, end: b.endTime, required: String(b.requiredCount) })),
  };
}

function parseCount(v: string): number | null {
  if (!/^\d{1,2}$/.test(v.trim())) return null;
  return Number(v);
}

// 下書き → APIに送る形。数値が不正なら null
function toPayload(d: Draft) {
  const requiredCount = parseCount(d.required);
  if (requiredCount === null) return null;
  const timeBands: TimeBand[] = [];
  for (const b of d.bands) {
    const n = parseCount(b.required);
    if (n === null || !b.start || !b.end) return null;
    timeBands.push({ startTime: b.start, endTime: b.end, requiredCount: n });
  }
  return { code: d.code.trim(), defaultStartTime: d.start, defaultEndTime: d.end, requiredCount, timeBands };
}

async function readError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return typeof data.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

// 勤務時間設定（旧「人数設定」）。シフトごとの勤務時間・必要人数を設定する。スケジュール設定画面のタブとして表示する。
// API（/api/shift-types）と保存処理は従来の人数設定画面と同じ。権限チェックは親画面（管理者のみ）で行う。
export default function ShiftSettingsPanel() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [newDraft, setNewDraft] = useState<Draft>({ code: "", start: "08:00", end: "17:00", required: "1", bands: [] });

  async function load() {
    const res = await fetch("/api/shift-types");
    if (res.ok) {
      const data: Shift[] = await res.json();
      data.sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime) || a.code.localeCompare(b.code));
      setShifts(data);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    const payload = toPayload(newDraft);
    if (!payload) return alert("必要人数と時間帯の入力内容を確認してください（人数は0〜99の整数）。");
    const res = await fetch("/api/shift-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return alert(await readError(res, "シフトの追加に失敗しました。"));
    setNewDraft({ code: "", start: "08:00", end: "17:00", required: "1", bands: [] });
    load();
  }

  return (
    <div>
      {shifts.map((s) => (
        <ShiftCard key={s.id} shift={s} onChanged={load} />
      ))}

      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>シフトを追加</h2>
        <DraftFields draft={newDraft} onChange={setNewDraft} />
        <button className="btn" style={{ marginTop: 12 }} onClick={handleCreate}>
          <Icon name="plus" />
          追加
        </button>
      </div>
    </div>
  );
}

function ShiftCard({ shift, onChanged }: { shift: Shift; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(toDraft(shift));
  const [saving, setSaving] = useState(false);

  // 保存後の再読み込みで最新値に合わせる
  useEffect(() => {
    setDraft(toDraft(shift));
  }, [shift]);

  async function handleSave() {
    const payload = toPayload(draft);
    if (!payload) return alert("必要人数と時間帯の入力内容を確認してください（人数は0〜99の整数）。");
    setSaving(true);
    const res = await fetch(`/api/shift-types/${shift.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) return alert(await readError(res, "保存に失敗しました。"));
    onChanged();
  }

  async function handleDelete() {
    if (!confirm(`シフト「${shift.code}」を削除してもよろしいですか？`)) return;
    const res = await fetch(`/api/shift-types/${shift.id}`, { method: "DELETE" });
    if (!res.ok) return alert(await readError(res, "削除に失敗しました。"));
    onChanged();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <DraftFields draft={draft} onChange={setDraft} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={handleSave} disabled={saving}>
          <Icon name="save" />
          {saving ? "保存中..." : "保存"}
        </button>
        <button className="btn-danger" onClick={handleDelete}>
          <Icon name="trash" />
          削除
        </button>
      </div>
    </div>
  );
}

function DraftFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setBand = (i: number, patch: Partial<Draft["bands"][number]>) =>
    set({ bands: draft.bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <div>
          <label className="label">シフト名</label>
          <input className="input" value={draft.code} onChange={(e) => set({ code: e.target.value })} />
        </div>
        <div>
          <label className="label">開始時間</label>
          <input className="input" type="time" value={draft.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div>
          <label className="label">終了時間</label>
          <input className="input" type="time" value={draft.end} onChange={(e) => set({ end: e.target.value })} />
        </div>
        <div>
          <label className="label">基本必要人数（0は人員不足の集計対象外）</label>
          <input
            className="input"
            type="number"
            min={0}
            max={99}
            value={draft.required}
            onChange={(e) => set({ required: e.target.value })}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="label">時間帯別の必要人数（設定した時間帯は基本必要人数より優先）</label>
        {draft.bands.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "4px 0" }}>
            設定なし（シフト全体で基本必要人数を使用）
          </p>
        )}
        {draft.bands.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <input className="input" type="time" style={{ width: 130 }} value={b.start} onChange={(e) => setBand(i, { start: e.target.value })} />
            <span>〜</span>
            <input className="input" type="time" style={{ width: 130 }} value={b.end} onChange={(e) => setBand(i, { end: e.target.value })} />
            <input
              className="input"
              type="number"
              min={0}
              max={99}
              style={{ width: 80 }}
              value={b.required}
              onChange={(e) => setBand(i, { required: e.target.value })}
            />
            <span>人</span>
            <button className="btn-secondary" onClick={() => set({ bands: draft.bands.filter((_, idx) => idx !== i) })}><Icon name="trash" />
              削除
            </button>
          </div>
        ))}
        <button
          className="btn-secondary"
          onClick={() => set({ bands: [...draft.bands, { start: draft.start, end: draft.end, required: draft.required }] })}
        >
          <Icon name="plus" />
          時間帯を追加
        </button>
      </div>
    </>
  );
}
