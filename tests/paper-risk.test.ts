import { describe, expect, it } from "vitest";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { evaluateThesisInvalidation, mapLegacyCloseReason } from "@/lib/trading/paper/thesis-invalidation";
import { explainLosingTrade } from "@/lib/trading/paper/risk-explanation";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import {
  calculatePaperPositionSize,
  resolveDailyBudget,
} from "@/lib/trading/paper/capital-allocation";
import { evaluatePaperLeverage } from "@/lib/trading/paper/paper-leverage";
import { resolveEffectiveMaxOpenTrades } from "@/lib/trading/paper/dynamic-capacity";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";

function mockSnapshot(overrides: Partial<NormalizedMarketSnapshot> = {}): NormalizedMarketSnapshot {
  const now = new Date().toISOString();
  const weakCandles = Array.from({ length: 10 }, (_, i) => ({
    timestamp: new Date(Date.now() - (10 - i) * 300_000).toISOString(),
    open: 100 - i * 0.3,
    high: 100.2 - i * 0.3,
    low: 99.5 - i * 0.4,
    close: 100 - i * 0.35,
    volume: i < 5 ? 2000 : 400,
    timeframe: "5m" as const,
  }));

  return {
    symbol: "ALT/USD",
    ticker: {
      symbol: "ALT/USD",
      price: 87,
      bid: 86.9,
      ask: 87.1,
      spread: 0.2,
      spreadBps: 23,
      volume24h: 500_000,
      timestamp: now,
      source: "kraken",
      latencyMs: 50,
    },
    orderBook: null,
    candles1m: [],
    candles5m: weakCandles,
    relativeVolume: 0.5,
    liquidityUsd: 80_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "kraken", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: 0.9 },
    metadata: {
      symbol: "ALT/USD",
      baseAsset: "ALT",
      quoteAsset: "USD",
      pairAgeDays: null,
      minOrderSize: 0.0001,
      fundingRate: null,
      openInterest: null,
      source: "kraken",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: now,
    ...overrides,
  };
}

function confirmedAvailability(): ExchangeAvailabilityResult {
  return {
    listedOnKraken: "YES",
    krakenSpotAvailable: "YES",
    krakenMarginAvailable: "YES",
    krakenFuturesAvailable: "NO",
    usLeverageAvailable: "YES",
    availablePairs: ["ALT/USD"],
    bestExchange: "kraken",
    recommendedAction: "LEVERAGE_POSSIBLE",
    evidenceSource: "test",
    checkedAt: new Date().toISOString(),
    confidence: "high",
    availabilityNote: null,
  };
}

function unknownUsLeverage(): ExchangeAvailabilityResult {
  return {
    ...confirmedAvailability(),
    usLeverageAvailable: "UNKNOWN",
    krakenMarginAvailable: "UNKNOWN",
  };
}

describe("thesis invalidation exits", () => {
  it("exits losing trade on volume collapse and momentum reversal", () => {
    const result = evaluateThesisInvalidation({
      side: "LONG",
      entryPrice: 90,
      markPrice: 87,
      snapshot: mockSnapshot({ relativeVolume: 0.45 }),
      entryMomentumPct: 1.2,
      entrySpreadBps: 15,
      earlyLossCutBps: 30,
      invalidationThreshold: 45,
    });
    expect(result.shouldExit).toBe(true);
    expect(result.exitReason).toBeTruthy();
    expect(["VOLUME_COLLAPSE", "MOMENTUM_REVERSAL", "EARLY_LOSS_CUT", "THESIS_INVALIDATED"]).toContain(
      result.exitReason,
    );
  });

  it("does not exit profitable trade on weak signals", () => {
    const result = evaluateThesisInvalidation({
      side: "LONG",
      entryPrice: 90,
      markPrice: 92,
      snapshot: mockSnapshot({ relativeVolume: 0.5 }),
    });
    expect(result.shouldExit).toBe(false);
  });
});

describe("early loss cut", () => {
  it("triggers EARLY_LOSS_CUT when loss exceeds threshold with weak thesis", () => {
    const result = evaluateThesisInvalidation({
      side: "LONG",
      entryPrice: 90,
      markPrice: 86,
      snapshot: mockSnapshot({ relativeVolume: 0.4, ticker: { ...mockSnapshot().ticker, spreadBps: 90 } }),
      earlyLossCutBps: 40,
      invalidationThreshold: 50,
    });
    expect(result.shouldExit).toBe(true);
    expect(result.invalidationScore).toBeGreaterThanOrEqual(50);
  });
});

describe("legacy close reason mapping", () => {
  it("maps STOP_LOSS to STOP_LOSS_HIT", () => {
    expect(mapLegacyCloseReason("STOP_LOSS")).toBe("STOP_LOSS_HIT");
  });
  it("maps TAKE_PROFIT to TAKE_PROFIT_HIT", () => {
    expect(mapLegacyCloseReason("TAKE_PROFIT")).toBe("TAKE_PROFIT_HIT");
  });
  it("maps EXPIRED to EXPIRY_EXIT", () => {
    expect(mapLegacyCloseReason("EXPIRED")).toBe("EXPIRY_EXIT");
  });
});

describe("risk explanation for losing trades", () => {
  it("explains volume and liquidity factors", () => {
    const thesis = evaluateThesisInvalidation({
      side: "LONG",
      entryPrice: 90,
      markPrice: 87,
      snapshot: mockSnapshot(),
    });
    const explanation = explainLosingTrade({
      side: "LONG",
      entryPrice: 90,
      markPrice: 87,
      snapshot: mockSnapshot(),
      thesisResult: thesis,
    });
    expect(explanation.factorLabels.length).toBeGreaterThan(0);
    expect(explanation.summary).toContain("SIMULATED");
    expect(explanation.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});

describe("dynamic trade limit", () => {
  it("is enabled by default with risk-based factors", () => {
    expect(PAPER_RISK_CONFIG.dynamicTradeLimit).toBe(true);
    const cap = resolveEffectiveMaxOpenTrades({ openTradeCount: 2 });
    expect(cap.dynamicModeEnabled).toBe(true);
    expect(cap.factors[0]).toContain("Base max");
  });

  it("blocks new slots when at effective capacity", () => {
    const cap = resolveEffectiveMaxOpenTrades({ openTradeCount: 5, totalExposurePct: 6 });
    expect(cap.slotsAvailable).toBe(0);
    expect(cap.blockedReason).toBeTruthy();
  });
});

describe("daily budget settings", () => {
  it("supports manual and AI-recommended modes", () => {
    const manual = resolveDailyBudget({
      simulatedAccountUsd: 10_000,
      mode: "manual",
      manualBudgetUsd: 500,
    });
    expect(manual.dailyBudgetUsd).toBe(500);
    expect(manual.source).toBe("manual");

    const ai = resolveDailyBudget({
      simulatedAccountUsd: 10_000,
      mode: "ai_recommended",
      marketConfidenceScore: 80,
    });
    expect(ai.source).toBe("ai_recommended");
    expect(ai.aiRecommendationUsd).toBeGreaterThan(0);
    expect(ai.maxAcceptableDailyLossUsd).toBeGreaterThan(0);
  });
});

describe("capital allocation calculations", () => {
  it("allocates more to high-confidence major-tier trades", () => {
    const strong = calculatePaperPositionSize({
      entryPrice: 100,
      stopDistancePct: 0.8,
      confidence: 0.9,
      opportunityScore: 85,
      riskTier: "MAJOR",
      liquidityScore: 80,
      volatilityPct: 2,
      leverage: 1,
    });
    const weak = calculatePaperPositionSize({
      entryPrice: 100,
      stopDistancePct: 0.8,
      confidence: 0.55,
      opportunityScore: 62,
      riskTier: "HIGH_VOLATILITY",
      liquidityScore: 40,
      volatilityPct: 8,
      leverage: 1,
      downsideRiskScore: 55,
    });
    expect(strong.riskAmountUsd).toBeGreaterThan(weak.riskAmountUsd);
    expect(strong.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });

  it("does not use same size for every trade", () => {
    const a = calculatePaperPositionSize({
      entryPrice: 50,
      stopDistancePct: 1,
      confidence: 0.9,
      opportunityScore: 90,
      riskTier: "MAJOR",
    });
    const b = calculatePaperPositionSize({
      entryPrice: 50,
      stopDistancePct: 1,
      confidence: 0.6,
      opportunityScore: 65,
      riskTier: "EXTREME_RISK",
      downsideRiskScore: 70,
    });
    expect(a.simulatedSize).not.toBe(b.simulatedSize);
  });
});

describe("leverage recommendation", () => {
  it("recommends leverage only when confirmed", () => {
    const result = evaluatePaperLeverage({
      availability: confirmedAvailability(),
      confidence: 0.85,
      opportunityScore: 82,
      liquidityScore: 75,
      stopDistancePct: 0.8,
      riskTier: "MAJOR",
      hasClearStopLoss: true,
    });
    expect(result.useLeverage).toBe(true);
    expect(result.recommendedLeverage).toBeGreaterThan(1);
    expect(result.leverageAvailable).toBe("YES");
    expect(result.usLeverageAvailable).toBe("YES");
  });

  it("unknown U.S. leverage = no leverage recommendation", () => {
    const result = evaluatePaperLeverage({
      availability: unknownUsLeverage(),
      confidence: 0.9,
      opportunityScore: 90,
      liquidityScore: 80,
      stopDistancePct: 0.8,
      riskTier: "MAJOR",
      hasClearStopLoss: true,
    });
    expect(result.useLeverage).toBe(false);
    expect(result.recommendedLeverage).toBe(1);
    expect(result.leverageReason).toContain("LEVERAGE_ELIGIBLE_UNVERIFIED");
  });
});

describe("safety gates", () => {
  it("simulated labels on risk config", () => {
    expect(PAPER_RISK_CONFIG.dynamicTradeLimit).toBe(true);
  });

  it("Auto remains locked without live trading", () => {
    const unlock = evaluateAutoUnlock(defaultAutoUnlockInput());
    expect(unlock.autoExecutionEnabled).toBe(false);
  });
});
