import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { createShadowTrade, closeShadowTrade } from "@/lib/trading/shadow";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "close") {
      const closed = closeShadowTrade(body);
      return NextResponse.json({ shadow: closed });
    }

    const shadow = createShadowTrade({
      signalTimestamp: body.signalTimestamp,
      symbol: body.symbol,
      venue: body.venue ?? "kraken",
      strategyId: body.strategyId,
      marketRegime: body.marketRegime ?? "unknown",
      direction: body.direction,
      entryPrice: body.entryPrice,
      stopPrice: body.stopPrice,
      targetPrices: body.targetPrices ?? [],
      exitPlan: body.exitPlan ?? [],
      size: body.size ?? 1,
      feeModel: body.feeModel ?? DEFAULT_FEE_MODEL,
      spreadBps: body.spreadBps ?? 5,
      orderBookState: body.orderBookState,
      liquidityState: body.liquidityState,
      entryReason: body.entryReason ?? [],
      stopReason: body.stopReason ?? "",
      entryWouldFill: body.entryWouldFill ?? true,
    });

    return NextResponse.json({ shadow });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
