import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";


export async function POST(req: NextRequest){

  try {

    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "AI提案の反映は管理者のみ可能です" }, { status: 403 });
    }

    const { changes } = await req.json();


    if(!Array.isArray(changes)){
      return NextResponse.json(
        {
          error:"変更データがありません"
        },
        {
          status:400
        }
      );
    }


    for(const change of changes){


      const employee =
        await prisma.employee.findFirst({
          where:{
            fullName:change.employeeName
          }
        });



      if(!employee){
        continue;
      }



      await prisma.monthRoster.updateMany({

        where:{
          employeeId:employee.id,
          workDate:new Date(change.date)
        },


        data:{

          status:change.newStatus,

          // 有給・休みの場合勤務時間削除
          overrideStartTime:null,
          overrideEndTime:null,

        }

      });


    }



    return NextResponse.json({

      success:true,

      message:
      "AI提案を勤務表へ反映しました"

    });



  }catch(error){

    return NextResponse.json({

      error:String(error)

    },{
      status:500
    });

  }

}