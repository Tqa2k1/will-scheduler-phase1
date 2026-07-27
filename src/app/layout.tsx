import "./globals.css";

export const metadata = {
  title: "WHILL勤務管理システム",
  description: "WHILLの勤務表・シフト・日別アサイン管理システム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}