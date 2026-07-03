import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { requireAuth } from "@/lib/security/auth";
import { getAccountTradeHistory } from "@/lib/trading/exchange/account-service";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    await requireAuth();
    const history = await getAccountTradeHistory();
    return NextResponse.json(history);
  } catch (error) {
    logger.error({ err: error }, "GET /api/account/trade-history failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
