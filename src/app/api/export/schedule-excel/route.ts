import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildOperatingDaySlots } from "@/lib/timeSlots";
import ExcelJS from "exceljs";

// GET /api/export/schedule-excel?date=2026-07-01
// Giữ đúng cấu trúc: nhân viên theo hàng, slot 30 phút theo cột, giá trị = mã vị trí (A/B/全/BF/休憩...)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "Thiếu tham số date" }, { status: 400 });

  const workDate = new Date(date);
  const slots = buildOperatingDaySlots();

  const [rosterEntries, assignments] = await Promise.all([
    prisma.monthRoster.findMany({
      where: { workDate, status: "WORK" },
      include: { employee: true, shiftType: true },
    }),
    prisma.dailyAssignment.findMany({
      where: { workDate },
      include: { cartPosition: true },
    }),
  ]);

  const assignMap = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) assignMap.set(`${a.employeeId}-${a.slotStart}`, a);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(date);

  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 10;
  const header = sheet.getRow(1);
  header.getCell(1).value = "氏名";
  header.getCell(2).value = "シフト";
  slots.forEach((s, i) => {
    header.getCell(i + 3).value = s.start;
    sheet.getColumn(i + 3).width = 7;
  });

  rosterEntries.forEach((r, rowIdx) => {
    const row = sheet.getRow(rowIdx + 2);
    row.getCell(1).value = r.employee.fullName;
    row.getCell(2).value = r.shiftType?.code ?? "";
    slots.forEach((s, i) => {
      const a = assignMap.get(`${r.employeeId}-${s.start}`);
      row.getCell(i + 3).value = a?.cartPosition.code ?? "";
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
