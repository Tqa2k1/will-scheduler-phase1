import nodemailer from "nodemailer";

// 月次シフト調整で、対象従業員に「対応可能なシフト一覧」を通知するメール。
// 各従業員には、その人が実際に対応可能なシフトだけを記載する（全員に同じ内容を送らない）。
export async function sendKiboInviteEmail(params: {
  to: string;
  employeeName: string;
  month: string; // "2026年9月"
  shifts: { date: string; shiftLabel: string }[];
  loginUrl: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    return { ok: false, reason: "GMAIL_USER または GMAIL_APP_PASSWORD が未設定です" };
  }

  const shiftListHtml = params.shifts
    .map((s) => `<li>${s.date} ${s.shiftLabel}</li>`)
    .join("");

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPassword },
    });

    await transporter.sendMail({
      from: `WHILL勤務管理 <${gmailUser}>`,
      to: params.to,
      subject: `【WHILL勤務管理】${params.month} 人員不足のお知らせ（希望勤務登録のご案内）`,
      html: `
        <p>${params.employeeName} 様</p>

        <p>${params.month} は以下のシフトで人員が不足しています。
        対応可能な場合は、システムにログインして「希望勤務（KIBO）」の登録をお願いいたします。</p>

        <ul>${shiftListHtml}</ul>

        <p>
          <a href="${params.loginUrl}">${params.loginUrl}</a>
        </p>

        <p>
          ※本メールへの返信は不要です。希望勤務の登録はシステム上で行ってください。
        </p>
      `,
    });

    return { ok: true };
  } catch (err) {
    console.error("GMAIL ERROR:", err);
    return { ok: false, reason: String(err) };
  }
}

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