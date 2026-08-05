import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import Groq from "groq-sdk";

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
      {
        error: parsed.error.flatten()
      },
      {
        status:400
      }
    );
  }



  const {
    month,
    prompt
  } = parsed.data;



  const apiKey = process.env.GROQ_API_KEY;


  if (!apiKey) {
    return NextResponse.json({
      message:
      "AI機能を使うには環境変数 GROQ_API_KEY を設定してください。"
    });
  }



  const [year, mon] = month.split("-").map(Number);



  const rangeStart = new Date(
    Date.UTC(year, mon - 1, 1)
  );


  const rangeEnd = new Date(
    Date.UTC(year, mon, 1)
  );



  const entries = await prisma.monthRoster.findMany({

    where:{
      workDate:{
        gte:rangeStart,
        lt:rangeEnd
      }
    },

    include:{
      employee:true
    }

  });



  const summaryByEmployee = new Map<
    string,
    {
      name:string;
      work:number;
      off:number;
    }
  >();



  for(const e of entries){

    const key = e.employeeId;


    if(!summaryByEmployee.has(key)){

      summaryByEmployee.set(
        key,
        {
          name:e.employee.fullName,
          work:0,
          off:0
        }
      );

    }


    const data = summaryByEmployee.get(key)!;


    if(e.status==="WORK"){
      data.work++;
    }
    else{
      data.off++;
    }

  }



  const contextLines = [
    ...summaryByEmployee.values()
  ]
  .map(
    s =>
    `${s.name}: 出勤${s.work}日 / 休み${s.off}日`
  )
  .join("\n");




  try {


    const groq = new Groq({
      apiKey
    });



    const completion =
    await groq.chat.completions.create({

      model:"llama-3.1-8b-instant",


      response_format:{
        type:"json_object"
      },


      messages:[

        {
          role:"system",

          content:`

あなたはWHILLシフト管理AIです。

必ずJSONのみ返してください。
説明文は禁止です。

形式:

{
 "message":"説明",
 "changes":[
  {
   "employeeName":"社員名",
   "date":"YYYY-MM-DD",
   "newStatus":"WORK|OFF|PAID_LEAVE|ADJUST_LEAVE"
  }
 ]
}


ルール:

- 実在する社員名のみ使用
- 日付は対象月内のみ
- 勝手に社員を追加しない
- データベース変更は禁止
- 変更提案だけ返す

`

        },


        {
          role:"user",

          content:`

対象月:
${month}


現在の勤務状況:

${contextLines || "データなし"}


管理者からの依頼:

${prompt || "勤務状況を分析して改善案を提案してください"}

`

        }

      ]

    });




    let rawMessage =
      completion.choices[0]?.message?.content ?? "{}";



    // ```json を削除
    rawMessage =
      rawMessage
      .replace(/```json/g,"")
      .replace(/```/g,"")
      .trim();




    let result:any;


    try{

      result = JSON.parse(rawMessage);

    }
    catch{

      result={
        message:rawMessage,
        changes:[]
      };

    }



    const changes =
      Array.isArray(result.changes)
      ?
      result.changes.filter(
        (c:any)=>
          c.employeeName &&
          c.date &&
          c.newStatus
      )
      :
      [];




    return NextResponse.json({

      message:
      result.message ??
      "AI分析完了",


      changes

    });



  }
  catch(err){


    return NextResponse.json({

      message:
      `AIへの問い合わせ中にエラーが発生しました: ${
        err instanceof Error
        ? err.message
        : String(err)
      }`

    });


  }

}