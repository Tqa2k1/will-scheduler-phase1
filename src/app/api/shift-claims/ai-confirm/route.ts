import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isManagerRole } from "@/lib/roles";
import { aiConfirmPreview, aiConfirmExecute } from "@/lib/aiConfirm";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Input = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), month: z.string().regex(/^\d{4}-\d{2}$/), prompt: z.string().max(1000).default("") }),
  z.object({
    mode: z.literal("execute"),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    signature: z.string().min(1),
    scope: z.object({ employeeIds: z.array(z.string()).optional(), fromDate: date.optional(), toDate: date.optional() }).default({}),
  }),
]);

// POST /api/shift-claims/ai-confirm — AI依頼による勤務希望の確定（INC/管理者のみ）
//  mode=preview : AIが対象を判断して確定案を作る（何も保存しない）
//  mode=execute : プレビューの署名が一致する場合のみ、既存の一括確定を実行してDBを更新する
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isManagerRole(session.user.role)) return NextResponse.json({ error: "勤務希望の確定はINC（管理者）のみ可能です" }, { status: 403 });

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });
  const actor = session.user.email ?? session.user.id ?? "unknown";

  if (parsed.data.mode === "preview") {
    const r = await aiConfirmPreview(parsed.data.month, parsed.data.prompt);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 422 });
  }
  const r = await aiConfirmExecute(parsed.data.month, parsed.data.scope, parsed.data.signature, actor);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}
