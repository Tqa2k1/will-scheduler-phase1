import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildOperatingDaySlots } from "@/lib/timeSlots";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

// GET /api/export/schedule-pdf?date=2026-07-01
export async function GET(req: NextRequest) {
const session = await getServerSession(authOptions);

if (!session) {
return NextResponse.json(
{ error: "ログインが必要です" },
{ status: 401 }
);
}

const date = req.nextUrl.searchParams.get("date");

if (!date) {
return NextResponse.json(
{ error: "date パラメータが必要です" },
{ status: 400 }
);
}

const workDate = new Date(date);
const slots = buildOperatingDaySlots();

const [rosterItems, assignments] = await Promise.all([
buildDailyRosterView(workDate),
prisma.dailyAssignment.findMany({
where: { workDate },
include: { cartPosition: true },
}),
]);

const assignMap = new Map<string, (typeof assignments)[number]>();

for (const a of assignments) {
assignMap.set(`${a.employeeId}-${a.slotStart}`, a);
}

const nameColWidth = 110;
const shiftColWidth = 60;
const timeColWidth = 80;
const slotColWidth = 34;

const pageWidth =
nameColWidth +
shiftColWidth +
timeColWidth +
slots.length * slotColWidth +
40;

const rowHeight = 18;
const pageHeight =
80 + (rosterItems.length + 1) * rowHeight + 40;

const doc = new PDFDocument({
size: [pageWidth, pageHeight],
margin: 20,
});

const chunks: Buffer[] = [];

doc.on("data", (chunk: Buffer) => {
chunks.push(chunk);
});

const done = new Promise<Buffer>((resolve) => {
doc.on("end", () => {
resolve(Buffer.concat(chunks));
});
});

doc.fontSize(12).text(`日別スケジュール — ${date}`, 20, 20);

let y = 45;
let x = 20;

doc.fontSize(6);

doc.text("氏名", x, y, { width: nameColWidth });
x += nameColWidth;

doc.text("シフト", x, y, { width: shiftColWidth });
x += shiftColWidth;

doc.text("勤務時間", x, y, { width: timeColWidth });
x += timeColWidth;

for (const s of slots) {
doc.text(s.start, x, y, { width: slotColWidth });
x += slotColWidth;
}

y += rowHeight;

for (const r of rosterItems) {
x = 20;


doc.text(r.employeeName, x, y, {
  width: nameColWidth,
});

x += nameColWidth;

doc.text(
  r.isCarryOver ? "明番(引継)" : r.shiftTypeCode ?? "",
  x,
  y,
  { width: shiftColWidth }
);

x += shiftColWidth;

doc.text(
  r.resolvedStart && r.resolvedEnd
    ? `${r.resolvedStart}-${r.resolvedEnd}`
    : "",
  x,
  y,
  { width: timeColWidth }
);

x += timeColWidth;

slots.forEach((s, i) => {
  if (i >= r.activeStartIdx && i < r.activeEndIdx) {
    const a = assignMap.get(
      `${r.employeeId}-${s.start}`
    );

    doc.text(
      a?.cartPosition.code ?? "",
      x,
      y,
      { width: slotColWidth }
    );
  }

  x += slotColWidth;
});

y += rowHeight;


}

doc.end();

const buffer = await done;

return new NextResponse(
new Uint8Array(buffer),
{
headers: {
"Content-Type": "application/pdf",
"Content-Disposition": `attachment; filename="schedule-${date}.pdf"`,
},
}
);
}
