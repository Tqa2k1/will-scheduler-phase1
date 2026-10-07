import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Cấu hình đăng nhập bằng email + mật khẩu, 2 role: ADMIN / INC
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60, // 12時間（副次的な安全策。メインの制御はsessionStorageベースの強制ログアウトで行う）
  },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Đăng nhập",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mật khẩu", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          employeeId: user.employeeId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // 管理者がアカウントを削除した場合、発行済みのセッションも無効にする
      // （エラーを投げるとNextAuthがセッションを破棄し、未ログイン扱いになる）。
      if (!user && token.id) {
        let exists = true;
        try {
          exists = !!(await prisma.user.findUnique({ where: { id: token.id as string }, select: { id: true } }));
        } catch {
          // DB一時障害時は既存の挙動を維持（ログアウトさせない）
        }
        if (!exists) throw new Error("アカウントが削除されました");
      }
      if (user) {
        token.role = (user as any).role;
        token.id = (user as any).id;
        token.employeeId = (user as any).employeeId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
        (session.user as any).employeeId = token.employeeId ?? null;
      }
      return session;
    },
  },
};