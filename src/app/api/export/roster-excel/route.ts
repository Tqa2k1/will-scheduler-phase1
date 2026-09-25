import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveWorkTime, formatTimeRange, STATUS_LABEL } from "@/lib/workTime";
import ExcelJS from "exceljs";

// GET /api/export/roster-excel?month=2026-07
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month パラメータが必要です" }, { status: 400 });

  const [year, mon] = month.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(year, mon - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, mon, 1));
  const numDays = new Date(year, mon, 0).getDate();

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
  const sheet = workbook.addWorksheet(`${month}`);

  sheet.getColumn(1).width = 20;
  const dateRow = sheet.getRow(1);
  const weekdayRow = sheet.getRow(2);
  dateRow.getCell(1).value = "氏名";
  weekdayRow.getCell(1).value = "";
  for (let d = 1; d <= numDays; d++) {
    dateRow.getCell(d + 1).value = d;
    weekdayRow.getCell(d + 1).value = WEEKDAY_JP[new Date(year, mon - 1, d).getDay()];
    sheet.getColumn(d + 1).width = 8;
  }

  employees.forEach((emp, rowIdx) => {
    const row = sheet.getRow(rowIdx + 3);
    row.getCell(1).value = emp.fullName;
    for (let d = 1; d <= numDays; d++) {
      const entry = entryMap.get(`${emp.id}-${d}`);
      let label = "";
      if (entry && entry.status !== "WORK") {
        label = STATUS_LABEL[entry.status];
      } else if (entry?.status === "WORK") {
        const resolved = resolveWorkTime({
          overrideStartTime: entry.overrideStartTime,
          overrideEndTime: entry.overrideEndTime,
          shiftType: entry.shiftType,
          baseStartTime: emp.baseStartTime,
          baseEndTime: emp.baseEndTime,
        });
        label = resolved ? formatTimeRange(resolved) : "出勤";
      }
      row.getCell(d + 1).value = label;
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="roster-${month}.xlsx"`,
    },
  });
}
