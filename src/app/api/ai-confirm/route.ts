import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      employeeName,
      date,
      newStatus,
    } = body;


    const employee = await prisma.employee.findFirst({
      where: {
        fullName: employeeName,
      },
    });


    if (!employee) {
      return NextResponse.json(
        {
          error: "社員が見つかりません",
        },
        {
          status: 404,
        }
      );
    }


    await prisma.monthRoster.updateMany({
      where: {
        employeeId: employee.id,
        workDate: new Date(date),
      },

      data: {
        status: newStatus,

        // 勤務時間をリセット
        overrideStartTime: null,
        overrideEndTime: null,
        shiftTypeId: null,
      },
    });


    return NextResponse.json({
      success: true,
      message: "勤務表を変更しました",
    });


  } catch (error) {

    return NextResponse.json(
      {
        error: String(error),
      },
      {
        status: 500,
      }
    );

  }
}