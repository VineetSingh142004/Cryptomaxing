import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import {
  discoverEdge,
  loadOrFetchHistoricalCandles,
} from "@/lib/trading/research";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

const schema = z.object({
  strategyId: z.string(),
  symbol: z.string().default("BTC/USD"),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request");

    const strategy = getStrategyById(parsed.data.strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", "Strategy not found");

    const history = await loadOrFetchHistoricalCandles({
      symbol: parsed.data.symbol,
      timeframe: "1m",
      minDays: 90,
    });

    if (!history.sufficient) {
      return NextResponse.json({
        status: "INSUFFICIENT_DATA",
        reasonCodes: history.reasonCodes,
        approval_status: "RESEARCH_ONLY",
      });
    }

    const edge = discoverEdge({
      strategyId: parsed.data.strategyId,
      symbol: parsed.data.symbol,
      candles: history.candles,
      parameters: strategy.parameters as Record<string, number>,
    });

    return NextResponse.json(edge);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
