// アルバイトのシフト登録で人員不足が発生した場合に表示・保存する注意事項。
// 不足しているシフトの勤務時間（開始時刻）に応じて内容を切り替える。
//   8:00〜17:00 のシフトが不足  → 8:00から勤務できる方のみ受け付け
//   13:00〜22:00 のシフトが不足 → 16:00から勤務できる方のみ受け付け
// シフト名（早番・遅番など）には依存せず、勤務時間だけで判定する（既存の勤務時間データは変更しない）。

export type ShortageNoticeRule = { shiftStart: string; shiftEnd: string; acceptFrom: string; exampleEnd: string };

const RULES: ShortageNoticeRule[] = [
  { shiftStart: "08:00", shiftEnd: "17:00", acceptFrom: "8:00", exampleEnd: "14:00" },
  { shiftStart: "13:00", shiftEnd: "22:00", acceptFrom: "16:00", exampleEnd: "22:00" },
];

function normalize(t: string): string {
  const [h, m] = t.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${m ?? "00"}`;
}

// 勤務時間の開始・終了から注意事項（2行: 本文＋例）を返す。該当しないシフトは空配列。
export function getShortageNotice(startTime: string, endTime: string): string[] {
  const start = normalize(startTime);
  const end = normalize(endTime);
  // 8:00〜17:00 / 13:00〜22:00 のシフトのみ対象
  const rule = RULES.find((r) => r.shiftStart === start && r.shiftEnd === end);
  if (!rule) return [];
  return [
    `※アルバイトの方は、${rule.acceptFrom}から勤務できる方のみ受け付けています。`,
    `例：6時間勤務の場合は「${rule.acceptFrom}～${rule.exampleEnd}」で登録。`,
  ];
}

// "08:00〜17:00" のような表示ラベルから注意事項を求める（保存済みスナップショットの旧データ用）
export function getShortageNoticeFromLabel(shiftLabel: string): string[] {
  const m = shiftLabel.match(/(\d{1,2}:\d{2})\s*[〜~～-]\s*(\d{1,2}:\d{2})/);
  return m ? getShortageNotice(m[1], m[2]) : [];
}

// 複数の不足シフトの注意事項をまとめる（重複する行は1回だけ）
export function mergeShortageNotices(notices: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lines of notices) {
    for (const line of lines) {
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out;
}
