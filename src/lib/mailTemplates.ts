// 「勤務シフト確定」メールの文面。ASK②のプレビューと実際の送信で同じ関数を使い、表示と送信内容がずれないようにする。
// 純粋関数（DB・環境変数に依存しない）。

export function buildScheduleConfirmedMail(params: { employeeName: string; monthLabel: string; loginUrl: string }) {
  const subject = `【Assign】${params.monthLabel} の勤務シフトが確定しました`;
  const text = [
    `${params.employeeName} 様`,
    "",
    `${params.monthLabel} の勤務シフトが確定しました。`,
    "",
    "以下のリンクからログインして、勤務表（全員分の月間スケジュール）をご確認ください。",
    params.loginUrl,
    "",
    "※このメールはシステムより自動送信されています。",
  ].join("\n");
  return { subject, text };
}
