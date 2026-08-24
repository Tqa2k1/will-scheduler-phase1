import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";


export async function POST(req: NextRequest) {

  try {

    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "この操作は管理者のみ可能です" }, { status: 403 });
    }

    const body = await req.json();

    const {
      employeeName,
      date,
      newStatus
    } = body;


    const employee = await prisma.employee.findFirst({
      where:{
        fullName: employeeName
      }
    });


    if(!employee){
      return NextResponse.json(
        {
          error:"社員が見つかりません"
        },
        {
          status:404
        }
      );
    }


    await prisma.monthRoster.updateMany({

      where:{
        employeeId: employee.id,
        workDate: new Date(date)
      },

      data:{
        status:newStatus,
        overrideStartTime: null,
        overrideEndTime: null,
      }

    });


    return NextResponse.json({
      success:true,
      message:"勤務表を変更しました"
    });


  } catch(error){

    return NextResponse.json(
      {
        error:String(error)
      },
      {
        status:500
      }
    );

  }

}