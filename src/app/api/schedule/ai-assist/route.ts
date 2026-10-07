import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requestAiJson, AI_NO_KEY_MESSAGE } from "@/lib/aiAssist";
import { buildDailyRosterView } from "@/lib/dailyRoster";
import { buildDisplaySlots, minutesSinceOperatingStart } from "@/lib/timeSlots";
import { computeShortageCells, isSixtyMinuteCode } from "@/lib/dutySchedule";
import { getRequiredHeadcountBySlot } from "@/lib/shiftRequirements";
import { loadDemandByCode } from "@/lib/scheduleDemand";
import { buildRowCells } from "@/lib/scheduleGrid";

const InputSchema = z.object({
  date: z.string(),
  prompt: z.string().optional(),
});

const pad = (n: number) => n.toString().padStart(2, "0");
const hourClock = (hourIdx: number) => `${pad((4 + hourIdx) % 24)}:00`;

// POST /api/schedule/ai-assist — 日別スケジュールのAI変更案（管理者のみ）。DBは変更しない（提案のみ）。
// 月間勤務表の「AI追加」(/api/roster/ai-assist)と同じ仕組み:
//   AIは提案だけを返し、管理者が画面で「適用」を押した時に、手動編集と同じ保存処理（/api/schedule）で反映する。
// 入力データは日別スケジュール画面と同じ:
//   在籍中の従業員のその日の勤務（buildDailyRosterView）・現在の割当て・配置状況（不足）・有効な業務一覧。
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "AI機能は管理者のみ利用できます" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { date, prompt } = parsed.data;

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ message: AI_NO_KEY_MESSAGE, changes: [] });

  const workDate = new Date(date);
  const [rosterItems, assignments, positions, demandByCode, totalBySlot] = await Promise.all([
    buildDailyRosterView(workDate),
    prisma.dailyAssignment.findMany({ where: { workDate }, include: { cartPosition: true } }),
    prisma.cartPosition.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    loadDemandByCode(),
    getRequiredHeadcountBySlot(),
  ]);

  // --- AIに渡す現状 ---
  const slots = buildDisplaySlots();
  const rosterLines = rosterItems.map((r) => {
    const cells = buildRowCells(r, assignments);
    // 連続する同じ業務をまとめる（例: 08:00-10:00 Aカート）。未割当て・勤務時間外のコマで途切れる。
    const runs: { label: string; start: number; end: number }[] = [];
    for (const c of cells) {
      if (!c.active || !c.label) continue;
      const last = c.startIdx + c.span - 1;
      const tail = runs[runs.length - 1];
      if (tail && tail.label === c.label && tail.end === c.startIdx - 1) tail.end = last;
      else runs.push({ label: c.label, start: c.startIdx, end: last });
    }
    const parts = runs.map((run) => `${slots[run.start].start}-${slots[run.end].end} ${run.label}`);
    const work = `${hourClock(r.activeStartIdx)}-${hourClock(r.activeEndIdx)}`;
    return `${r.employeeName}（勤務 ${work}${r.isCarryOver ? "・前日からの引継" : ""}）: ${parts.join(" / ") || "割当てなし"}`;
  });

  const shortageCells = computeShortageCells(
    assignments.map((a) => ({ code: a.cartPosition.code, slotStart: a.slotStart, slotEnd: a.slotEnd })),
    demandByCode,
    totalBySlot
  );
  const nameByCode = new Map(positions.map((p) => [p.code, p.name]));
  const shortageLines = shortageCells.map(
    (c) => `${hourClock(c.hourIdx)} ${nameByCode.get(c.code) ?? c.code}: 必要${c.required}名 / 配置${c.actual}名`
  );
  const positionLines = positions.map(
    (p) => `${p.code}（${p.name}）${isSixtyMinuteCode(p.code) ? " ※60分単位" : ""}`
  );

  const system = `
あなたはWHILLの日別スケジュール（業務割当て）を調整するAIです。

必ずJSONのみ返してください。説明文は禁止です。

形式:

{
 "message":"説明",
 "changes":[
  {
   "employeeName":"社員名",
   "start":"HH:MM",
   "positionCode":"業務コード"
  }
 ]
}

ルール:

- 「勤務中の従業員」に載っている社員だけを使い、勤務時間内の時刻だけを指定する
- start は30分単位（HH:00 または HH:30）。「※60分単位」の業務は必ず HH:00 で開始し、その1時間全体が置き換わる
- positionCode は「利用できる業務」に載っているコードだけを使う
- 「配置状況（不足）」を解消する提案を優先する。必要のない変更はしない
- データベース変更は禁止。変更提案だけ返す
`;

  const user = `
対象日: ${date}

勤務中の従業員と現在の割当て:
${rosterLines.join("\n") || "勤務者なし"}

配置状況（不足）:
${shortageLines.join("\n") || "不足なし"}

利用できる業務:
${positionLines.join("\n")}

管理者からの依頼:
${prompt || "不足している時間帯を解消する割当て案を提案してください"}
`;

  const result = await requestAiJson(system, user);

  // --- 提案の検証（存在しない従業員・勤務時間外・不正な業務は除外。適用に必要なIDを付けて返す） ---
  const positionByCode = new Map(positions.map((p) => [p.code, p]));
  const seen = new Set<string>();
  const changes: {
    employeeId: string;
    employeeName: string;
    start: string;
    slotIdx: number;
    cartPositionId: string;
    positionCode: string;
    positionName: string;
  }[] = [];

  for (const c of result.changes as any[]) {
    if (!c || typeof c.employeeName !== "string" || typeof c.start !== "string" || typeof c.positionCode !== "string") continue;
    const position = positionByCode.get(c.positionCode);
    if (!position) continue;
    const m = /^(\d{1,2}):(\d{2})$/.exec(c.start.trim());
    if (!m || (m[2] !== "00" && m[2] !== "30")) continue;
    let slotIdx = Math.floor(minutesSinceOperatingStart(`${pad(Number(m[1]))}:${m[2]}`) / 30);
    if (isSixtyMinuteCode(position.code)) slotIdx = Math.floor(slotIdx / 2) * 2; // 60分業務は1時間の頭から
    if (slotIdx < 0 || slotIdx > 47) continue;
    const hourIdx = Math.floor(slotIdx / 2);
    // 同名の従業員（前日からの引継と当日勤務など）がいる場合は、その時刻に勤務している方を使う
    const item = rosterItems.find(
      (r) => r.employeeName === c.employeeName && hourIdx >= r.activeStartIdx && hourIdx < r.activeEndIdx
    );
    if (!item) continue;
    const key = `${item.employeeId}-${slotIdx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push({
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      start: slots[slotIdx].start,
      slotIdx,
      cartPositionId: position.id,
      positionCode: position.code,
      positionName: position.name,
    });
  }

  return NextResponse.json({ message: result.message, changes });
}
