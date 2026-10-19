import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getRosterVisibility } from "@/lib/rosterAccess";
import { monthKeyOfDate } from "@/lib/monthStatusShared";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDisplaySlots } from "@/lib/timeSlots";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildRowCells, rosterShiftLabel } from "@/lib/scheduleGrid";
import ExcelJS from "exceljs";
import { XL, styleCell, setupPrint, argb } from "@/lib/excelStyle";
import { POSITION_COLORS } from "@/lib/positionColors";

// 常に最新のDBの内容で出力する（キャッシュしない）
export const dynamic = "force-dynamic";

// GET /api/export/schedule-excel?date=2026-07-01
// Web画面（日別スケジュール）と同じ30分刻み・同じ表示ロジック(src/lib/scheduleGrid.ts)・
// 業務管理に登録されている最新の業務名で出力する。削除済み従業員は含まれない。
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date パラメータが必要です" }, { status: 400 });

  const workDate = new Date(date);
  if (Number.isNaN(workDate.getTime())) return NextResponse.json({ error: "date が不正です" }, { status: 400 });
  // 一般従業員は、月が「確定」になるまでシフト内容を出力できない
  if (!isManagerRole(session.user.role)) {
    const vis = await getRosterVisibility(session.user, monthKeyOfDate(workDate));
    if (!vis.fullAccess) return NextResponse.json({ error: "この月のシフトは調整中のため出力できません" }, { status: 403 });
  }
  const slots = buildDisplaySlots();

  const [rosterItems, assignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(date, { views: [{ state: "frozen", xSplit: 3, ySplit: 2 }] });
  const dow = workDate.getUTCDay();
  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

  // 1行目: タイトル / 2行目: 時刻見出し（Web画面と同じ配色）
  const title = sheet.getRow(1);
  title.getCell(1).value = `${date}（${WEEKDAY_JP[dow]}） 日別スケジュール`;
  title.getCell(1).font = { name: XL.font, size: 14, bold: true, color: { argb: XL.text } };
  title.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  title.height = 26;

  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 14;
  const header = sheet.getRow(2);
  ["氏名", "シフト", "勤務時間"].forEach((t, i) => {
    header.getCell(i + 1).value = t;
    styleCell(header.getCell(i + 1), { bg: XL.headBg, bold: true, h: i === 0 ? "left" : "center" });
  });
  slots.forEach((s, i) => {
    const c = header.getCell(i + 4);
    c.value = s.start;
    styleCell(c, { bg: XL.headBg, bold: true, size: 9 });
    sheet.getColumn(i + 4).width = 9;
  });
  header.height = 20;

  rosterItems.forEach((r, rowIdx) => {
    const row = sheet.getRow(rowIdx + 3);
    row.getCell(1).value = r.employeeName;
    row.getCell(2).value = rosterShiftLabel(r);
    row.getCell(3).value = r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : "";
    styleCell(row.getCell(1), { h: "left", bold: true });
    styleCell(row.getCell(2), { size: 9 });
    styleCell(row.getCell(3), { size: 9 });
    const cells = buildRowCells(r, assignments);
    // まず全コマに罫線と背景（勤務時間外=グレー）を付け、業務のあるコマに色と業務名を入れる
    for (const c of cells) {
      const cell = row.getCell(c.startIdx + 4);
      if (!c.active) { styleCell(cell, { bg: XL.inactive }); continue; }
      if (c.label) {
        cell.value = c.label;
        styleCell(cell, { bg: argb(c.color ?? (c.code ? POSITION_COLORS[c.code] : null) ?? "#f1f5f9"), size: 9 });
        if (c.span === 2) {
          styleCell(row.getCell(c.startIdx + 5), { bg: argb(c.color ?? (c.code ? POSITION_COLORS[c.code] : null) ?? "#f1f5f9"), size: 9 });
          sheet.mergeCells(rowIdx + 3, c.startIdx + 4, rowIdx + 3, c.startIdx + 5); // 60分業務は2コマ結合
        }
      } else {
        styleCell(cell, { bg: XL.surface });
      }
    }
    row.height = 30;
  });

  setupPrint(sheet, { titleRows: "2:2", titleCols: "A:C", footer: `日別スケジュール ${date}` });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
