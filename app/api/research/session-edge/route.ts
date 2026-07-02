import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import {
  analyzeSessionEdge,
  loadOrFetchHistoricalCandles,
  runBacktest,
  splitPeriods,
} from "@/lib/trading/research";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

const schema = z.object({
  strategyId: z.string(),
  symbol: z.string().default("BTC/USD"),
});

export async function GET(request: NextRequest) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = schema.safeParse(params);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid query");

    const strategy = getStrategyById(parsed.data.strategyId);
    if (!strategy) throw new AppError("NOT_FOUND", "Strategy not found");

    const history = await loadOrFetchHistoricalCandles({
      symbol: parsed.data.symbol,
      timeframe: "1m",
      minDays: 90,
    });

    if (!history.sufficient) {
      return NextResponse.json({ status: "INSUFFICIENT_DATA", reasonCodes: history.reasonCodes });
    }

    const oos = splitPeriods(history.candles).outOfSample;
    const backtest = runBacktest({
      strategyId: parsed.data.strategyId,
      symbol: parsed.data.symbol,
      candles: oos,
      period: "out_of_sample",
      parameters: strategy.parameters as Record<string, number>,
      feeModel: DEFAULT_FEE_MODEL,
      dataSource: history.dataSource,
    });

    const sessionEdge = analyzeSessionEdge(backtest.trades);

    return NextResponse.json({
      sessionEdge,
      tradeCount: backtest.trades.length,
      blockedHours: sessionEdge.filter((s) => s.recommendation === "BLOCK").map((s) => s.hour),
      preferredHours: sessionEdge.filter((s) => s.recommendation === "PREFER").map((s) => s.hour),
    });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
