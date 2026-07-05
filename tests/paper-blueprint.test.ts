import { describe, expect, it } from "vitest";
import { evaluateBlueprintExit } from "@/lib/trading/paper/blueprint-exit-engine";
import {
  evaluateProfitLockState,
  evaluateRecordProfitLock,
} from "@/lib/trading/paper/profit-lock-engine";
import { evaluateOpportunityCost } from "@/lib/trading/paper/opportunity-cost-engine";
import { evaluateTradeFrequencyHealth } from "@/lib/trading/paper/trade-frequency-health";
import { buildWhyNoTradeReport } from "@/lib/trading/paper/why-no-trade-report";
import {
  blockIfNoBlueprintStrategy,
  evaluateAllBlueprintStrategies,
  mapStrategyForCandidate,
} from "@/lib/trading/paper/strategy-mapping";
import { formatScoreTooLowMessage, minScoreForTier, resolveCandidateBlockReason } from "@/lib/trading/paper/trade-selection";
import { buildPaperBrokerRealismStatus } from "@/lib/trading/paper/paper-broker-realism";
import { evaluateRecordCautionMode } from "@/lib/trading/paper/profit-protection";
import { buildPaperPerformanceSummary } from "@/lib/trading/paper/performance-summary";
import { evaluateOpenTradeThesisReview } from "@/lib/trading/paper/thesis-invalidation";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { PaperTrade } from "@prisma/client";

function mockCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "BTC/USD",
    price: 100,
    spreadBps: 10,
    volume24hUsd: 10_000_000,
    change24hPct: 5,
    change1hPct: 1,
    marketCapUsd: 1e12,
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
    scoreBreakdown: emptyScoreBreakdown({ finalScore: 78, confidenceLevel: "HIGH" }),
    riskTier: "MAJOR",
    shortTermReturnPct: 1,
    breakoutScore: 60,
    source: "kraken",
    tradableOnConfiguredExchange: true,
    availability: {
      listedOnKraken: "YES",
      krakenSpotAvailable: "YES",
      krakenMarginAvailable: "UNKNOWN",
      krakenFuturesAvailable: "UNKNOWN",
      usLeverageAvailable: "UNKNOWN",
      availablePairs: ["BTC/USD"],
      bestExchange: "kraken",
      recommendedAction: "SPOT_ONLY",
      evidenceSource: "test",
      checkedAt: new Date().toISOString(),
      confidence: "high",
      availabilityNote: null,
    },
    action: "OPEN_TRADE",
    actionType: "OPEN_PAPER_TRADE",
    reasonCode: "TRADE_READY",
    reasonText: "ready",
    ...overrides,
  } as ScanCandidate;
}

describe("blueprint exit engine", () => {
  it("exits near stop-loss within 0.10%", () => {
    const lock = evaluateProfitLockState({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99.91,
      plannedTakeProfit: 101.2,
      currentUnrealizedPnl: -0.9,
    });
    const snapshot = {
      symbol: "X/USD",
      source: "kraken",
      ticker: { last: 99.91, bid: 99.9, ask: 99.92, spreadBps: 10 },
      candles5m: [{ open: 100, high: 100, low: 99.9, close: 99.91, volume: 1, timestamp: new Date().toISOString() }],
      relativeVolume: 1,
    } as NormalizedMarketSnapshot;
    const result = evaluateBlueprintExit({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99.91,
      plannedStopLoss: 99.9,
      plannedTakeProfit: 101.2,
      openedAt: new Date(Date.now() - 3600_000),
      now: new Date(),
      runsHeld: 1,
      snapshot,
      hasMarketData: true,
      thesisStatus: "VALID",
      thesisRecommendation: "HOLD",
      unrealizedPnl: -0.9,
      peakUnrealizedPnl: 0,
      profitLock: lock,
    });
    expect(result.shouldExit).toBe(true);
    expect(result.exitReason).toBe("NEAR_STOP_EXIT");
  });

  it("exits on unknown thesis after threshold runs", () => {
    const lock = evaluateProfitLockState({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99.8,
      plannedTakeProfit: 101.2,
      currentUnrealizedPnl: -2,
    });
    const result = evaluateBlueprintExit({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99.8,
      plannedStopLoss: 98.5,
      plannedTakeProfit: 101.2,
      openedAt: new Date(Date.now() - 7200_000),
      now: new Date(),
      runsHeld: 6,
      snapshot: null,
      hasMarketData: false,
      thesisStatus: "UNKNOWN_NEEDS_DATA",
      thesisRecommendation: "NEEDS_MORE_DATA",
      unrealizedPnl: -2,
      peakUnrealizedPnl: 0,
      profitLock: lock,
      unknownThesisRunsThreshold: 5,
    });
    expect(result.shouldExit).toBe(true);
    expect(result.exitReason).toBe("UNKNOWN_THESIS_EXIT");
  });

  it("missing snapshot does not imply safe hold when near stop", () => {
    const review = evaluateOpenTradeThesisReview({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99.75,
      snapshot: {
        symbol: "X/USD",
        ticker: { last: 99.75, bid: 99.7, ask: 99.8, spreadBps: 10 },
        candles5m: [],
        relativeVolume: 1,
      } as NormalizedMarketSnapshot,
      hasMarketData: false,
      dataSource: "kraken",
    });
    expect(review.recommendation).not.toBe("HOLD");
  });
});

describe("profit lock engine", () => {
  it("activates profit lock at 50% TP progress", () => {
    const state = evaluateProfitLockState({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.61,
      plannedTakeProfit: 101.2,
      currentUnrealizedPnl: 6.1,
    });
    expect(state.profitLockLabel).toBe("PROFIT_LOCK_ACTIVE");
    expect(state.shouldTightenStop).toBe(true);
  });

  it("protects breakeven at 70% TP progress", () => {
    const state = evaluateProfitLockState({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.84,
      plannedTakeProfit: 101.2,
      currentUnrealizedPnl: 8.4,
    });
    expect(state.profitLockLabel).toBe("BREAKEVEN_PROTECTED");
    expect(state.breakevenProtected).toBe(true);
  });

  it("exits on trade profit giveback", () => {
    const state = evaluateProfitLockState({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.3,
      plannedTakeProfit: 101.2,
      currentUnrealizedPnl: 3,
      peakUnrealizedPnl: 10,
    });
    expect(state.shouldExitGiveback).toBe(true);
  });

  it("flags record profit giveback", () => {
    const record = evaluateRecordProfitLock({
      openTradesUnrealized: [8, 4, 2],
    });
    expect(record.recordProfitLockActive).toBe(true);
  });
});

describe("opportunity cost", () => {
  it("rotates when better setup exists", () => {
    const result = evaluateOpportunityCost({
      openTrade: {
        symbol: "OLD/USD",
        side: "LONG",
        entryPrice: 100,
        markPrice: 99,
        unrealizedPnl: -10,
        tpProgressPct: 5,
        thesisStatus: "WEAKENING",
        staleTrade: true,
        ageHours: 4,
        capitalLockedUsd: 1000,
        opportunityScoreAtEntry: 62,
      },
      bestCandidate: mockCandidate({ symbol: "NEW/USD", opportunityScore: 82 }),
    });
    expect(result.shouldExitForBetterSetup).toBe(true);
    expect(result.verdict).toBe("BETTER_SETUP_ROTATION_EXIT");
  });
});

describe("trade frequency health", () => {
  it("flags too strict bot", () => {
    const health = evaluateTradeFrequencyHealth({
      runsCompleted: 50,
      candidatesScanned: 7000,
      candidatesEvaluated: 7000,
      tradesOpened: 1,
      tradesClosed: 1,
      rejections: 6800,
      noTradeRuns: 49,
      averageHoldingHours: 1,
      openSlotsUsed: 3,
      maxOpenSlots: 5,
    });
    expect(health.tooStrict).toBe(true);
    expect(health.recommendation).toContain("too strict");
  });
});

describe("why no trade report", () => {
  it("includes exact blockers", () => {
    const report = buildWhyNoTradeReport({
      tradesOpenedThisRun: 0,
      ranked: [mockCandidate({ opportunityScore: 70, reasonCode: "SCORE_TOO_LOW", action: "NO_TRADE" as never })],
      rejectionSummary: { SCORE_TOO_LOW: 100 },
      openTradesCount: 3,
      availableSlots: 0,
      riskMode: "WARMUP_MODE",
      totalCandidates: 120,
    });
    expect(report?.finalReason).toContain("120 candidates ranked");
    expect(report?.finalReason).toContain("MAX_OPEN_TRADES_OR_EXPOSURE");
    expect(report?.openTradesCount).toBe(3);
  });

  it("explains all three blueprint strategy checks when no match", () => {
    const report = buildWhyNoTradeReport({
      tradesOpenedThisRun: 0,
      ranked: [
        mockCandidate({
          symbol: "BASED/USD",
          opportunityScore: 73,
          action: "NO_TRADE" as never,
          reasonCode: "VOLATILITY_TOO_LOW",
          reasonText: "Momentum weak",
          momentumScore: 40,
          trendScore: 40,
          breakoutScore: 30,
          volatilityScore: 30,
          shortTermReturnPct: 0.1,
        }),
      ],
      rejectionSummary: { VOLATILITY_TOO_LOW: 120 },
      openTradesCount: 0,
      availableSlots: 3,
      riskMode: "WARMUP_MODE",
      totalCandidates: 120,
    });
    expect(report?.exactBlocker).toBe("NO_BLUEPRINT_STRATEGY_MATCH");
    expect(report?.blueprintStrategyMatchDebug).not.toBeNull();
    expect(report?.blueprintStrategyMatchDebug?.vwapReclaimMomentum.passed).toBe(false);
    expect(report?.blueprintStrategyMatchDebug?.volatilityCompressionBreakout.passed).toBe(false);
    expect(report?.blueprintStrategyMatchDebug?.trendPullbackContinuation.passed).toBe(false);
  });

  it("watch-only candidates are not labeled score-too-low in final reason", () => {
    const report = buildWhyNoTradeReport({
      tradesOpenedThisRun: 0,
      ranked: [
        mockCandidate({
          opportunityScore: 65,
          riskTier: "MAJOR",
          action: "NO_TRADE" as never,
          reasonCode: "SCORE_TOO_LOW",
          reasonText: formatScoreTooLowMessage(65, "MAJOR"),
        }),
      ],
      rejectionSummary: { SCORE_TOO_LOW: 1 },
      openTradesCount: 0,
      availableSlots: 3,
      riskMode: "WARMUP_MODE",
      totalCandidates: 1,
    });
    expect(report?.finalReason).not.toContain("65 below required 60");
    expect(report?.finalReason).toMatch(/passed|blueprint|confidence|filter/i);
  });
});

describe("score threshold messages", () => {
  it("score 65 required 60 never says below required", () => {
    const msg = resolveCandidateBlockReason({
      score: 65,
      tier: "MAJOR",
      reasonCode: "SCORE_TOO_LOW",
      reasonText: formatScoreTooLowMessage(65, "MAJOR"),
    });
    expect(msg).not.toContain("65 below required 60");
    expect(msg).toContain("passed");
  });

  it("uses effective caution threshold in score message", () => {
    const msg = formatScoreTooLowMessage(65, "MAJOR", minScoreForTier("MAJOR") + 12);
    expect(msg).toContain("below required 72");
    expect(msg).not.toContain("below required 60");
  });
});

describe("strategy registry", () => {
  it("maps new trades to blueprint strategies", () => {
    const mapping = mapStrategyForCandidate(mockCandidate());
    expect([
      "VWAP Reclaim Momentum",
      "Volatility Compression Breakout",
      "Trend Pullback Continuation",
    ]).toContain(mapping.strategyName);
  });

  it("blocks score-only trades without blueprint match", () => {
    const blocked = blockIfNoBlueprintStrategy(
      mockCandidate({ opportunityScore: 55, action: "OPEN_TRADE" }),
    );
    expect(blocked.blocked).toBe(true);
  });
});

describe("record risk mode", () => {
  it("uses WARMUP not LOW for fresh records", () => {
    const summary = buildPaperPerformanceSummary({
      trades: [],
      latestMarkByTradeId: new Map(),
      maxDrawdown: null,
    });
    const mode = evaluateRecordCautionMode(summary, 10_000);
    expect(mode.dashboardLabel).not.toBe("LOW");
    expect(mode.active).toBe(true);
  });
});

describe("paper broker realism", () => {
  it("marks missing realism as NOT_IMPLEMENTED", () => {
    const status = buildPaperBrokerRealismStatus();
    expect(status.partialFills).toBe("NOT_IMPLEMENTED");
    expect(status.latency).toBe("NOT_IMPLEMENTED");
    expect(status.makerTakerFees).toBe("IMPLEMENTED");
  });
});

describe("safety unchanged", () => {
  it("keeps live and Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
  });
});
