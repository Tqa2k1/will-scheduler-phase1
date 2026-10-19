import { KNOWLEDGE, type KnowledgeChunk } from "@/lib/aiKnowledge.generated";

// AIへ渡すプロジェクト知識の検索（外部サービス・埋め込みなし。キーワード一致の軽量な検索で、速く・決定的）。
// 知識の中身は `npm run ai:knowledge` で docs/・コード・DBスキーマから自動生成する（aiKnowledge.generated.ts）。

// 常にAIへ渡す基本情報（短く固定）。権限・禁止事項など、どの質問でも守るべきこと。
export const CORE_KNOWLEDGE = `【Assignの基本】
- Assign は WHILL のシフト管理システム（月間勤務表・日別アサイン表・人員不足の確定とメール・勤務希望の登録と確定）。
- ロール: ADMIN/INC=管理者（編集可）、EMPLOYEE=閲覧のみ。AI機能は管理者のみ。
- AIは「変更案」を返すだけ。DBは変更せず、管理者が画面で「適用」を押した分だけ反映される。
- 勤務ステータス: WORK(出勤) / OFF(公休) / PAID_LEAVE(有休) / ADJUST_LEAVE(調整休)。
- 人数は「登録時に選択したシフト基準」で数える（時間から逆算しない）。勤務希望人数と勤務確定人数は別。
- 実在する従業員名・対象期間内の日付・列挙された値だけを使う。不明な点は推測せず message で伝える。`;

// 日本語は2文字の組、英数字は単語で分割する
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  for (const w of t.match(/[a-z0-9_]{2,}/g) ?? []) out.push(w);
  for (const run of t.match(/[぀-ヿ一-鿿]+/g) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

type Indexed = { chunk: KnowledgeChunk; title: Set<string>; body: Set<string> };
let index: { docs: Indexed[]; df: Map<string, number> } | null = null;

function build() {
  const docs = KNOWLEDGE.map((chunk) => ({
    chunk,
    title: new Set(tokenize(`${chunk.title} ${chunk.keywords.join(" ")} ${chunk.source}`)),
    body: new Set(tokenize(chunk.text)),
  }));
  const df = new Map<string, number>();
  for (const d of docs) for (const tk of new Set([...d.title, ...d.body])) df.set(tk, (df.get(tk) ?? 0) + 1);
  return { docs, df };
}

// 質問に関連する知識を、文字数の上限内で上位から返す
export function retrieveKnowledge(query: string, opts: { limit?: number; maxChars?: number } = {}): KnowledgeChunk[] {
  const { limit = 4, maxChars = 1800 } = opts;
  const q = [...new Set(tokenize(query))];
  if (q.length === 0) return [];
  index ??= build();
  const N = index.docs.length;
  const scored = index.docs
    .map((d) => {
      let score = 0;
      for (const tk of q) {
        const idf = Math.log(1 + N / (index!.df.get(tk) ?? N));
        if (d.title.has(tk)) score += 3 * idf;
        if (d.body.has(tk)) score += idf;
      }
      return { chunk: d.chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: KnowledgeChunk[] = [];
  let used = 0;
  for (const s of scored) {
    if (picked.length >= limit) break;
    if (used + s.chunk.text.length > maxChars && picked.length > 0) continue;
    picked.push(s.chunk);
    used += s.chunk.text.length;
  }
  return picked;
}

// システムプロンプトに足す知識ブロック（基本情報＋質問に関連する資料。出典のファイル名つき）
export function buildKnowledgeBlock(query: string): string {
  const hits = retrieveKnowledge(query);
  const refs = hits.map((h) => `■ ${h.title}（${h.source}）\n${h.text}`).join("\n\n");
  return `\n\n${CORE_KNOWLEDGE}${refs ? `\n\n【関連する資料】\n${refs}` : ""}\n`;
}
