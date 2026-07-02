import { describe, expect, it } from "vitest";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import { runBacktest, computeMetrics } from "@/lib/trading/research/backtest-engine";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { splitPeriods } from "@/lib/trading/research/types";
import { runMonteCarlo } from "@/lib/trading/research/monte-carlo";
import { shouldRejectVariant } from "@/lib/trading/research/parameter-grid";

function syntheticCandles(count: number, basePrice = 100): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = basePrice;
  const start = Date.now() - count * 60_000;

  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 20) * 0.5;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    candles.push({
      timestamp: new Date(start + i * 60_000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 100 + Math.abs(drift) * 50,
      timeframe: "1m",
    });
    price = close;
  }
  return candles;
}

describe("research backtest engine", () => {
  it("splits periods without overlap leakage", () => {
    const candles = syntheticCandles(1000);
    const { inSample, validation, outOfSample } = splitPeriods(candles);
    expect(inSample.length + validation.length + outOfSample.length).toBe(1000);
    expect(new Date(inSample.at(-1)!.timestamp).getTime()).toBeLessThan(
      new Date(validation[0].timestamp).getTime(),
    );
  });

  it("returns NO_TRADES or COMPLETED without fake metrics when no signals", () => {
    const flat = syntheticCandles(120, 50);
    const result = runBacktest({
      strategyId: "vwap-reclaim-momentum",
      symbol: "TEST/USD",
      candles: flat,
      period: "in_sample",
      parameters: { minRelativeVolume: 99, secondTargetR: 2 },
      feeModel: DEFAULT_FEE_MODEL,
      dataSource: "synthetic",
      rng: () => 1,
    });
    expect(["NO_TRADES", "COMPLETED"]).toContain(result.status);
    expect(result.metrics.luckyTradeDominance).toBeNull();
  });

  it("applies fees and slippage to trades", () => {
    const candles = syntheticCandles(500, 100);
    const result = runBacktest({
      strategyId: "trend-pullback-continuation",
      symbol: "TEST/USD",
      candles,
      period: "in_sample",
      parameters: { minRelativeVolume: 0.5, secondTargetR: 2 },
      feeModel: DEFAULT_FEE_MODEL,
      dataSource: "synthetic",
      rng: () => 1,
    });
    if (result.trades.length > 0) {
      const t = result.trades[0];
      expect(t.fees).toBeGreaterThan(0);
      expect(t.netPnl).toBeLessThanOrEqual(t.grossPnl);
    }
  });
});

describe("monte carlo", () => {
  it("blocks with insufficient trades", () => {
    const result = runMonteCarlo({ trades: [], iterations: 100 });
    expect(result.blocked).toBe(true);
    expect(result.blockReasons).toContain("INSUFFICIENT_TRADES_FOR_MONTE_CARLO");
  });
});

describe("parameter rejection", () => {
  it("rejects lucky trade dominance", () => {
    const reasons = shouldRejectVariant({
      inSample: {
        expectancy: 10,
        luckyTradeDominance: 0.9,
        maxDrawdownPct: 5,
        tradeCount: 20,
      },
      validation: { expectancy: 5, tradeCount: 10 },
      outOfSample: { expectancy: 3, tradeCount: 10 },
      walkForwardPass: true,
      chopCollapse: false,
    });
    expect(reasons).toContain("LUCKY_TRADE_DOMINANCE");
  });
});

describe("computeMetrics", () => {
  it("returns null win rate for zero trades", () => {
    const m = computeMetrics([]);
    expect(m.winRate).toBeNull();
    expect(m.expectancy).toBeNull();
  });
});
