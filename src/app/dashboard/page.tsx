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
  today.setUTCHours(0, 0, 0, 0);

  const todayRoster = await prisma.monthRoster.count({
where: {
workDate: today,
status: "WORK",
employee: {
isActive: true,
},
},
});

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: 24 }}>
            ダッシュボード
          </h1>
          <p style={{ color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            ようこそ、{session.user.name} さん（{session.user.role === "ADMIN" ? "管理者" : session.user.role === "EMPLOYEE" ? "従業員" : "INC"}）
          </p>
        </div>
        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/roster">月間勤務表</Link>
          <Link href={`/schedule/${new Date().toISOString().slice(0, 10)}`}>日別スケジュール</Link>
          <Link href="/shift-requests">勤務希望申請</Link>
          {session.user.role === "ADMIN" && (
            <>
              <Link href="/tasks">業務管理</Link>
              <Link href="/employees">従業員管理</Link>
              <Link href="/users">アカウント管理</Link>
            </>
          )}
        </nav>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div className="card">
          <p className="label">在籍中の従業員数</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>{employeeCount}</p>
        </div>
        <div className="card">
          <p className="label">本日の出勤予定人数</p>
          <p style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>{todayRoster}</p>
        </div>
      </div>
    </div>
  );
}
