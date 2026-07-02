import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { getMarketSnapshot } from "@/lib/trading/data";
import { computeAllFeatures } from "@/lib/trading/features";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await params;
    const decoded = decodeURIComponent(symbol);
    const snapshot = await getMarketSnapshot(decoded);

    let btcCandles;
    let ethCandles;
    if (!decoded.startsWith("BTC")) {
      try {
        btcCandles = (await getMarketSnapshot("BTC/USD")).candles5m;
      } catch { /* regime context optional */ }
    }
    if (!decoded.startsWith("ETH")) {
      try {
        ethCandles = (await getMarketSnapshot("ETH/USD")).candles5m;
      } catch { /* optional */ }
    }

    const features = computeAllFeatures(snapshot, { btcCandles, ethCandles });
    return NextResponse.json({ features, snapshot: { symbol: snapshot.symbol, fetchedAt: snapshot.fetchedAt } });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
