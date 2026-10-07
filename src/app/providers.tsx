"use client";

import { SessionProvider } from "next-auth/react";
import SessionGuard from "./SessionGuard";
import { ToastProvider } from "../components/ui/Toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionGuard />
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
