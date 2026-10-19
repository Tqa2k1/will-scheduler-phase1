// 日付・期限・月の判定はすべてJST（日本時間）で行う。
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function currentMonthJst(now: Date = new Date()): string {
  return todayJst(now).slice(0, 7);
}
export function nextMonthJst(now: Date = new Date()): string {
  const [y, m] = currentMonthJst(now).split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
