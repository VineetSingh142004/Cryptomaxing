import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { evaluateMarketDataQuality } from "@/lib/trading/data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await params;
    const decoded = decodeURIComponent(symbol);
    const result = await evaluateMarketDataQuality(decoded, { requiresOrderBook: true });
    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
