import { describe, expect, it } from "vitest";
import {
  assessDataQuality,
  detectCandleGaps,
  computeSpreadBps,
} from "@/lib/trading/data/quality-gates";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";

function makeSnapshot(overrides?: Partial<NormalizedMarketSnapshot>): NormalizedMarketSnapshot {
  const now = new Date().toISOString();
  return {
    symbol: "BTC/USD",
    ticker: {
      symbol: "BTC/USD",
      price: 100000,
      bid: 99990,
      ask: 100010,
      spread: 20,
      spreadBps: computeSpreadBps(99990, 100010),
      volume24h: 1_000_000,
      timestamp: now,
      source: "test",
      latencyMs: 100,
    },
    orderBook: {
      bids: [{ price: 99990, size: 10 }],
      asks: [{ price: 100010, size: 10 }],
      timestamp: now,
      source: "test",
      latencyMs: 50,
    },
    candles1m: Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 60_000).toISOString(),
      open: 100000,
      high: 100100,
      low: 99900,
      close: 100000,
      volume: 100,
      timeframe: "1m" as const,
    })),
    candles5m: Array.from({ length: 50 }, (_, i) => ({
      timestamp: new Date(Date.now() - (50 - i) * 300_000).toISOString(),
      open: 100000,
      high: 100100,
      low: 99900,
      close: 100000,
      volume: 500,
      timeframe: "5m" as const,
    })),
    relativeVolume: 1.2,
    liquidityUsd: 10_000_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "test", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: "high" },
    metadata: {
      symbol: "BTC/USD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      pairAgeDays: 3650,
      minOrderSize: 0.0001,
      fundingRate: null,
      openInterest: null,
      source: "test",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: now,
    ...overrides,
  };
}

describe("quality gates", () => {
  it("detects candle gaps", () => {
    const candles = [
      { timestamp: "2026-01-01T00:00:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1, timeframe: "1m" as const },
      { timestamp: "2026-01-01T00:05:00Z", open: 1, high: 1, low: 1, close: 1, volume: 1, timeframe: "1m" as const },
    ];
    const result = detectCandleGaps(candles, 60_000);
    expect(result.hasGaps).toBe(true);
  });

  it("blocks when spread too wide", () => {
    const snapshot = makeSnapshot({
      ticker: {
        ...makeSnapshot().ticker,
        bid: 99000,
        ask: 101000,
        spreadBps: 200,
      },
    });
    const assessment = assessDataQuality({ snapshot, requiresOrderBook: true });
    expect(assessment.reasonCodes).toContain("SPREAD_TOO_WIDE");
    expect(assessment.tradable).toBe(false);
  });

  it("blocks when fee model missing", () => {
    const snapshot = makeSnapshot({
      feeModel: { makerBps: 0, takerBps: 0, source: "unknown", known: false },
    });
    const assessment = assessDataQuality({ snapshot });
    expect(assessment.reasonCodes).toContain("FEE_MODEL_MISSING");
  });
});
