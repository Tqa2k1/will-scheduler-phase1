// Excel出力の共通スタイル。Web画面のデザイントークン（globals.css）に合わせる。
import type ExcelJS from "exceljs";

export const XL = {
  font: "Yu Gothic",
  text: "FF0F172A",
  muted: "FF475569",
  headBg: "FFF1F5F9",
  border: "FFCBD5E1",
  surface: "FFFFFFFF",
  inactive: "FFF1F5F9",
  sat: "FF1D4ED8",
  satBg: "FFEFF6FF",
  sun: "FFB91C1C",
  sunBg: "FFFDECEC",
  primarySoft: "FFEFF6FF",
  warnBg: "FFFEF6E0",
} as const;

export const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();

const side = { style: "thin" as const, color: { argb: XL.border } };
export const BORDER: Partial<ExcelJS.Borders> = { top: side, left: side, bottom: side, right: side };

export function styleCell(
  cell: ExcelJS.Cell,
  o: { bg?: string; color?: string; bold?: boolean; size?: number; h?: "left" | "center" | "right"; wrap?: boolean } = {}
) {
  cell.font = { name: XL.font, size: o.size ?? 10, bold: o.bold ?? false, color: { argb: o.color ?? XL.text } };
  if (o.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.bg } };
  cell.alignment = { horizontal: o.h ?? "center", vertical: "middle", wrapText: o.wrap ?? true };
  cell.border = BORDER;
}

// 土=青、日=赤（Web画面の曜日色と同じ）
export function weekdayTone(dow: number): { color: string; bg: string } {
  if (dow === 6) return { color: XL.sat, bg: XL.satBg };
  if (dow === 0) return { color: XL.sun, bg: XL.sunBg };
  return { color: XL.text, bg: XL.headBg };
}

// A4横・1ページ幅に収める・見出し行/列を各ページに繰り返す
export function setupPrint(sheet: ExcelJS.Worksheet, o: { titleRows: string; titleCols?: string; footer: string }) {
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    printTitlesRow: o.titleRows,
    ...(o.titleCols ? { printTitlesColumn: o.titleCols } : {}),
  } as ExcelJS.PageSetup;
  sheet.headerFooter.oddFooter = `&L${o.footer}&R&P / &N`;
}
