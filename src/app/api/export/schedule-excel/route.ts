import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDisplaySlots } from "@/lib/timeSlots";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildRowCells, rosterShiftLabel } from "@/lib/scheduleGrid";
import ExcelJS from "exceljs";

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
  const slots = buildDisplaySlots();

  const [rosterItems, assignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(date);

  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 14;
  const header = sheet.getRow(1);
  header.getCell(1).value = "氏名";
  header.getCell(2).value = "シフト";
  header.getCell(3).value = "勤務時間";
  slots.forEach((s, i) => {
    header.getCell(i + 4).value = s.start;
    sheet.getColumn(i + 4).width = 9;
  });

  rosterItems.forEach((r, rowIdx) => {
    const row = sheet.getRow(rowIdx + 2);
    row.getCell(1).value = r.employeeName;
    row.getCell(2).value = rosterShiftLabel(r);
    row.getCell(3).value = r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : "";
    for (const c of buildRowCells(r, assignments)) {
      if (!c.active || !c.label) continue; // 勤務時間外・未割当ては空欄のまま
      const cell = row.getCell(c.startIdx + 4);
      cell.value = c.label;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (c.span === 2) sheet.mergeCells(rowIdx + 2, c.startIdx + 4, rowIdx + 2, c.startIdx + 5); // 60分業務は2コマ結合
    }
    row.height = 30;
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
