import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const employeeCount = await prisma.employee.count({ where: { isActive: true } });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayRoster = await prisma.monthRoster.count({
    where: { workDate: today, status: "WORK" },
  });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: 24 }}>
            Dashboard
          </h1>
          <p style={{ color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            Xin chào, {session.user.name} ({session.user.role === "ADMIN" ? "Admin" : "INC"})
          </p>
        </div>
        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/roster">Master Roster</Link>
          <Link href="/employees">Nhân viên</Link>
        </nav>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div className="card">
          <p className="label">Nhân viên đang hoạt động</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>{employeeCount}</p>
        </div>
        <div className="card">
          <p className="label">Số ca hôm nay đã lập</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>{todayRoster}</p>
        </div>
        <div className="card">
          <p className="label">Slot thiếu người (chưa triển khai Validator)</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0, color: "var(--color-text-muted)" }}>—</p>
        </div>
      </div>

      <p style={{ color: "var(--color-text-muted)", marginTop: 40, fontSize: 13 }}>
        Đây là Phase 0 — nền tảng CRUD + đăng nhập. Các màn hình Master Roster, Daily Assignment,
        Auto-assign sẽ được thêm ở các Phase tiếp theo.
      </p>
    </div>
  );
}
