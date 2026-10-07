import "./globals.css";
import "../components/ui/ui.css";
import { Noto_Sans_JP } from "next/font/google";
import Providers from "./providers";

// 日本語フォント。next/font が自己ホスト配信するため、外部への追加リクエストは発生しない
const notoSansJP = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-jp",
});

export const metadata = {
  title: "A SIGN",
  description: "WHILL担当スタッフの勤務スケジュール管理・自動編成システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
