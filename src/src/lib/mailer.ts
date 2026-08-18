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

// シフト調整メール: 指定日・指定ダイヤ（早番/遅番/明番）が人員不足のとき、
// 出勤できそうな従業員に「希望勤務(KIBO)」登録を促すメールを送る。
export async function sendShiftAdjustmentEmail(params: {
  to: string;
  employeeName: string;
  dateLabel: string; // "2026年8月20日"
  windowLabel: string; // "早番（08:00〜17:00）"
  loginUrl: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    return { ok: false, reason: "GMAIL_USER または GMAIL_APP_PASSWORD が未設定です" };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPassword },
    });

    await transporter.sendMail({
      from: `WHILL勤務管理 <${gmailUser}>`,
      to: params.to,
      subject: `【WHILL勤務管理】${params.dateLabel} ${params.windowLabel} の人員が不足しています`,
      html: `
        <p>${params.employeeName} 様</p>

        <p>${params.dateLabel} の ${params.windowLabel} の人員が不足しています。</p>

        <p>
          もし勤務可能でしたら、システムにログインして「希望勤務（KIBO）」の登録を
          お願いいたします。このメールに直接返信いただく必要はありません。
        </p>

        <p>
          <a href="${params.loginUrl}">${params.loginUrl}</a>
        </p>

        <p>
          ※KIBOはあくまで「希望の登録」です。登録しただけでは勤務確定にはなりません。
          管理者が確認のうえ、確定した場合は別途スケジュールに反映されます。
        </p>

        <p>
          ※このメールはシステムより自動送信されています。
        </p>
      `,
    });

    return { ok: true };
  } catch (err) {
    console.error("GMAIL ERROR:", err);
    return { ok: false, reason: String(err) };
  }
}