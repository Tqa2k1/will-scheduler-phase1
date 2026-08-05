import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";

const InputSchema = z.object({
  month: z.string(),
  prompt: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { error: "ログインが必要です" },
      { status: 401 }
    );
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "AI機能は管理者のみ利用できます" },
      { status: 403 }
    );
  }


  const body = await req.json();

  const parsed = InputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }


  const { month, prompt } = parsed.data;


  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      message:
        "AI機能を使うには環境変数 GEMINI_API_KEY を設定してください。",
    });
  }



  const [year, mon] = month.split("-").map(Number);

  const rangeStart = new Date(
    Date.UTC(year, mon - 1, 1)
  );

  const rangeEnd = new Date(
    Date.UTC(year, mon, 1)
  );


  // 勤務表データ取得
  const entries = await prisma.monthRoster.findMany({
    where: {
      workDate: {
        gte: rangeStart,
        lt: rangeEnd,
      },
    },
    include: {
      employee: true,
    },
  });



  const summaryByEmployee = new Map<
    string,
    {
      name: string;
      work: number;
      off: number;
    }
  >();



  for (const e of entries) {

    const key = e.employeeId;


    if (!summaryByEmployee.has(key)) {
      summaryByEmployee.set(key, {
        name: e.employee.fullName,
        work: 0,
        off: 0,
      });
    }


    const data = summaryByEmployee.get(key)!;


    if (e.status === "WORK") {
      data.work++;
    } else {
      data.off++;
    }

  }



  const contextLines = [
    ...summaryByEmployee.values(),
  ]
    .map(
      (s) =>
        `${s.name}: 出勤${s.work}日 / 休み${s.off}日`
    )
    .join("\n");




  try {

    const genAI = new GoogleGenerativeAI(apiKey);


    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });



    const result = await model.generateContent(`

あなたはWHILLシフト管理アシスタントです。

目的:
勤務表を確認し、管理者へ改善提案を行う。

ルール:
- データベースを変更しない
- 提案のみ行う
- 日本語で簡潔に回答する


対象月:
${month}


現在の勤務状況:
${contextLines || "データなし"}


管理者からの依頼:
${prompt || "全体的な過不足を確認してください。"}

`);



    const message = result.response.text();


    return NextResponse.json({
      message,
    });



  } catch (err) {

    return NextResponse.json({
      message:
        `AIへの問い合わせ中にエラーが発生しました: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`,
    });

  }
}