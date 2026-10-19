// AI用プロジェクト知識の生成。実行: `npm run ai:knowledge`（検証だけなら `npm run ai:knowledge:check`）
// 入力: 運用ドキュメント（docs/*.md ほか）＋コードから自動抽出（DBスキーマ・APIの権限・src/lib の概要コメント）
// 出力: src/lib/aiKnowledge.generated.ts（実行時にファイルを読まず、バンドルに含める）
// ドキュメントやコードを変更したら再生成する（テストで古いままだと失敗する）。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/lib/aiKnowledge.generated.ts");
const MAX_CHUNK = 900;

type Chunk = { id: string; title: string; source: string; keywords: string[]; text: string };
const chunks: Chunk[] = [];
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const slug = (s: string) => s.replace(/[^\w぀-ヿ一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// 1) ドキュメント: 見出しごとに分割し、長いものは段落単位でさらに分割する
const DOCS = [
  "PROJECT_OVERVIEW.md", "docs/WORKFLOWS.md", "docs/HEADCOUNT_RULES.md", "docs/PERMISSIONS.md", "docs/DATA_FLOW.md",
  "docs/BUSINESS_RULES.md", "docs/AUTO_ASSIGN_RULES.md", "docs/DATABASE.md", "docs/ARCHITECTURE.md",
];
for (const file of DOCS) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const lines = read(file).split("\n");
  let title = file;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (body.length < 30) return;
    // 長い節は段落単位で分割
    let part = "";
    let n = 0;
    const push = () => {
      if (!part.trim()) return;
      chunks.push({ id: `${slug(file)}:${slug(title)}:${n++}`, title, source: file, keywords: [], text: part.trim() });
      part = "";
    };
    for (const para of body.split(/\n\s*\n/)) {
      if (part.length + para.length > MAX_CHUNK) push();
      part += (part ? "\n\n" : "") + para;
    }
    push();
  };
  for (const l of lines) {
    const m = /^#{1,3}\s+(.*)$/.exec(l);
    if (m) { flush(); title = m[1].trim(); } else buf.push(l);
  }
  flush();
}

// 2) DBスキーマ: モデル名と項目名の要約
{
  const schema = read("prisma/schema.prisma");
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  const lines: string[] = [];
  while ((m = re.exec(schema))) {
    const fields = m[2].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/).slice(0, 2).join(":")).filter((f) => !/\[\]$/.test(f));
    lines.push(`${m[1]}(${fields.join(", ")})`);
  }
  let part = ""; let n = 0;
  for (const l of lines) { if (part.length + l.length > MAX_CHUNK) { chunks.push({ id: `schema:${n}`, title: "DBスキーマ（Prisma）", source: "prisma/schema.prisma", keywords: ["DB", "テーブル", "データベース", "モデル", "スキーマ", "項目"], text: part }); part = ""; n++; } part += l + "\n"; }
  if (part) chunks.push({ id: `schema:${n}`, title: "DBスキーマ（Prisma）", source: "prisma/schema.prisma", keywords: ["DB", "テーブル", "データベース", "モデル", "スキーマ", "項目"], text: part });
}

// 3) API: ルートごとのHTTPメソッドと権限の種類（コードから自動抽出）
{
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const src = fs.readFileSync(p, "utf8");
        const methods = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((x) => x[1]);
        const auth = /role\s*!==\s*"ADMIN"/.test(src) && !/isManagerRole/.test(src) ? "ADMINのみ"
          : /isManagerRole/.test(src) ? "ADMIN/INC" : /getServerSession/.test(src) ? "ログイン必須" : "公開";
        const url = "/" + path.relative(path.join(ROOT, "src/app"), path.dirname(p)).split(path.sep).join("/");
        out.push(`${methods.join("/")} ${url} — ${auth}`);
      }
    }
  };
  walk(path.join(ROOT, "src/app/api"));
  out.sort();
  let part = ""; let n = 0;
  for (const l of out) { if (part.length + l.length > MAX_CHUNK) { chunks.push({ id: `api:${n}`, title: "APIと権限", source: "src/app/api", keywords: ["API", "権限", "エンドポイント", "認証"], text: part }); part = ""; n++; } part += l + "\n"; }
  if (part) chunks.push({ id: `api:${n}`, title: "APIと権限", source: "src/app/api", keywords: ["API", "権限", "エンドポイント", "認証"], text: part });
}

// 4) コード地図: src/lib の各ファイル先頭のコメント（役割）。AIが「どのコードを見ればよいか」を答えられるようにする
{
  const dir = path.join(ROOT, "src/lib");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes(".generated."))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const comment = src.split("\n").filter((l) => l.trim().startsWith("//")).slice(0, 6).map((l) => l.replace(/^\s*\/\/+\s?/, "")).join(" ").slice(0, 500);
    if (!comment) continue;
    chunks.push({ id: `code:${f}`, title: `コード: src/lib/${f}`, source: `src/lib/${f}`, keywords: [f.replace(/\.ts$/, "")], text: comment });
  }
}

const body = `// 自動生成ファイル。編集しないこと。更新: npm run ai:knowledge （元: docs/*.md・PROJECT_OVERVIEW.md・prisma/schema.prisma・src/app/api・src/lib）
export type KnowledgeChunk = { id: string; title: string; source: string; keywords: string[]; text: string };
export const KNOWLEDGE: KnowledgeChunk[] = ${JSON.stringify(chunks, null, 1)};
`;

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== body) { console.error("src/lib/aiKnowledge.generated.ts が古いです。`npm run ai:knowledge` を実行してください。"); process.exit(1); }
  console.log(`ai knowledge up to date (${chunks.length} chunks)`);
} else {
  fs.writeFileSync(OUT, body);
  console.log(`generated ${chunks.length} chunks -> src/lib/aiKnowledge.generated.ts (${body.length} bytes)`);
}
