import { describe, expect, it } from "vitest";
import type { PaperTrade } from "@prisma/client";
import {
  evaluateRiskReward,
  evaluateFakePumpRisk,
  evaluateRiskMode,
  buildProfitQualityVerdict,
  buildProfitQualitySummary,
  diagnoseTradeHistory,
  MIN_REWARD_RISK_BY_TIER,
  noTradeBestDecisionMessage,
} from "@/lib/trading/paper/profit-protection";
import { evaluateControlledActiveStrategy } from "@/lib/trading/paper/controlled-active-strategy";
import { evaluateTradeSelection } from "@/lib/trading/paper/trade-selection";
import { evaluateThesisInvalidation } from "@/lib/trading/paper/thesis-invalidation";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import { buildPaperPerformanceSummary } from "@/lib/trading/paper/performance-summary";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";

function confirmedAvailability() {
  return {
    listedOnKraken: "YES" as const,
    krakenSpotAvailable: "YES" as const,
    krakenMarginAvailable: "UNKNOWN" as const,
    krakenFuturesAvailable: "UNKNOWN" as const,
    usLeverageAvailable: "UNKNOWN" as const,
    availablePairs: ["BTC/USD"],
    bestExchange: "kraken",
    recommendedAction: "SPOT_ONLY" as const,
    evidenceSource: "test",
    checkedAt: new Date().toISOString(),
    confidence: "high" as const,
    availabilityNote: null,
  };
}

function mockCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "BTC/USD",
    price: 100,
    spreadBps: 10,
    volume24hUsd: 10_000_000,
    change24hPct: 5,
    change1hPct: 1,
    marketCapUsd: 1_000_000_000_000,
    momentumScore: 70,
    volumeSpikeScore: 60,
    volatilityScore: 40,
    liquidityScore: 75,
    spreadScore: 80,
    trendScore: 70,
    dataQualityScore: 90,
    riskPenalty: 5,
    pumpRiskPenalty: 5,
    opportunityScore: 78,
    scoreBreakdown: emptyScoreBreakdown({ finalScore: 78, confidenceLevel: "HIGH", liquidityScore: 75 }),
    riskTier: "MAJOR",
    shortTermReturnPct: 1,
    breakoutScore: 60,
    source: "kraken",
    tradableOnConfiguredExchange: true,
    availability: confirmedAvailability(),
    action: "OPEN_TRADE",
    actionType: "OPEN_PAPER_TRADE",
    reasonCode: "TRADE_READY",
    reasonText: "test",
    ...overrides,
  } as ScanCandidate;
}

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
    symbol: "FARTCOIN/USD",
    baseAsset: "FARTCOIN",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    status: "CLOSED",
    result: "LOSS",
    reason:
      "HIGH_VOLATILITY_PAPER_ONLY: LONG — HIGH_VOLATILITY, score 62 | closed: STOP_LOSS_HIT",
    entryPrice: 1,
    exitPrice: 0.98,
    simulatedSize: 1000,
    netPaperPnl: -25,
    riskAmount: 15,
    riskPercent: 0.15,
    plannedStopLoss: 0.988,
    plannedTakeProfit: 1.014,
    isRealTrade: false,
    openedAt: new Date("2026-07-03T21:20:00Z"),
    closedAt: new Date("2026-07-03T22:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

describe("risk/reward filter", () => {
  it("rejects MAJOR when reward/risk below 1.2", () => {
    const result = evaluateRiskReward({
      riskTier: "MAJOR",
      side: "LONG",
      entryPrice: 100,
      plannedStopLoss: 99,
      plannedTakeProfit: 100.5,
      riskAmountUsd: 50,
    });
    expect(result.passed).toBe(false);
    expect(result.reasonCode).toBe("REJECTED_BAD_RISK_REWARD");
  });

  it("accepts MAJOR when reward/risk meets tier minimum", () => {
    const result = evaluateRiskReward({
      riskTier: "MAJOR",
      side: "LONG",
      entryPrice: 100,
      plannedStopLoss: 99.2,
      plannedTakeProfit: 101.2,
      riskAmountUsd: 50,
      opportunityScore: 75,
      winProbability: 0.7,
    });
    expect(result.passed).toBe(true);
    expect(result.rewardRiskRatio).toBeGreaterThanOrEqual(MIN_REWARD_RISK_BY_TIER.MAJOR);
  });

  it("requires higher R:R for HIGH_VOLATILITY", () => {
    const result = evaluateRiskReward({
      riskTier: "HIGH_VOLATILITY",
      side: "LONG",
      entryPrice: 100,
      plannedStopLoss: 98.8,
      plannedTakeProfit: 101.44,
      riskAmountUsd: 15,
      opportunityScore: 70,
      winProbability: 0.6,
    });
    expect(result.passed).toBe(false);
    expect(result.reasonCode).toBe("REJECTED_BAD_RISK_REWARD");
  });
});

describe("fake pump filter", () => {
  it("rejects suspicious pump profile", () => {
    const result = evaluateFakePumpRisk({
      riskTier: "HIGH_VOLATILITY",
      change24hPct: 45,
      change1hPct: -2,
      volume24hUsd: 600_000,
      liquidityScore: 40,
      spreadBps: 120,
      pumpRiskPenalty: 45,
      momentumScore: 30,
      volumeSpikeScore: 90,
      tradableOnConfiguredExchange: true,
      breakdown: emptyScoreBreakdown({ finalScore: 65, liquidityScore: 40, trendScore: 85 }),
    });
    expect(result.passed).toBe(false);
    expect(["REJECTED_FAKE_PUMP_RISK", "WATCH_ONLY_FAKE_PUMP_RISK"]).toContain(result.reasonCode);
  });
});

describe("controlled strategy integration", () => {
  it("original MAJOR winner profile still passes when R:R is valid", () => {
    const strategy = evaluateControlledActiveStrategy(mockCandidate(), 0.3);
    expect(strategy.decision).toBe("LONG");
    expect(strategy.reasonCode).toBe("TRADE_READY");
  });

  it("blocks weak HIGH_VOL meme-style candidate", () => {
    const strategy = evaluateControlledActiveStrategy(
      mockCandidate({
        symbol: "POPCAT/USD",
        riskTier: "HIGH_VOLATILITY",
        opportunityScore: 62,
        pumpRiskPenalty: 35,
        change24hPct: 18,
      }),
      0.03,
    );
    expect(strategy.decision).toBe("NO_TRADE");
  });
});

describe("thesis invalidation early exit", () => {
  it("exits before stop when thesis breaks on losing trade", () => {
    const candles = Array.from({ length: 8 }, (_, i) => ({
      timestamp: new Date(Date.now() - (8 - i) * 300_000).toISOString(),
      open: 100 - i * 0.2,
      high: 100 - i * 0.15,
      low: 99 - i * 0.25,
      close: 100 - i * 0.2,
      volume: i < 4 ? 1000 : 200,
      timeframe: "5m" as const,
    }));
    const snapshot = {
      symbol: "BTC/USD",
      ticker: { symbol: "BTC/USD", price: 98.5, bid: 98.4, ask: 98.6, spread: 0.2, spreadBps: 20, volume24h: 1e6, timestamp: new Date().toISOString(), source: "kraken", latencyMs: 10 },
      orderBook: null,
      candles1m: [],
      candles5m: candles,
      relativeVolume: 0.5,
      liquidityUsd: 1_000_000,
      feeModel: { makerBps: 16, takerBps: 26, source: "kraken", known: true },
      slippageEstimate: { bps: 5, method: "test", confidence: 0.9 },
      metadata: { symbol: "BTC/USD", baseAsset: "BTC", quoteAsset: "USD", pairAgeDays: null, minOrderSize: 0.0001, fundingRate: null, openInterest: null, source: "kraken" },
      providerHealth: "ok",
    } satisfies NormalizedMarketSnapshot;

    const result = evaluateThesisInvalidation({
      side: "LONG",
      entryPrice: 100,
      markPrice: 98.5,
      snapshot,
      entryMomentumPct: 0.5,
      earlyLossCutBps: 65,
      invalidationThreshold: 55,
    });
    expect(result.shouldExit).toBe(true);
    expect(result.exitReason).not.toBeNull();
  });
});

describe("no forced trade", () => {
  it("returns watch on weak setup", () => {
    const result = evaluateTradeSelection({
      breakdown: emptyScoreBreakdown({ finalScore: 40, confidenceLevel: "LOW" }),
      availability: confirmedAvailability(),
      riskTier: "MAJOR",
      spreadBps: 20,
      volume24hUsd: 5_000_000,
      change24hPct: 1,
      momentumPct: 0.01,
      hasExitPlan: true,
      entryPrice: 100,
    });
    expect(result.shouldOpen).toBe(false);
  });

  it("provides NO_TRADE_BEST_DECISION message", () => {
    expect(noTradeBestDecisionMessage(10, 0)).toContain("NO_TRADE_BEST_DECISION");
  });
});

describe("profit quality dashboard", () => {
  it("shows unhealthy verdict when avg loss exceeds avg win", () => {
    const summary = buildPaperPerformanceSummary({
      trades: [
        mockTrade({ result: "WIN", netPaperPnl: 10, status: "CLOSED", symbol: "BTC/USD", baseAsset: "BTC", reason: "win" }),
        mockTrade({ netPaperPnl: -35 }),
      ],
    });
    const verdict = buildProfitQualityVerdict(summary);
    expect(verdict).toContain("average loss");
    const quality = buildProfitQualitySummary(summary);
    expect(quality.avgLossToWinRatio).toBeGreaterThan(1);
  });

  it("activates risk mode when profit factor is weak", () => {
    const summary = buildPaperPerformanceSummary({
      trades: Array.from({ length: 8 }, (_, i) =>
        mockTrade({
          id: `t${i}`,
          symbol: i < 6 ? "BTC/USD" : "POPCAT/USD",
          baseAsset: i < 6 ? "BTC" : "POPCAT",
          result: i < 6 ? "WIN" : "LOSS",
          netPaperPnl: i < 6 ? 8 : -30,
          status: "CLOSED",
          reason: i < 6 ? "win" : "loss | closed: STOP_LOSS",
        }),
      ),
      maxDrawdown: 200,
    });
    const riskMode = evaluateRiskMode(summary, 140);
    expect(riskMode.active).toBe(true);
    expect(riskMode.dashboardLabel).toBe("RISK_MODE_ACTIVE");
  });
});

describe("historical diagnostic", () => {
  it("identifies losing trades that new rules would block", () => {
    const diagnostic = diagnoseTradeHistory([
      mockTrade(),
      mockTrade({ id: "t2", symbol: "HYPE/USD", baseAsset: "HYPE", reason: "score: 52 | closed: STOP_LOSS_HIT", netPaperPnl: -69 }),
      mockTrade({ id: "t3", symbol: "BTC/USD", baseAsset: "BTC", result: "WIN", netPaperPnl: 20, reason: "score: 70 | closed: TAKE_PROFIT" }),
    ]);
    expect(diagnostic.wouldBlockAtEntry.length).toBeGreaterThan(0);
    expect(diagnostic.estimatedLossReductionUsd).toBeGreaterThan(0);
  });
});

describe("safety locks", () => {
  it("keeps live trading and Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });
});
