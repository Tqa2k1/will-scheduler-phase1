import { isManagerRole } from "@/lib/roles";
import { getMonthStatus } from "@/lib/monthStatus";
import { isValidMonth } from "@/lib/monthStatusShared";

// 月間勤務表（MonthRoster）の閲覧範囲を決める（UIだけでなくAPI・クエリ側で保証するための共通関数）。
//  - 管理者・INC: 常に全員分（調整中の月も含む）
//  - 一般従業員: 月の状態が「確定」（メール配信が正常に完了した月）のときだけ、全員分のシフト情報を閲覧できる。
//               「調整中」の月はシフトデータを一切返さない（自分の分も含めて返さない）。
//  他人の勤務希望（ShiftClaimRequest）はここでは扱わない（常に非公開）。
export async function getRosterVisibility(
  user: { role?: string | null; employeeId?: string | null },
  month: string
): Promise<{ fullAccess: boolean; confirmed: boolean; employeeId: string | null }> {
  if (isManagerRole(user.role)) return { fullAccess: true, confirmed: true, employeeId: null };
  const confirmed = isValidMonth(month) && (await getMonthStatus(month)) === "CONFIRMED";
  return { fullAccess: confirmed, confirmed, employeeId: user.employeeId ?? null };
}

// 従業員向けにシフトデータを返してよいか（= 一般従業員がその月を閲覧できるか）を判定する簡易ヘルパー。
export async function canViewMonthShifts(user: { role?: string | null; employeeId?: string | null }, month: string): Promise<boolean> {
  return (await getRosterVisibility(user, month)).fullAccess;
}
