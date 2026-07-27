import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/login");

  const employeeCount = await prisma.employee.count({
    where: { isActive: true },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayRoster = await prisma.monthRoster.count({
    where: {
      workDate: today,
      status: "WORK",
    },
  });

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "40px 24px",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 40,
          flexWrap: "wrap",
          gap: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              margin: 0,
              fontSize: 32,
            }}
          >
            ダッシュボード
          </h1>

          <p
            style={{
              color: "var(--color-text-muted)",
              marginTop: 8,
            }}
          >
            ようこそ、{session.user.name} さん
          </p>
        </div>

        <nav
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Link href="/dashboard">ダッシュボード</Link>
          <Link href="/employees">社員一覧</Link>
          <Link href="/roster">月間勤務表</Link>
        </nav>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(250px, 1fr))",
          gap: 20,
        }}
      >
        <div className="card">
          <p className="label">在籍社員数</p>

          <p
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
            }}
          >
            {employeeCount} 名
          </p>
        </div>

        <div className="card">
          <p className="label">本日の出勤人数</p>

          <p
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
            }}
          >
            {todayRoster} 名
          </p>
        </div>

        <div className="card">
          <p className="label">未配置のシフト</p>

          <p
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              color: "var(--color-text-muted)",
            }}
          >
            —
          </p>
        </div>
      </div>

      <div
        className="card"
        style={{
          marginTop: 30,
        }}
      >
        <h3
          style={{
            marginTop: 0,
          }}
        >
          システム情報
        </h3>

        <p
          style={{
            color: "var(--color-text-muted)",
            lineHeight: 1.8,
            marginBottom: 0,
          }}
        >
          勤務管理システムでは、社員情報、月間勤務表、
          日別スケジュールおよび自動アサイン機能を管理します。
          今後、Excel出力・PDF出力・勤務時間の個別設定機能などを
          順次追加予定です。
        </p>
      </div>
    </div>
  );
}