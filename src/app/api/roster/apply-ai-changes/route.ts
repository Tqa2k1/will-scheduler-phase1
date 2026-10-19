import { isManagerRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markMonthsRevised } from "@/lib/monthStatus";
import { monthKeyOfDate, monthsOfDates } from "@/lib/monthStatusShared";


export async function POST(req: NextRequest){

  try {

    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    if (!isManagerRole(session.user.role)) {
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


    const touchedDates: string[] = [];
    for(const change of changes){


      const employee =
        await prisma.employee.findFirst({
          where:{
            fullName:change.employeeName,
            isActive:true
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
      touchedDates.push(new Date(change.date).toISOString());


    }



    // 確定後の修正なら、その月を「調整中」に戻す
    await markMonthsRevised(monthsOfDates(touchedDates.filter((d) => !d.startsWith("Invalid"))), session.user.email);

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