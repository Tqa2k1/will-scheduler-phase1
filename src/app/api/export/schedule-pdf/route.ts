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
import { resolveJapaneseFontPath } from "@/lib/pdfFont";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";
// 常に最新のDBの内容で出力する（キャッシュしない）
export const dynamic = "force-dynamic";

// GET /api/export/schedule-pdf?date=2026-07-01
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

  const nameColWidth = 90;
  const shiftColWidth = 60;
  const timeColWidth = 70;
  const slotColWidth = 36; // 30分1コマ（60分業務は2コマ分=72）
  const pageWidth = nameColWidth + shiftColWidth + timeColWidth + slots.length * slotColWidth + 40;
  const rowHeight = 18;
  const pageHeight = 80 + (rosterItems.length + 1) * rowHeight + 40;

  const doc = new PDFDocument({ size: [pageWidth, pageHeight], margin: 20 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // 日本語フォント（見つからない場合は従来どおりHelvetica＝日本語は表示されない）
  const fontPath = resolveJapaneseFontPath();
  if (fontPath) doc.font(fontPath);
  else console.warn("[schedule-pdf] 日本語フォントが見つかりません。PDF_FONT_PATH を設定するか fonts/ipag.ttf を配置してください。");

  doc.fontSize(12).text(`アサイン表 — ${date}`, 20, 20);

  const cellOpts = (width: number) => ({ width, height: rowHeight - 2, ellipsis: true, lineBreak: false });

  let y = 45;
  let x = 20;
  doc.fontSize(6);
  doc.text("氏名", x, y, cellOpts(nameColWidth));
  x += nameColWidth;
  doc.text("シフト", x, y, cellOpts(shiftColWidth));
  x += shiftColWidth;
  doc.text("勤務時間", x, y, cellOpts(timeColWidth));
  x += timeColWidth;
  for (const s of slots) {
    doc.text(s.start, x, y, cellOpts(slotColWidth));
    x += slotColWidth;
  }

  y += rowHeight;
  const slotsLeft = 20 + nameColWidth + shiftColWidth + timeColWidth;
  for (const r of rosterItems) {
    x = 20;
    doc.text(r.employeeName, x, y, cellOpts(nameColWidth));
    x += nameColWidth;
    doc.text(rosterShiftLabel(r), x, y, cellOpts(shiftColWidth));
    x += shiftColWidth;
    doc.text(r.resolvedStart && r.resolvedEnd ? `${r.resolvedStart}-${r.resolvedEnd}` : "", x, y, cellOpts(timeColWidth));
    for (const c of buildRowCells(r, assignments)) {
      if (!c.active || !c.label) continue; // 勤務時間外・未割当ては空欄
      doc.text(c.label, slotsLeft + c.startIdx * slotColWidth, y, cellOpts(slotColWidth * c.span - 2));
    }
    y += rowHeight;
  }

  doc.end();
  const buffer = await done;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="schedule-${date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
