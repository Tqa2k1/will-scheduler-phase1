import { Badge, Card, Icon, Notice } from "../../components/ui";

// ダッシュボードに常時表示する「連絡先・事象発生時の連絡フロー・運用上の注意」。
// 固定の案内文のみで、データ取得や状態は持たない。
// 電話番号は tel: リンクにして、スマートフォンからそのまま発信できるようにしている。

type Contact = {
  label: string;
  numbers: { note?: string; display: string }[];
};

const CONTACTS: Contact[] = [
  { label: "INC携帯", numbers: [{ display: "080-1022-3500" }] },
  {
    label: "TIAT旅客サービスセンター",
    numbers: [{ display: "03-6428-0800" }, { note: "お客様用", display: "03-5757-8111" }],
  },
  { label: "ACT管理職（新橋）", numbers: [{ display: "090-6927-4225" }] },
];

function telHref(display: string) {
  return `tel:${display.replace(/-/g, "")}`;
}

export default function ContactPanel() {
  return (
    <div className="dash-section">
      <Card title="連絡先" description="電話番号をタップすると発信できます。">
        <div className="dash-contacts">
          {CONTACTS.map((c) => (
            <div key={c.label} className="dash-contact">
              <span className="dash-contact__icon"><Icon name="phone" size={18} /></span>
              <div>
                <p className="dash-contact__label">{c.label}</p>
                {c.numbers.map((n) => (
                  <p key={n.display} className="dash-contact__row">
                    {n.note && <span className="dash-contact__note">{n.note}</span>}
                    <a className="dash-contact__num" href={telHref(n.display)}>{n.display}</a>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="事象発生時の連絡フロー">
        <div className="dash-flow">
          <span className="dash-flow__start">
            <Badge tone="neutral" icon="alert">事象発生</Badge>
          </span>
          <span className="dash-flow__arrow"><Icon name="arrowRight" size={20} /></span>
          <div className="dash-flow__branches">
            <div className="dash-branch dash-branch--inc">
              <span className="dash-branch__when"><Badge tone="error" icon="check">INCがいるとき</Badge></span>
              <Icon name="arrowRight" size={16} />
              <strong className="dash-branch__action">INCへ連絡する</strong>
            </div>
            <div className="dash-branch dash-branch--absent">
              <span className="dash-branch__when"><Badge tone="info" icon="minus">INC不在のとき</Badge></span>
              <Icon name="arrowRight" size={16} />
              <strong className="dash-branch__action">新橋さんへ連絡する</strong>
            </div>
          </div>
        </div>
        <p className="dash-flow__note">
          <Icon name="info" size={14} />
          TIAT旅客サービスセンターへの連絡は不要です（INC・管理職が連絡します）。
        </p>
      </Card>

      <Notice tone="warning" title="ご確認ください">
        <ul className="dash-checklist">
          <li><Icon name="check" size={14} />予約表確認を徹底するようお願いします。</li>
          <li><Icon name="check" size={14} />予約受付・終了のTELは不要です。</li>
        </ul>
      </Notice>
    </div>
  );
}
