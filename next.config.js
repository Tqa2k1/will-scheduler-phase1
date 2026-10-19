/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfkit は実行時に自分のフォントデータ（data/Helvetica.afm 等）をファイルとして読み込む。
    // webpack でバンドルされるとそのファイルが見つからず PDF 出力が 500 エラーになるため、バンドルから除外する。
    serverComponentsExternalPackages: ["pdfkit", "fontkit"],
    // 日本語フォント（fonts/ipag.ttf）を本番ビルドの出力に含める（サーバーレス環境でも読めるように）
    outputFileTracingIncludes: {
      "/api/export/schedule-pdf": ["./fonts/**/*"],
    },
  },
};
module.exports = nextConfig;
