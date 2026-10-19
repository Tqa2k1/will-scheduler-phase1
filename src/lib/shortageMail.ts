import { prisma } from "@/lib/prisma";
import type { MonthShortageSnapshot } from "@/lib/monthlyShiftGap";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

// "2026-11" → { year: 2026, mon: 11 }
export function parseMonth(month: string): { year: number; mon: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return { year: Number(m[1]), mon };
}

export function monthLabel(month: string): string {
  const p = parseMonth(month);
  return p ? `${p.year}年${p.mon}月` : month;
}

// 勤務希望の登録締切 = 対象月の前月10日（例: 2026-11 → 2026-10-10）。締切後も登録は可能（禁止しない）。
export function getRegistrationDeadline(month: string): { iso: string; label: string } | null {
  const p = parseMonth(month);
  if (!p) return null;
  const prevYear = p.mon === 1 ? p.year - 1 : p.year;
  const prevMon = p.mon === 1 ? 12 : p.mon - 1;
  return {
    iso: `${prevYear}-${String(prevMon).padStart(2, "0")}-10`,
    label: `${prevYear}年${prevMon}月10日`,
  };
}

// "2026-11-03" → "11月3日(月)"
export function formatDateJp(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日(${WEEKDAY_JP[wd]})`;
}

// 保存済みスナップショット → 1回目メールの「人員不足の日程」行
export function buildShortageLines(shortagesByDate: MonthShortageSnapshot["shortagesByDate"]): string[] {
  const lines: string[] = [];
  for (const date of Object.keys(shortagesByDate).sort()) {
    for (const band of shortagesByDate[date].bands) {
      if (band.shortage <= 0) continue;
      lines.push(`・${formatDateJp(date)} ${band.shiftLabel}  不足人数：${band.shortage}名`);
    }
  }
  return lines;
}

// 1回目メールの送信対象: 役割が「バイト」(PARTTIME) の在籍中の従業員のみ。
// 正社員・契約社員など、バイト以外には送らない。メール未登録者は skipped として返す（送信はしない）。
export async function getShortageRecipients() {
  const parttimers = await prisma.employee.findMany({
    where: { isActive: true, role: "PARTTIME" },
    orderBy: [{ priorityOrder: "asc" }, { fullName: "asc" }],
  });
  const withEmail = parttimers.filter((e) => !!e.contactEmail);
  const skipped = parttimers.filter((e) => !e.contactEmail);
  return { total: parttimers.length, withEmail, skipped };
}

export type MailLogLite = { status: string; mode: string | null; updatedAt: Date } | null | undefined;
const STALE_SENDING_MS = 10 * 60 * 1000;

// 1回目メールを「これから送る必要があるか」。原則、未送信・送信失敗の人だけが対象。
//  - 送信成功(live)は再送しない / 送信処理中は触らない（10分以上止まっているものだけ再送対象）
//  - dry-run や test で「送信済み」になった人は、実際には届いていないので live に切り替えた後は対象にする
export function needsMailSend(log: MailLogLite, currentMode: string, now: Date = new Date()): boolean {
  if (!log) return true;
  if (log.status === "FAILED") return true;
  if (log.status === "SENDING") return now.getTime() - log.updatedAt.getTime() > STALE_SENDING_MS;
  if (log.status === "SENT") return currentMode === "live" && log.mode !== "live";
  return true;
}
