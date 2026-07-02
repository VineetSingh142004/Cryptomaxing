import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import {
  loadOrFetchHistoricalCandles,
  runBacktest,
  runMonteCarlo,
  splitPeriods,
} from "@/lib/trading/research";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

const schema = z.object({
  strategyId: z.string(),
  symbol: z.string().default("BTC/USD"),
  iterations: z.number().min(100).max(5000).optional(),
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

    const monteCarlo = runMonteCarlo({
      trades: backtest.trades,
      iterations: parsed.data.iterations,
    });

    return NextResponse.json({ backtest: { metrics: backtest.metrics, status: backtest.status }, monteCarlo });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
