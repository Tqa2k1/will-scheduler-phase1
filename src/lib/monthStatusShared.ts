// 月ごとの勤務スケジュール状態（調整中／確定）の、サーバー・画面で共通に使う型と純粋関数。
// DBには依存しない（クライアントからも import できる）。DBを触る処理は monthStatus.ts。

export type MonthStatus = "ADJUSTING" | "CONFIRMED";

export type DeliveryFailure = { employeeId: string; employeeName: string; reason: string };
export type DeliverySkipped = { employeeId: string; employeeName: string };

// 直近の「メール配信」の記録（管理者・INCにだけ返す）
export type DeliverySummary = {
  at: string; // ISO
  mode: string | null; // live / dry-run / test
  sent: number; // その配信で送信できた人数（前回までに送信済みの人を含む合計）
  failed: number;
  skippedNoEmail: number;
  failures: DeliveryFailure[];
};

export type MonthStatusInfo = {
  month: string; // "2026-10"
  status: MonthStatus;
  // 確定後にシフトが修正され、再度「メール配信」が必要な状態
  needsRedelivery: boolean;
  confirmedAt: string | null;
  // 以下は管理者・INCにだけ返す
  revisedAt?: string | null;
  lastDelivery?: DeliverySummary | null;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isValidMonth(month: unknown): month is string {
  return typeof month === "string" && MONTH_RE.test(month);
}

// 日付（DBのdate列はUTC 0時で保持される）→ "YYYY-MM"
export function monthKeyOfDate(d: Date | string): string {
  const iso = typeof d === "string" ? d : d.toISOString();
  return iso.slice(0, 7);
}

export function monthsOfDates(dates: Iterable<Date | string>): string[] {
  const set = new Set<string>();
  for (const d of dates) {
    const key = monthKeyOfDate(d);
    if (isValidMonth(key)) set.add(key);
  }
  return [...set];
}

// 画面に出す文言（勤務表・ASK②で共通）
export function monthStatusLabel(info: Pick<MonthStatusInfo, "status" | "needsRedelivery">): string {
  if (info.status === "CONFIRMED") return "確定";
  return info.needsRedelivery ? "調整中（再配信が必要）" : "調整中";
}

// 従業員の勤務表の並び順: ログイン本人を一番上、残りは元の順（氏名順）のまま
export function orderSelfFirst<T extends { id: string }>(list: T[], selfId: string | null | undefined): T[] {
  if (!selfId) return list;
  return [...list.filter((e) => e.id === selfId), ...list.filter((e) => e.id !== selfId)];
}
