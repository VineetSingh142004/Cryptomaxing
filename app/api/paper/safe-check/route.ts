import { NextResponse } from "next/server";
import { runSafePaperShadowCheck } from "@/lib/trading/paper/safe-check";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const result = await runSafePaperShadowCheck();
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/safe-check failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST() {
  return GET();
}
