import nodemailer from "nodemailer";

export async function sendScheduleConfirmedEmail(params: {
  to: string;
  employeeName: string;
  month: string; // "2026年8月"
  loginUrl: string;
}): Promise<{ ok: boolean; reason?: string }> {

  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    return {
      ok: false,
      reason: "GMAIL_USER または GMAIL_APP_PASSWORD が未設定です",
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPassword,
      },
    });

    await transporter.sendMail({
      from: `WHILL勤務管理 <${gmailUser}>`,
      to: params.to,
      subject: `【WHILL勤務管理】${params.month} の勤務シフトが確定しました`,
      html: `
        <p>${params.employeeName} 様</p>

        <p>${params.month} の勤務シフトが確定しました。</p>

        <p>
          以下のリンクからログインして、
          ご自身の勤務スケジュールをご確認ください。
        </p>

        <p>
          <a href="${params.loginUrl}">
            ${params.loginUrl}
          </a>
        </p>

        <p>
          ※このメールはシステムより自動送信されています。
        </p>
      `,
    });

    return { ok: true };

  } catch (err) {
    console.error("GMAIL ERROR:", err);

    return {
      ok: false,
      reason: String(err),
    };
  }
}