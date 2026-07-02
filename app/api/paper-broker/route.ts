import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { runPaperBrokerSession } from "@/lib/trading/paper";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const session = await runPaperBrokerSession(body);
    return NextResponse.json({ session });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
