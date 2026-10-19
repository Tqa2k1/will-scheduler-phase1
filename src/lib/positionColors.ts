// 業務（CartPosition）の既定の表示色。Web画面・Excel・PDFで同じ色を使う（業務管理で色を設定していれば、そちらが優先）。
export const POSITION_COLORS: Record<string, string> = {
  A: "#dbeafe",
  B: "#f3e8ff",
  全: "#dcfce7",
  BF: "#ffedd5",
  BREAK: "#e5e7eb",
  MOVE: "#fef9c3",
  WHILL_ARRIVAL_PREP: "#cffafe",
  WHILL_ARRIVAL_CLEANUP: "#a5f3fc",
  WHILL_DEPARTURE_PREP: "#99f6e4",
  WHILL_DEPARTURE_CLEANUP: "#5eead4",
  OFFICE: "#e2e8f0",
  MTG: "#fee2e2",
};

export function positionColor(p: { code: string; color: string | null }): string {
  return p.color ?? POSITION_COLORS[p.code] ?? "#f1f5f9";
}
