import { redirect } from "next/navigation";

// 旧「人数設定」画面のURL。勤務時間設定は「スケジュール設定」画面のタブに統合したため、そちらへ転送する（ブックマーク互換）。
export default function ShiftSettingsRedirect() {
  redirect("/tasks?tab=hours");
}
