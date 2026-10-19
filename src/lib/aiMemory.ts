import { prisma } from "@/lib/prisma";

// AI依頼の「整理済みメモ」。会話の全文は保存せず、管理者の依頼の要点と結果の要約だけを月ごとに少数保持し、次回の依頼で再利用する。
//  - 既定の依頼文（空の依頼）や短すぎる依頼は保存しない（重要でないため）。
//  - 同じ内容は重複して保存しない。月ごとに最新 MAX_NOTES 件だけ残し、古いものは削除する。
//  - メモの保存・読み出しに失敗しても（テーブル未作成など）AI依頼自体は止めない。
export const MAX_NOTES = 20;
const USE_NOTES = 5;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function makeNote(prompt: string, message: string): string | null {
  const p = prompt.replace(/\s+/g, " ").trim();
  if (p.length < 4) return null;
  const m = message.replace(/\s+/g, " ").trim();
  return clip(`依頼: ${clip(p, 80)}${m ? ` / 結果: ${clip(m, 70)}` : ""}`, 160);
}

export async function loadMemory(scope: string): Promise<string[]> {
  try {
    const rows = await prisma.aiMemory.findMany({ where: { scope }, orderBy: { createdAt: "desc" } });
    return rows.slice(0, USE_NOTES).map((r: { note: string }) => r.note).reverse();
  } catch {
    return [];
  }
}

export async function saveMemory(scope: string, prompt: string, message: string, by?: string | null): Promise<void> {
  const note = makeNote(prompt, message);
  if (!note) return;
  try {
    const rows = await prisma.aiMemory.findMany({ where: { scope }, orderBy: { createdAt: "desc" } });
    if (rows.some((r: { note: string }) => r.note === note)) return;
    await prisma.aiMemory.create({ data: { scope, note, createdBy: by ?? null } });
    const stale = rows.slice(MAX_NOTES - 1);
    if (stale.length) await prisma.aiMemory.deleteMany({ where: { id: { in: stale.map((r: { id: string }) => r.id) } } });
  } catch {
    // メモは補助機能。保存できなくてもAI依頼の結果には影響させない
  }
}

export function memoryBlock(notes: string[]): string {
  return notes.length ? `\n過去の依頼メモ（この月の参考情報。今回の依頼が優先）:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : "";
}
