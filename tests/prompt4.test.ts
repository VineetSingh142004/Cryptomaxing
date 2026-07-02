import { describe, expect, it } from "vitest";
import type { NormalizedCandle, NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { computeAllFeatures } from "@/lib/trading/features";
import { scanExplosiveMove, analyzeMicrostructureEdge } from "@/lib/trading/scanning";
import { computeTrueInvalidationStop } from "@/lib/trading/stops";
import { estimateExecutionQuality, routeVenue } from "@/lib/trading/execution";
import { computeKellySizing, computeLeverageIntelligence, evaluateDailyGuardrails } from "@/lib/trading/risk";
import { buildProfitPlan, routeProfitOpportunity } from "@/lib/trading/profit";

function syntheticCandles(count: number, base = 100): NormalizedCandle[] {
  const out: NormalizedCandle[] = [];
  let p = base;
  const start = Date.now() - count * 60_000;
  for (let i = 0; i < count; i++) {
    const o = p;
    const c = p + Math.sin(i / 8) * 0.4;
    out.push({
      timestamp: new Date(start + i * 60_000).toISOString(),
      open: o,
      high: Math.max(o, c) + 0.2,
      low: Math.min(o, c) - 0.2,
      close: c,
      volume: 120 + i,
      timeframe: "1m",
    });
    p = c;
  }
  return out;
}

function mockSnapshot(symbol = "BTC/USD"): NormalizedMarketSnapshot {
  const candles1m = syntheticCandles(120);
  const price = candles1m.at(-1)!.close;
  return {
    symbol,
    ticker: {
      symbol,
      price,
      bid: price * 0.9998,
      ask: price * 1.0002,
      spread: price * 0.0004,
      spreadBps: 4,
      volume24h: 1_000_000,
      timestamp: new Date().toISOString(),
      source: "test",
      latencyMs: 100,
    },
    orderBook: {
      bids: [{ price: price * 0.999, size: 10 }],
      asks: [{ price: price * 1.001, size: 10 }],
      timestamp: new Date().toISOString(),
      source: "test",
      latencyMs: 50,
    },
    candles1m,
    candles5m: syntheticCandles(60, price),
    relativeVolume: 1.3,
    liquidityUsd: 2_000_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "test", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: "high" },
    metadata: {
      symbol,
      baseAsset: "BTC",
      quoteAsset: "USD",
      pairAgeDays: 1000,
      minOrderSize: 0.0001,
      fundingRate: 0.0001,
      openInterest: null,
      source: "test",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: new Date().toISOString(),
  };
}

describe("explosive move scanner", () => {
  it("returns scores without fake P&L", () => {
    const snapshot = mockSnapshot();
    const features = computeAllFeatures(snapshot);
    const result = scanExplosiveMove({ snapshot, features });
    expect(result.scores.explosive_move_score).toBeGreaterThanOrEqual(0);
    expect(result.scores.explosive_move_score).toBeLessThanOrEqual(100);
    expect(result).not.toHaveProperty("pnl");
  });
});

describe("true invalidation stop", () => {
  it("never uses fixed 1% default blindly", () => {
    const snapshot = mockSnapshot();
    const features = computeAllFeatures(snapshot);
    const stop = computeTrueInvalidationStop({ snapshot, features, direction: "long" });
    expect(stop.candidates.length).toBeGreaterThan(0);
    expect(stop.recommendedStop).not.toBe(snapshot.ticker.price * 0.99);
  });
});

describe("kelly sizing", () => {
  it("caps Kelly and blocks above 1% risk", () => {
    const result = computeKellySizing({
      winRate: 0.9,
      avgWin: 10,
      avgLoss: 1,
      accountEquity: 10_000,
      sampleSize: 100,
      riskBand: "aggressive",
    });
    expect(result.riskPerTradePct).toBeLessThanOrEqual(1);
    expect(result.cappedKellyFraction).not.toBeNull();
  });
});

describe("daily guardrails", () => {
  it("pauses at -2% and +6%", () => {
    expect(evaluateDailyGuardrails({ netDailyPct: -2.1, consecutiveLosses: 0, tradesToday: 3 }).liveTradingAllowed).toBe(false);
    expect(evaluateDailyGuardrails({ netDailyPct: 6.5, consecutiveLosses: 0, tradesToday: 3 }).liveTradingAllowed).toBe(false);
  });
});

describe("profit router", () => {
  it("hard-rejects when proof and data gates fail", () => {
    const snapshot = mockSnapshot();
    const features = computeAllFeatures(snapshot);
    const ctx = { snapshot, features, direction: "long" as const };
    const explosive = scanExplosiveMove(ctx);
    const micro = analyzeMicrostructureEdge(ctx, "long");
    const stop = computeTrueInvalidationStop({ snapshot, features, direction: "long" });
    const execution = estimateExecutionQuality({
      snapshot,
      features,
      positionSizeUsd: 500,
      direction: "long",
    });
    const venue = routeVenue({ snapshot, features, positionSizeUsd: 500 });
    const kelly = computeKellySizing({
      winRate: 0.4,
      avgWin: 1,
      avgLoss: 2,
      accountEquity: 10_000,
      sampleSize: 5,
    });
    const daily = evaluateDailyGuardrails({ netDailyPct: 0, consecutiveLosses: 0, tradesToday: 0 });
    const profitPlan = buildProfitPlan({
      entryPrice: snapshot.ticker.price,
      direction: "long",
      stop,
      features,
      accountEquity: 10_000,
      positionRiskPct: kelly.riskPerTradePct,
    });
    const leverage = computeLeverageIntelligence({
      entryPrice: snapshot.ticker.price,
      direction: "long",
      stop,
      execution,
      features,
      accountEquity: 10_000,
      proofGateApproved: false,
    });

    const router = routeProfitOpportunity({
      symbol: "BTC/USD",
      strategyId: "vwap-reclaim-momentum",
      direction: "long",
      correlationGroup: "vwap_momentum",
      explosive,
      microstructure: micro,
      stop,
      execution,
      venue,
      leverage,
      kelly,
      daily,
      profitPlan,
      features,
      dataQuality: {
        tradable: true,
        decision: "ALLOW",
        reasonCodes: [],
        liveRequirementsMet: true,
        backtestRequirementsMet: true,
        details: {},
        assessedAt: new Date().toISOString(),
      },
      benchmarkAlphaPassed: false,
      monteCarlo: { blocked: true, blockReasons: ["LOW_SAMPLE"], iterations: 0 } as never,
      accountEquity: 10_000,
    });

    expect(router.hardRejects.length).toBeGreaterThan(0);
    expect(router.permission).toBe("BLOCK");
  });
});

describe("venue routing", () => {
  it("returns kraken only with other venues NOT_IMPLEMENTED", () => {
    const snapshot = mockSnapshot();
    const features = computeAllFeatures(snapshot);
    const result = routeVenue({ snapshot, features, positionSizeUsd: 500 });
    expect(result.recommendedVenue).toBe("kraken");
    expect(result.quotes.filter((q) => q.blockReasons.includes("NOT_IMPLEMENTED")).length).toBe(3);
  });
});
