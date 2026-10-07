import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import NavMenu from "./NavMenu";
import ContactPanel from "./ContactPanel";

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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="A SIGN ロゴ" width={52} height={52} style={{ width: 52, height: 52, flex: "none" }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>A SIGN</p>
            <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: 24 }}>
              ダッシュボード
            </h1>
            <p style={{ color: "var(--color-text-muted)", margin: "4px 0 0" }}>
              ようこそ、{session.user.name} さん（{session.user.role === "ADMIN" ? "管理者" : session.user.role === "EMPLOYEE" ? "従業員" : "INC"}）
            </p>
          </div>
        </div>
        <nav style={{ marginLeft: "auto" }}>
          <NavMenu
            userName={session.user.name ?? ""}
            roleLabel={session.user.role === "ADMIN" ? "管理者" : session.user.role === "EMPLOYEE" ? "従業員" : "INC"}
            links={[
              { href: "/roster", label: "月間勤務表" },
              { href: `/schedule/${new Date().toISOString().slice(0, 10)}`, label: "日別スケジュール" },
              { href: "/shift-requests", label: "勤務希望申請" },
              { href: "/users", label: session.user.role === "ADMIN" ? "アカウント管理" : "パスワード変更" },
              ...(session.user.role === "ADMIN"
                ? [
                    { href: "/tasks", label: "業務管理" },
                    { href: "/shift-settings", label: "シフト必要人数設定" },
                    { href: "/employees", label: "従業員管理" },
                  ]
                : []),
            ]}
          />
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

      <ContactPanel />
    </div>
  );
}
