import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

// GET /api/export/roster-excel?month=2026-07
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "Thiếu tham số month" }, { status: 400 });

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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${month}`);

  sheet.getColumn(1).width = 20;
  const header = sheet.getRow(1);
  header.getCell(1).value = "氏名"; // Họ tên — giữ nguyên nhãn tiếng Nhật như file gốc
  for (let d = 1; d <= numDays; d++) {
    header.getCell(d + 1).value = d;
    sheet.getColumn(d + 1).width = 8;
  }

  employees.forEach((emp, rowIdx) => {
    const row = sheet.getRow(rowIdx + 2);
    row.getCell(1).value = emp.fullName;
    for (let d = 1; d <= numDays; d++) {
      const entry = entryMap.get(`${emp.id}-${d}`);
      let label = "";
      if (entry?.status === "PAID_LEAVE") label = "有休";
      else if (entry?.status === "ADJUST_LEAVE") label = "調整休";
      else if (entry?.shiftType) label = entry.shiftType.code;
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
