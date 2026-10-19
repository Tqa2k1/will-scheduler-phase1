// 権限判定の共通関数。
// ADMIN（システム管理者）と INC（シフト管理者）は、勤務表・勤務希望・人員不足確定などの
// 運用操作を同じ権限で行える。アカウント管理（/api/users 系）だけは ADMIN 専用のまま。
export function isManagerRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "INC";
}
