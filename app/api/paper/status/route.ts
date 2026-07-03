import { NextResponse } from "next/server";
import { getPaperStatus } from "@/lib/trading/paper/evidence-service";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const status = await getPaperStatus();
    return NextResponse.json(status);
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/status failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
