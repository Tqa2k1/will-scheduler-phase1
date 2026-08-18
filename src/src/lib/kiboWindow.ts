// 希望勤務(KIBO)登録の受付期間: 対象月＝実行日の翌月固定。実行日が当月10日以内のときのみ受付する。
// （既存のプロジェクトにこの締切ルールは存在しなかったため、今回の要件で新規に追加した）
//
// 注意: この関数はもともと src/app/api/shift-claims/route.ts 内に定義していたが、
// Next.js App Router の route.ts は GET/POST等の決められた名前のエクスポートしか許可されない
// （それ以外のexportはビルド時に型エラーになる）ため、このlibファイルに切り出した。
export function isWithinKiboWindow(workDate: Date, now: Date = new Date()): { ok: boolean; reason?: string } {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const sameAsNextMonth =
    workDate.getUTCFullYear() === nextMonth.getUTCFullYear() && workDate.getUTCMonth() === nextMonth.getUTCMonth();
  if (!sameAsNextMonth) {
    return { ok: false, reason: "希望勤務(KIBO)は「翌月分」のみ登録できます" };
  }
  if (now.getUTCDate() > 10) {
    return { ok: false, reason: "希望勤務(KIBO)の登録は当月10日までです（翌月分の受付は既に締め切られています）" };
  }
  return { ok: true };
}
