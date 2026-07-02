import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { getMarketSnapshot } from "@/lib/trading/data";
import { computeAllFeatures } from "@/lib/trading/features";
import { scanExplosiveMove, analyzeMicrostructureEdge } from "@/lib/trading/scanning";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await params;
    const decoded = decodeURIComponent(symbol);
    const snapshot = await getMarketSnapshot(decoded);
    const features = computeAllFeatures(snapshot);
    const ctx = { snapshot, features };
    const explosive = scanExplosiveMove(ctx);
    const microstructure = analyzeMicrostructureEdge(ctx, explosive.direction);

    return NextResponse.json({ explosive, microstructure });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
