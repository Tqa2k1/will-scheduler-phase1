import type { ReactNode } from "react";

// ASK①・ASK②で共通の「操作手順」表示。今どの段階か（done / current / 以降）が一目で分かる。
// 見た目は ui.css の .ask-steps 系。ASK①とASK②が同じ部品を使うことで、デザイン・色・配置を統一する。
export type AskStep = { label: string; hint: string };

export default function AskSteps({ steps, current }: { steps: AskStep[]; current: number }) {
  const marks = ["①", "②", "③", "④", "⑤"];
  return (
    <ol className="ask-steps" aria-label="操作手順" data-testid="ask-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((st, i) => {
        const no = i + 1;
        const cls = no < current ? "ask-step--done" : no === current ? "ask-step--current" : "";
        return (
          <li key={st.label} className={`ask-step ${cls}`} aria-current={no === current ? "step" : undefined} data-step={no}>
            <span className="ask-step__no">{no < current ? "✓" : no}</span>
            <div>
              <div className="ask-step__label">{marks[i]} {st.label}</div>
              <div className="ask-step__hint">{st.hint}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// 見出し（番号＋役割の一文）。ASK①・ASK②のどの区画が何をする場所かを明確に分ける。
export function AskSection({ no, title, role, children }: { no?: string; title: string; role?: string; children: ReactNode }) {
  return (
    <section className="ask-section">
      <h2 className="ask-section__title">{no && <span className="ask-section__no">{no}</span>}{title}</h2>
      {role && <p className="ask-section__role">{role}</p>}
      {children}
    </section>
  );
}
