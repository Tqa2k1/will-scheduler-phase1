// 統合テストの前準備。他のモジュールより先に import すること（ES import は巻き上げられるため、別ファイルにしている）。
//  - インメモリDBを globalThis.prisma に差し込む（src/lib/prisma.ts はこれを優先して使う）
//  - next-auth の getServerSession をテスト用セッションに差し替える
//  - nodemailer をスタブ化する（実送信は絶対にしない。送信内容を記録するだけ）
import { createRequire } from "node:module";
import { createFakePrisma } from "./fakePrisma";

process.env.MAIL_MODE = "dry-run";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

export const fake = createFakePrisma();
(globalThis as any).prisma = fake;

const req = createRequire(__filename);

export type Sess = { user: { email: string; role: string; employeeId: string | null } } | null;
export const session: { current: Sess } = { current: null };

const naPath = req.resolve("next-auth");
const orig = req("next-auth");
req.cache[naPath]!.exports = new Proxy(orig, {
  get(target, prop, receiver) {
    if (prop === "getServerSession") return async () => session.current;
    return Reflect.get(target, prop, receiver);
  },
});

export const sentMails: { to: string; subject: string }[] = [];
const nodemailer = req("nodemailer");
nodemailer.createTransport = () => ({
  sendMail: async (m: { to: string; subject: string }) => {
    sentMails.push({ to: m.to, subject: m.subject });
    return { messageId: "stub" };
  },
});
