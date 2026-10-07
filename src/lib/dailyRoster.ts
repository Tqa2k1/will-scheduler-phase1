import { prisma } from "@/lib/prisma";
import { resolveWorkTime } from "@/lib/workTime";
import { operatingIndex, hourOf } from "@/lib/timeSlots";

// 1日分のスタッフ一覧を構築する（UI表示とExcel/PDF出力の両方から共通で使う）
//
// ルール:
// - 表示順は role/yakuwari（従業員の役割）では決めない。role と表示順は分離する。
//   ① 勤務開始時刻（営業日インデックス）が早い順
//   ② 開始時刻が同じ場合は、勤務終了時刻が早い順
//   ③ 開始・終了とも同じ場合は、氏名（かな順）による既存の固定順を使用
//   （旧仕様では EmployeeRole === "INC" を常に先頭に固定していたが、これは
//   　現場の「勤務時間の流れに沿った並び」という目的に反するため廃止した）
// - 前日から続く夜勤（例: 22:00-08:00）は、当日シートでは 4:00〜シフト終了時刻 の部分だけを
//   「引き継ぎ」として表示する（本来のシフトは前日シートの 22:00〜24:00超 部分に表示される）
// - 各従業員は「実際に働いている時間帯」の情報 (activeStartIdx/activeEndIdx) を持つ。
//   この範囲外のスロットは表示側で空欄にする。

export type DailyRosterItem = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  shiftTypeCode: string | null;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  activeStartIdx: number; // 営業日インデックス（0=4:00 ... 23=3:00-4:00）
  activeEndIdx: number;   // 排他的境界
  isCarryOver: boolean;   // 前日からの夜勤引き継ぎかどうか
};

export async function buildDailyRosterView(workDate: Date): Promise<DailyRosterItem[]> {
  const prevDate = new Date(workDate);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);

  const [todayEntries, prevEntries] = await Promise.all([
    prisma.monthRoster.findMany({
      where: { workDate, status: "WORK", employee: { isActive: true } },
      include: { employee: true, shiftType: true },
    }),
    prisma.monthRoster.findMany({
      where: { workDate: prevDate, status: "WORK", employee: { isActive: true } },
      include: { employee: true, shiftType: true },
    }),
  ]);

  const items: DailyRosterItem[] = [];

  for (const r of todayEntries) {
    const resolved = resolveWorkTime({
      overrideStartTime: r.overrideStartTime,
      overrideEndTime: r.overrideEndTime,
      shiftType: r.shiftType,
      baseStartTime: r.employee.baseStartTime,
      baseEndTime: r.employee.baseEndTime,
    });
    if (!resolved) continue;

    const startIdx = operatingIndex(hourOf(resolved.start));
    const rawEndIdx = operatingIndex(hourOf(resolved.end));
    // 日をまたぐシフト（例: 22:00-08:00）は当日シート上では24:00（=境界）までで打ち切る
    const spansMidnight = rawEndIdx <= startIdx;
    const endIdx = spansMidnight ? 24 : rawEndIdx;

    items.push({
      employeeId: r.employeeId,
      employeeName: r.employee.fullName,
      employeeRole: r.employee.role,
      shiftTypeCode: r.shiftType?.code ?? null,
      resolvedStart: resolved.start,
      resolvedEnd: resolved.end,
      activeStartIdx: startIdx,
      activeEndIdx: endIdx,
      isCarryOver: false,
    });
  }

  for (const r of prevEntries) {
    const resolved = resolveWorkTime({
      overrideStartTime: r.overrideStartTime,
      overrideEndTime: r.overrideEndTime,
      shiftType: r.shiftType,
      baseStartTime: r.employee.baseStartTime,
      baseEndTime: r.employee.baseEndTime,
    });
    if (!resolved) continue;

    const startIdx = operatingIndex(hourOf(resolved.start));
    const rawEndIdx = operatingIndex(hourOf(resolved.end));
    const spansMidnight = rawEndIdx <= startIdx;
    if (!spansMidnight) continue; // 日をまたがないシフトは引き継ぎ不要

    items.push({
      employeeId: r.employeeId,
      employeeName: r.employee.fullName,
      employeeRole: r.employee.role,
      shiftTypeCode: r.shiftType?.code ?? null,
      resolvedStart: resolved.start,
      resolvedEnd: resolved.end,
      activeStartIdx: 0,
      activeEndIdx: rawEndIdx,
      isCarryOver: true,
    });
  }

  // role/yakuwari による並び替えは行わない。勤務開始時刻→終了時刻→氏名（固定順）の順で並べる。
  items.sort((a, b) => {
    if (a.activeStartIdx !== b.activeStartIdx) return a.activeStartIdx - b.activeStartIdx;
    if (a.activeEndIdx !== b.activeEndIdx) return a.activeEndIdx - b.activeEndIdx;
    return a.employeeName.localeCompare(b.employeeName, "ja");
  });

  return items;
}
