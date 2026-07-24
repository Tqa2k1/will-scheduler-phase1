import "./globals.css";

export const metadata = {
  title: "WHILL Scheduler",
  description: "Hệ thống quản lý và tự động phân công lịch làm việc WHILL",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
