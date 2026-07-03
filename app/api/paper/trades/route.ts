import { NextResponse } from "next/server";
import { getPaperTradesList } from "@/lib/trading/paper/evidence-service";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const trades = await getPaperTradesList();
    return NextResponse.json(trades);
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/trades failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
