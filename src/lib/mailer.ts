import nodemailer from "nodemailer";
import { buildScheduleConfirmedMail } from "@/lib/mailTemplates";

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
      from: `Assign <${gmailUser}>`,
      to: params.to,
      subject: `【Assign】${params.month} 人員不足のお知らせ（希望勤務登録のご案内）`,
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

// 勤務シフト確定メール（ASK②の「メール配信」）。送信モード（MAIL_MODE）に従う:
// 開発・テストでは dry-run（ログ出力のみ・実送信しない）。戻り値の ok=true は「送信（またはdry-run）成功」。
export async function sendScheduleConfirmedEmail(params: {
  to: string;
  employeeName: string;
  month: string; // "2026年8月"
  loginUrl: string;
}): Promise<{ ok: boolean; reason?: string; mode: MailMode }> {
  const { subject, text } = buildScheduleConfirmedMail({
    employeeName: params.employeeName,
    monthLabel: params.month,
    loginUrl: params.loginUrl,
  });
  return deliverPlainText({ to: params.to, subject, text });
}

// ============================================================
// 勤務希望登録フロー用メール（2026-10追加）
// 送信モード（MAIL_MODE）:
//   live    … 実際に送信する（本番のデフォルト）
//   dry-run … 送信せずログのみ（開発・テストのデフォルト）
//   test    … 宛先を MAIL_TEST_TO に差し替えて送信（MAIL_TEST_TO 未設定なら dry-run）
// ============================================================
export type MailMode = "live" | "dry-run" | "test";

export function getMailMode(): MailMode {
  const v = (process.env.MAIL_MODE ?? "").toLowerCase();
  if (v === "live" || v === "dry-run" || v === "test") return v;
  return process.env.NODE_ENV === "production" ? "live" : "dry-run";
}

// 実送信テストを「対象を限定して」行うための許可リスト（MAIL_ALLOWLIST=a@example.com,b@example.com）。
// 設定されている間は、リスト外の宛先には実際には一切送信しない（本番運用に切り替えるときは未設定にする）。
export function getMailAllowlist(): string[] | null {
  const raw = (process.env.MAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return raw.length > 0 ? raw : null;
}
export function isMailAllowed(email: string): boolean {
  const list = getMailAllowlist();
  return !list || list.includes(email.trim().toLowerCase());
}

async function deliverPlainText(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; reason?: string; mode: MailMode }> {
  let mode = getMailMode();
  let to = params.to;
  let subject = params.subject;

  if (mode === "test") {
    const testTo = process.env.MAIL_TEST_TO;
    if (!testTo) mode = "dry-run";
    else {
      subject = `[TEST→${params.to}] ${params.subject}`;
      to = testTo;
    }
  }

  if (mode === "live" && !isMailAllowed(params.to)) {
    return { ok: false, reason: "MAIL_ALLOWLIST に含まれない宛先のため送信しませんでした", mode };
  }

  if (mode === "dry-run") {
    console.log(`[mail:dry-run] to=${params.to} subject=${params.subject}\n${params.text}`);
    return { ok: true, mode };
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    return { ok: false, reason: "GMAIL_USER または GMAIL_APP_PASSWORD が未設定です", mode };
  }
  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } });
    await transporter.sendMail({ from: `Assign <${gmailUser}>`, to, subject, text: params.text });
    return { ok: true, mode };
  } catch (err) {
    console.error("GMAIL ERROR:", err);
    return { ok: false, reason: String(err), mode };
  }
}

// 1回目: 人員不足確定後、バイトの従業員へ送る「勤務希望登録のお願い」。
// 翌月の勤務希望を毎月10日までに登録してもらう案内（不足日程の一覧は載せない）。登録画面のURLだけ付ける。
export async function sendShortageRequestEmail(params: {
  to: string;
  monthLabel: string; // "2026年11月"
  deadlineLabel: string; // "2026年10月10日"
  registerUrl: string;
}) {
  const text = [
    "皆さん",
    "",
    "お疲れ様です。",
    "",
    "翌月のシフト作成のため、勤務希望の登録をお願いいたします。",
    "",
    "翌月の勤務希望は、毎月10日までに登録してください。",
    "",
    "期限内の登録にご協力をお願いいたします。",
    "",
    `■ 対象月：${params.monthLabel}分`,
    `■ 登録期限：${params.deadlineLabel}`,
    "■ 登録はこちら：",
    params.registerUrl,
    "",
    "よろしくお願いいたします。",
  ].join("\n");
  return deliverPlainText({ to: params.to, subject: "翌月の勤務希望登録のお願い", text });
}

// 2回目: シフト調整で選ばれた従業員へ個別に送る「勤務可否のご確認」
export async function sendAvailabilityCheckEmail(params: {
  to: string;
  employeeName: string;
  monthLabel: string; // "2026年11月"
  dateLabel: string; // "11月3日(月)"
  timeLabel: string; // "08:00〜17:00"
}) {
  const text = [
    `${params.employeeName} さん`,
    "",
    "お疲れさまです。",
    `${params.monthLabel}のシフトにおいて、以下の日時で人員が不足しております。`,
    "",
    "■ 勤務をお願いしたい日時",
    `・${params.dateLabel} ${params.timeLabel}`,
    "",
    "この日時にご勤務いただくことは可能でしょうか。",
    "勤務可能な場合は、本メールへの返信、または担当者までご連絡をお願いいたします。",
    "",
    "お手数をおかけしますが、よろしくお願いいたします。",
  ].join("\n");
  return deliverPlainText({
    to: params.to,
    subject: `【勤務可否のご確認】${params.dateLabel} ${params.timeLabel}`,
    text,
  });
}
