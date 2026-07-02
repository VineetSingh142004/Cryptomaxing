import type { BenchmarkComparison } from "@/lib/trading/research/types";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import { runBacktest, computeMetrics } from "@/lib/trading/research/backtest-engine";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import type { BacktestTrade } from "@/lib/trading/research/types";

function buyAndHoldReturn(candles: NormalizedCandle[], feeBps: number): number {
  if (candles.length < 2) return 0;
  const entry = candles[0].close;
  const exit = candles[candles.length - 1].close;
  const gross = ((exit - entry) / entry) * 100;
  return gross - (feeBps / 100) * 2;
}

function randomEntryBaseline(
  candles: NormalizedCandle[],
  feeModel: typeof DEFAULT_FEE_MODEL,
  count = 50,
  seed = 99,
): BacktestTrade[] {
  let s = seed;
  const rng = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  const trades: BacktestTrade[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * (candles.length - 20)) + 10;
    const entry = candles[idx].close;
    const exit = candles[Math.min(idx + 10, candles.length - 1)].close;
    const fee = entry * (feeModel.takerBps / 10_000) * 2;
    const net = exit - entry - fee;
    trades.push({
      id: `random-${i}`,
      symbol: "baseline",
      strategyId: "random-entry",
      direction: "long",
      entryTime: candles[idx].timestamp,
      exitTime: candles[Math.min(idx + 10, candles.length - 1)].timestamp,
      entryPrice: entry,
      exitPrice: exit,
      size: 1,
      grossPnl: exit - entry,
      fees: fee,
      slippage: 0,
      funding: 0,
      netPnl: net,
      rMultiple: 0,
      exitReason: "random_hold",
      sessionHour: 0,
      regime: "random",
      parameters: {},
    });
  }
  return trades;
}

export function runBenchmarkComparison(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  parameters: Record<string, number>;
  benchmarkSymbol?: string;
}): {
  comparisons: BenchmarkComparison[];
  strategyEdgeConfidence: number;
  hasRealAlpha: boolean;
  reasonCodes: string[];
} {
  const strategyResult = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: input.candles,
    period: "out_of_sample",
    parameters: input.parameters,
    feeModel: DEFAULT_FEE_MODEL,
    dataSource: "benchmark",
  });

  const strategyReturn =
    strategyResult.trades.length > 0
      ? (strategyResult.metrics.netProfit / input.candles[0].close) * 100
      : 0;

  const randomTrades = randomEntryBaseline(input.candles, DEFAULT_FEE_MODEL);
  const randomMetrics = computeMetrics(randomTrades);
  const randomReturn =
    randomTrades.length > 0
      ? (randomMetrics.netProfit / input.candles[0].close) * 100
      : 0;

  const benchmarks: { ref: string; return: number }[] = [
    { ref: "cash", return: 0 },
    { ref: "random-entry", return: randomReturn },
  ];

  if (input.symbol.startsWith("BTC")) {
    benchmarks.push({ ref: "buy-hold-btc", return: buyAndHoldReturn(input.candles, DEFAULT_FEE_MODEL.takerBps) });
  }

  const comparisons: BenchmarkComparison[] = benchmarks.map((b) => {
    const alpha = strategyReturn - b.return;
    const dd = strategyResult.metrics.maxDrawdownPct || 1;
    const riskAdj = dd > 0 ? strategyReturn / dd : null;
    const edgeConfidence = Math.max(0, Math.min(1, alpha > 0 ? 0.5 + alpha / 20 : 0));

    return {
      benchmarkRef: b.ref,
      benchmarkReturn: b.return,
      strategyReturn,
      alpha,
      netAlphaAfterCosts: alpha,
      riskAdjustedReturn: riskAdj,
      edgeConfidence,
    };
  });

  const reasonCodes: string[] = [];
  const beatsRandom = comparisons.find((c) => c.benchmarkRef === "random-entry")?.alpha ?? -1;
  const beatsCash = strategyReturn > 0;

  if (beatsRandom <= 0) reasonCodes.push("NO_EDGE_VS_RANDOM");
  if (!beatsCash) reasonCodes.push("NO_EDGE_VS_CASH");
  if (strategyResult.metrics.tradeCount < 10) reasonCodes.push("INSUFFICIENT_SAMPLE");

  const strategyEdgeConfidence =
    comparisons.reduce((s, c) => s + c.edgeConfidence, 0) / comparisons.length;

  const hasRealAlpha =
    beatsRandom > 0 &&
    beatsCash &&
    (strategyResult.metrics.expectancy ?? 0) > 0 &&
    strategyResult.metrics.tradeCount >= 10;

  return {
    comparisons,
    strategyEdgeConfidence,
    hasRealAlpha,
    reasonCodes,
  };
}

export async function runMultiBenchmark(input: {
  strategyId: string;
  candlesBySymbol: Record<string, NormalizedCandle[]>;
  parameters: Record<string, number>;
}): Promise<BenchmarkComparison[]> {
  const all: BenchmarkComparison[] = [];
  for (const [symbol, candles] of Object.entries(input.candlesBySymbol)) {
    const { comparisons } = runBenchmarkComparison({
      strategyId: input.strategyId,
      symbol,
      candles,
      parameters: input.parameters,
    });
    all.push(...comparisons.map((c) => ({ ...c, benchmarkRef: `${c.benchmarkRef}:${symbol}` })));
  }
  return all;
}
