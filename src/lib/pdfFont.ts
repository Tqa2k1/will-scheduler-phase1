import fs from "fs";
import path from "path";

// PDF出力用の日本語フォントを探す。pdfkit標準のHelveticaは日本語を描画できないため、
// 日本語（業務名・氏名）が空白や文字化けになってしまう。
// 探す順番: ①環境変数 PDF_FONT_PATH ②プロジェクト同梱の fonts/ipag.ttf（IPAゴシック）
//           ③サーバーにインストールされている代表的な日本語フォント
export function resolveJapaneseFontPath(): string | null {
  const candidates = [
    process.env.PDF_FONT_PATH,
    path.join(process.cwd(), "fonts", "ipag.ttf"),
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "C:\\Windows\\Fonts\\msgothic.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}
