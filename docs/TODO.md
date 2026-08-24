# TODO - WHILL Scheduler


## ✅ 完了 (2026-08-07 v4)

### 自動アサイン: 休憩・夜勤・持ち場交代の品質改善
- [x] パートスタッフへの休憩付与を廃止
- [x] 8時間以上勤務者が休憩を取れない不具合を修正（空きが無ければduty配置を1つ明け渡す）
- [x] 休憩タイミングを「経過4時間に最も近い」を最優先にするよう精度向上
- [x] 日をまたぐ夜勤で休憩が二重（最大4時間）になる不具合を発見・修正
      （断片ごとの「休憩配置の責任」を決定的に1つに絞る設計へ変更）
- [x] 持ち場交代の目安を「2時間優先・3時間まで許容」に変更、交代候補がいない場合は
      運用安定を優先して継続する挙動を維持
- [x] 交代時に「直前と別の業務」を優先するロジックを追加
- [x] デバッグログを大幅拡充（選定理由・却下理由・交代理由・休憩理由・強制確保の記録）
- [x] Prisma接続なしのシミュレーションテストで主要シナリオ（夜勤2断片・通常勤務・
      パート・強制休憩確保・ローテーション）を検証

### 今後の検証候補
- [ ] 実データ（実際のDB・実際の従業員構成）でのステージング環境での動作確認
      （今回はモックデータによるロジック検証のみ。本番相当のデータボリュームでの
      パフォーマンス・実際のシフトパターンとの整合性は未検証）
- [ ] 休憩確保のためのduty強制取消しが頻発する場合、TaskRequirementの必要人数設定
      （現状デフォルト4名など）と実際のスタッフ人数のバランスを運用側で見直す必要がないか確認


## ✅ 完了 (2026-08-07)

### 日別スケジュール・自動アサイン修正
- [x] 日別スケジュール画面から「シフト」列を削除（DBのShiftType関連は変更なし）
- [x] 社員表示順をrole/yakuwariから分離し、勤務開始時刻→終了時刻→氏名の順に変更
- [x] 「配置状況」の不足計算を、各業務(A/B/全)自身の稼働時間内のみで判定するよう修正
      （稼働時間外の誤った不足表示を解消）
- [x] 「配置状況」の不足計算にWHILL関連業務4件を追加
- [x] 休憩配置を「実際のシフト開始時刻からの経過時間」基準に変更（勤務開始直後・終了直前の
      休憩を防止、日付をまたぐ夜勤での不自然な休憩・二重休憩を修正）
- [x] 自動アサインでRolePriority（業務優先順位）を実際に反映するよう修正
- [x] src/lib/dutySchedule.ts を新設し、サーバー(自動アサイン)とクライアント(配置状況表示)で
      稼働時間・必要人数の定義を一本化

### 未対応・要検討（今回のスコープ外として残したもの）
- [ ] Excel/PDF出力（`/api/export/schedule-excel`, `/api/export/schedule-pdf`）にはまだ
      「シフト」列が残っている。画面と出力の表示を揃えたい場合は別途対応が必要。
- [ ] `src/lib/dailyStaffing.ts`（`ShiftClaimRequest`が使う日単位の不足指標）は時間帯を
      考慮しない設計のまま。時間帯別の不足を反映したい場合は`dutySchedule.ts`を使って
      作り直す必要がある。
- [ ] `autoBackfill.ts`（欠勤時の自動代替配置）はA/B/全のみ対象で、WHILL関連業務・休憩・
      事務時間の優先順位ルールには対応していない。


## ✅ 完了 (2026-08-06)

### Auto Schedule Engine
- [x] Viết lại src/lib/autoAssign.ts theo bộ quy tắc ưu tiên mới (A → B → 全 → WHILL → nghỉ → 事務時間)
- [x] Hỗ trợ A 05:00-26:00
- [x] Hỗ trợ B 06:00-24:00
- [x] Hỗ trợ 全 05:00-25:00
- [x] Thêm WHILL到着準備 / WHILL到着片づけ / WHILL出発準備 / WHILL出発片づけ (giờ + số người cố định)
- [x] Thêm 事務時間 (chỉ dùng thời gian còn thừa, không cấp cho PARTTIME)
- [x] Cải thiện logic nghỉ (3-5h đối với ca thường, 2h liên tục đối với 明け番, so le giữa các nhân viên)
- [x] Rotation 1-3 giờ cho A/B/全 (không để 1 người giữ vị trí quá lâu)
- [x] PARTTIME chỉ được xếp A/B/全 (không WHILL, không 事務時間)
- [x] Cập nhật docs/AUTO_ASSIGN_RULES.md làm tài liệu tham chiếu chính cho thuật toán

## 🔴 High Priority (Quan trọng)

### Security
- [x] Kiểm tra tất cả API route có getServerSession — đã quét toàn bộ `route.ts`, chỉ thiếu ở
      NextAuth handler (đúng, không cần check ở đó).
- [x] **Đã vá**: `/api/ai-confirm` và `/api/roster/apply-ai-changes` đã thêm getServerSession +
      kiểm tra role ADMIN (2026-08).
- [x] ~~Giới hạn EMPLOYEE chỉ xem dữ liệu của bản thân~~ → đã đổi ngược lại theo yêu cầu nghiệp vụ:
      EMPLOYEE được xem toàn bộ 日別スケジュール (ai làm gì, giờ nào, 業務 gì), chỉ không được
      sửa/tạo/xóa. Đây là chủ đích, không phải lỗ hổng (xem GET /api/schedule).
- [ ] Đồng bộ quyền ADMIN / INC / EMPLOYEE
- [ ] Kiểm tra API export Excel/PDF

### Auto Schedule Engine (việc còn lại sau đợt cập nhật 2026-08-06)
- [ ] Xác nhận với nghiệp vụ: `TaskRequirement` mặc định requiredCount=4 cho A/B/全 (trong
      prisma/seed.ts) có đúng ý nghĩa "基本的に各時間1名配置" trong quy tắc mới hay không.
- [ ] Cân nhắc đưa số người cần thiết của 4 sự kiện WHILL (hiện đang hardcode trong
      `WHILL_EVENTS`) vào bảng `TaskRequirement` để admin chỉnh được từ màn hình /tasks.
- [ ] `src/lib/autoBackfill.ts` (tự động thay người khi nghỉ đột xuất) chưa được cập nhật để
      tuân theo thứ tự ưu tiên mới (A→B→全→WHILL→nghỉ→事務時間) — hiện chỉ backfill A/B/全.
      Cần xác nhận có cần mở rộng backfill sang cả WHILL hay không.
- [ ] Viết test tự động (hiện chưa có test nào trong project) cho `buildAutoAssignPlan`.


## 🟡 Medium Priority

### Schedule
- [ ] Cải thiện giao diện bảng lịch
- [ ] Sticky cột nhân viên
- [ ] Kiểm tra hiển thị lịch ngày

### Notification
- [ ] Kiểm tra email notification
- [ ] Kiểm tra spam mail
- [ ] Hoàn thiện template email


## 🟢 Future

- [ ] AI hỗ trợ tạo lịch
- [ ] Phân tích thiếu nhân lực
- [ ] Báo cáo nhân sự
- [ ] Mobile support
