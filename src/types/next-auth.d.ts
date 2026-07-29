import { DefaultSession } from "next-auth";

// Mở rộng type để session có thêm role + id
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "INC" | "EMPLOYEE";
    } & DefaultSession["user"];
  }
}
