import { isManagerRole } from "@/lib/roles";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
import Icon, { type IconName } from "@/components/ui/Icon";

type HomeLink = { href: string; label: string; icon: IconName };
type HomeSection = { title: string; links: HomeLink[] };

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

  const role = session.user.role;
  const isManager = isManagerRole(role);
  const roleLabel = role === "ADMIN" ? "管理者" : role === "EMPLOYEE" ? "従業員" : "INC";
  const scheduleHref = `/schedule/${new Date().toISOString().slice(0, 10)}`;

  // 表示する機能と権限条件は従来のメニューと同じ（管理者/INC のみ・従業員のみ・全員）。
  // ASK①・ASK②は「勤務表」画面内のボタンから使う。勤務時間設定は「スケジュール設定」画面のタブに統合。
  const sections: HomeSection[] = isManager
    ? [
        {
          title: "シフト作成",
          links: [
            { href: "/roster", label: "勤務表", icon: "calendar" },
            { href: "/shift-requests", label: "勤務希望確認", icon: "userCheck" },
            { href: scheduleHref, label: "アサイン表", icon: "layoutGrid" },
          ],
        },
        {
          title: "各種設定",
          links: [
            { href: "/tasks", label: "スケジュール設定", icon: "listChecks" },
            { href: "/users", label: "アカウント設定", icon: "user" },
            { href: "/account/password", label: "パスワード変更", icon: "lock" },
          ],
        },
      ]
    : [
        {
          title: "シフト",
          links: [
            { href: "/roster", label: "勤務表", icon: "calendar" },
            { href: scheduleHref, label: "アサイン表", icon: "layoutGrid" },
            { href: "/shift-requests/register", label: "勤務希望登録", icon: "calendarCheck" },
          ],
        },
        {
          title: "アカウント",
          links: [{ href: "/account/password", label: "パスワード変更", icon: "lock" }],
        },
      ];

  // 表示名は従業員情報（正のデータ）を優先。紐付けのないアカウントはアカウントの表示名
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, employee: { select: { fullName: true } } } });
  const displayName = me?.employee?.fullName ?? me?.name ?? session.user.name;

  return (
    <div className="app-page">
      <header className="home-header">
        <div className="home-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Assign ロゴ" width={52} height={52} className="home-brand__logo" />
          <div style={{ minWidth: 0 }}>
            <p className="home-brand__name">Assign</p>
            <h1 className="home-brand__title">ホーム</h1>
            <p className="home-brand__user">ようこそ、{displayName} さん（{roleLabel}）</p>
          </div>
        </div>
        <LogoutButton />
      </header>

      {sections.map((section) => (
        <section key={section.title} className="home-section" aria-label={section.title}>
          <h2 className="home-section__title">{section.title}</h2>
          <div className="home-grid">
            {section.links.map((link) => (
              <Link key={link.href} href={link.href} className="home-tile">
                <span className="home-tile__icon"><Icon name={link.icon} size={22} /></span>
                <span className="home-tile__label">{link.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <div className="home-stats">
        <div className="home-stat">
          <p className="home-stat__label">在籍中の従業員数</p>
          <p className="home-stat__value">{employeeCount}</p>
        </div>
        <div className="home-stat">
          <p className="home-stat__label">本日の出勤予定人数</p>
          <p className="home-stat__value">{todayRoster}</p>
        </div>
      </div>
    </div>
  );
}
