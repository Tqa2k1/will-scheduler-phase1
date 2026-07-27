import "./globals.css";

export const metadata = {
  title: "WHILL 勤務管理システム",
  description: "WHILL担当スタッフの勤務スケジュール管理・自動編成システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
