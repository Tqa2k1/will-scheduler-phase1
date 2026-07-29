// メール送信ユーティリティ。Resend API (https://resend.com) を利用。
// 必須環境変数:
//   RESEND_API_KEY   — Resendのシークレットキー（絶対にソースコードに直接書かない）
//   RESEND_FROM_EMAIL — 送信元メールアドレス（Resend側で認証済みドメインが必要）
// 未設定の場合は送信をスキップし、理由をログに残す（アプリ全体を落とさない）。

export async function sendScheduleConfirmedEmail(params: {
  to: string;
  employeeName: string;
  month: string; // "2026年8月"
  loginUrl: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return { ok: false, reason: "RESEND_API_KEY または RESEND_FROM_EMAIL が未設定です" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: params.to,
        subject: `【WHILL勤務管理】${params.month} の勤務シフトが確定しました`,
        html: `
          <p>${params.employeeName} 様</p>
          <p>${params.month} の勤務シフトが確定しました。</p>
          <p>以下のリンクからログインして、ご自身の勤務スケジュールをご確認ください。</p>
          <p><a href="${params.loginUrl}">${params.loginUrl}</a></p>
          <p>※このメールはシステムより自動送信されています。</p>
        `,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: `Resend API error: ${res.status} ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
