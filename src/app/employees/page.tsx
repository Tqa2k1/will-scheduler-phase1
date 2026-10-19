import { redirect } from "next/navigation";

// 旧「従業員管理」画面のURL。従業員情報はアカウント設定に統合したため、そちらへ転送する（ブックマーク互換）。
export default function EmployeesRedirect() {
  redirect("/users");
}
