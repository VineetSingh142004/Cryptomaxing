import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { evaluateTradePermission } from "@/lib/trading/permission";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const permission = evaluateTradePermission(body);
    return NextResponse.json({ permission });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
