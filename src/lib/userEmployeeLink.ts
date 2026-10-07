import { prisma } from "@/lib/prisma";

// アカウントに紐付けようとしている従業員が有効かを確認する（問題なければ null を返す）。
// - 存在しない／削除済み（isActive=false）の従業員は紐付けできない
// - すでに別のアカウントに紐付いている従業員は紐付けできない（User.employeeId は一意）
export async function validateLinkableEmployee(
  employeeId: string,
  currentUserId: string | null
): Promise<{ error: string; status: number } | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
  if (!employee || !employee.isActive) {
    return { error: "この従業員は存在しないか、削除済みのため紐付けできません", status: 400 };
  }
  const linked = await prisma.user.findFirst({ where: { employeeId }, select: { id: true } });
  if (linked && linked.id !== currentUserId) {
    return { error: "この従業員は既に別のアカウントに紐付けられています", status: 409 };
  }
  return null;
}
