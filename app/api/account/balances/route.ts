import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { requireAuth } from "@/lib/security/auth";
import { getAccountBalances } from "@/lib/trading/exchange/account-service";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    await requireAuth();
    const balances = await getAccountBalances();
    return NextResponse.json(balances);
  } catch (error) {
    logger.error({ err: error }, "GET /api/account/balances failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
