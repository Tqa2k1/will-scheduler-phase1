import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// ログイン必須ページはブラウザにキャッシュさせない（ログアウト後に「戻る」で
// キャッシュされた画面が再表示されるのを防ぐため）
export default withAuth(function middleware(req) {
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
});

// Các trang bắt buộc phải đăng nhập mới xem được
export const config = {
  matcher: ["/dashboard/:path*", "/employees/:path*", "/roster/:path*", "/schedule/:path*", "/tasks/:path*", "/users/:path*", "/shift-requests/:path*"],
};
