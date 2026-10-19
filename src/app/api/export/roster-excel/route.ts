import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRosterVisibility } from "@/lib/rosterAccess";
import { isValidMonth } from "@/lib/monthStatusShared";
import { rosterCellParts } from "@/lib/workTime";
import ExcelJS from "exceljs";
import { XL, styleCell, weekdayTone, setupPrint } from "@/lib/excelStyle";

// 常に最新のDBの内容で出力する（キャッシュしない）
export const dynamic = "force-dynamic";

// GET /api/export/roster-excel?month=2026-07
// Web画面（月間勤務表）と同じ従業員（在籍中のみ）・同じ並び・同じ表示(rosterCellParts)で出力する。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !isValidMonth(month)) return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));
  const numDays = new Date(year, mon, 0).getDate();

  // 画面（/api/roster）と同じ閲覧範囲に制限する（確定前の月は一般従業員には自分の行のみ）
  const vis = await getRosterVisibility(session.user, month);
  if (!vis.fullAccess) return NextResponse.json({ error: "この月のシフトは調整中のため出力できません" }, { status: 403 });
  const [employees, entries] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
    prisma.monthRoster.findMany({
      where: { workDate: { gte: rangeStart, lt: rangeEnd } },
      include: { shiftType: true },
    }),
  ]);

  const entryMap = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const d = e.workDate.getUTCDate();
    entryMap.set(`${e.employeeId}-${d}`, e);
  }

  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${month}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });

  // 1行目: タイトル / 2行目: 日付 / 3行目: 曜日（Web画面の見出しと同じ配色）
  const titleRow = sheet.getRow(1);
  titleRow.getCell(1).value = `${year}年${mon}月 勤務表`;
  titleRow.getCell(1).font = { name: XL.font, size: 14, bold: true, color: { argb: XL.text } };
  titleRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  titleRow.height = 26;
  const dateRow = sheet.getRow(2);
  const weekdayRow = sheet.getRow(3);
  sheet.getColumn(1).width = 20;
  styleCell(dateRow.getCell(1), { bg: XL.headBg, bold: true, h: "left" });
  styleCell(weekdayRow.getCell(1), { bg: XL.headBg, bold: true, h: "left" });
  dateRow.getCell(1).value = "氏名";
  for (let d = 1; d <= numDays; d++) {
    const dow = new Date(year, mon - 1, d).getDay();
    const tone = weekdayTone(dow);
    dateRow.getCell(d + 1).value = d;
    weekdayRow.getCell(d + 1).value = WEEKDAY_JP[dow];
    styleCell(dateRow.getCell(d + 1), { bg: tone.bg, color: tone.color, bold: true });
    styleCell(weekdayRow.getCell(d + 1), { bg: tone.bg, color: tone.color, size: 9 });
    sheet.getColumn(d + 1).width = 9;
  }
  dateRow.height = 20;
  weekdayRow.height = 18;

  // 一般従業員は自分の行を先頭にして強調（Web画面と同じ）
  const selfId = session.user.role === "EMPLOYEE" ? session.user.employeeId ?? null : null;
  const ordered = selfId ? [...employees.filter((e) => e.id === selfId), ...employees.filter((e) => e.id !== selfId)] : employees;

  ordered.forEach((emp, rowIdx) => {
    const row = sheet.getRow(rowIdx + 4);
    const isSelf = emp.id === selfId;
    const rowBg = isSelf ? XL.primarySoft : XL.surface;
    row.getCell(1).value = emp.fullName;
    styleCell(row.getCell(1), { bg: rowBg, bold: isSelf, h: "left" });
    for (let d = 1; d <= numDays; d++) {
      const entry = entryMap.get(`${emp.id}-${d}`);
      const { label } = rosterCellParts(entry, emp);
      // Web画面と同じく、勤務時間のみ表示する（シフト名は表示しない）
      const cell = row.getCell(d + 1);
      cell.value = label;
      const isWork = !!entry && entry.status === "WORK";
      styleCell(cell, { bg: label && !isWork ? XL.inactive : rowBg, color: label && !isWork ? XL.muted : XL.text, size: 9, bold: isSelf });
    }
    row.height = 30;
  });

  setupPrint(sheet, { titleRows: "2:3", titleCols: "A", footer: `勤務表 ${month}` });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="roster-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
