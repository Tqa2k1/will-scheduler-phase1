import "./globals.css";
import "../components/ui/ui.css";
import { Inter, Noto_Sans_JP } from "next/font/google";
import Providers from "./providers";

// 日本語フォント。next/font が自己ホスト配信するため、外部への追加リクエストは発生しない
const notoSansJP = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-jp",
});

// 欧文・数字用フォント（日本語は Noto Sans JP にフォールバック）
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata = {
  title: "Assign",
  description: "WHILL担当スタッフの勤務スケジュール管理・自動編成システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
