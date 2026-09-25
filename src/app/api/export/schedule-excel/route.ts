import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildOperatingDaySlots } from "@/lib/timeSlots";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import ExcelJS from "exceljs";

// GET /api/export/schedule-excel?date=2026-07-01
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date パラメータが必要です" }, { status: 400 });

  const workDate = new Date(date);
  const slots = buildOperatingDaySlots();

  const [rosterItems, assignments] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
  ]);

  const assignMap = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) assignMap.set(`${a.employeeId}-${a.slotStart}`, a);

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
    sheet.getColumn(i + 4).width = 6;
  });

  rosterItems.forEach((r, rowIdx) => {
    const row = sheet.getRow(rowIdx + 2);
    row.getCell(1).value = r.employeeName;
    row.getCell(2).value = r.isCarryOver ? "明番（引継）" : r.shiftTypeCode ?? "";
    row.getCell(3).value = r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}〜${r.resolvedEnd}` : "";
    slots.forEach((s, i) => {
      if (i < r.activeStartIdx || i >= r.activeEndIdx) return; // 勤務時間外は空欄のまま
      const a = assignMap.get(`${r.employeeId}-${s.start}`);
      row.getCell(i + 4).value = a?.cartPosition.code ?? "";
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-${date}.xlsx"`,
    },
  });
}
