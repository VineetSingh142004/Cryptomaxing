import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import {
  loadOrFetchHistoricalCandles,
  runBacktest,
  splitPeriods,
} from "@/lib/trading/research";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

const schema = z.object({
  strategyId: z.string(),
  symbol: z.string().default("BTC/USD"),
  period: z.enum(["in_sample", "validation", "out_of_sample", "full"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request", {
        details: parsed.error.flatten(),
      });
    }

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
        spanDays: history.spanDays,
      });
    }

    const splits = splitPeriods(history.candles);
    const period = parsed.data.period ?? "out_of_sample";
    const candles =
      period === "full"
        ? history.candles
        : period === "in_sample"
          ? splits.inSample
          : period === "validation"
            ? splits.validation
            : splits.outOfSample;

    const result = runBacktest({
      strategyId: parsed.data.strategyId,
      symbol: parsed.data.symbol,
      candles,
      period: period === "full" ? "out_of_sample" : period,
      parameters: strategy.parameters as Record<string, number>,
      feeModel: DEFAULT_FEE_MODEL,
      dataSource: history.dataSource,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
