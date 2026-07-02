import { NextResponse } from "next/server";
import { runFinalReadinessCheck } from "@/lib/trading/readiness";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    return NextResponse.json(runFinalReadinessCheck());
  } catch (error) {
    logger.error({ err: error }, "GET /api/readiness failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
