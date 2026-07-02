import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import {
  loadOrFetchHistoricalCandles,
  runParameterOptimization,
} from "@/lib/trading/research";

const schema = z.object({
  strategyId: z.string(),
  symbol: z.string().default("BTC/USD"),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid request");

    const history = await loadOrFetchHistoricalCandles({
      symbol: parsed.data.symbol,
      timeframe: "1m",
      minDays: 90,
    });

    if (!history.sufficient) {
      return NextResponse.json({
        status: "INSUFFICIENT_DATA",
        reasonCodes: history.reasonCodes,
      });
    }

    const result = runParameterOptimization({
      strategyId: parsed.data.strategyId,
      symbol: parsed.data.symbol,
      candles: history.candles,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
