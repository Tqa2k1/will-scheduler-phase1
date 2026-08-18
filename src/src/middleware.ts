export { default } from "next-auth/middleware";

// Các trang bắt buộc phải đăng nhập mới xem được
export const config = {
  matcher: ["/dashboard/:path*", "/employees/:path*", "/roster/:path*", "/schedule/:path*", "/tasks/:path*", "/users/:path*", "/shift-requests/:path*", "/shift-adjustment/:path*"],
};
