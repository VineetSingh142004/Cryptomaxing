import { describe, expect, it } from "vitest";
import type { PaperTestBaseline, PaperTrade } from "@prisma/client";
import {
  buildAllTimePerformanceNote,
  buildStrategyVersionMetrics,
  createPaperTestBaseline,
  filterTradesSinceBaseline,
  filterTradesByStrategyVersion,
  resolveRiskPerformanceScope,
} from "@/lib/trading/paper/paper-baseline";
import { buildPaperPerformanceSummary } from "@/lib/trading/paper/performance-summary";
import { computeOpenExposureMetrics } from "@/lib/trading/paper/exposure-metrics";
import {
  evaluateOpenTradeThesisReview,
} from "@/lib/trading/paper/thesis-invalidation";
import { evaluateRiskMode } from "@/lib/trading/paper/profit-protection";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { prepareCandidateWriteData } from "@/lib/trading/paper/candidate-write";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
    strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    symbol: "BTC/USD",
    baseAsset: "BTC",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    entryPrice: { toNumber: () => 100 } as never,
    plannedStopLoss: { toNumber: () => 99 } as never,
    plannedTakeProfit: { toNumber: () => 101 } as never,
    simulatedSize: { toNumber: () => 0.5 } as never,
    riskAmount: { toNumber: () => 50 } as never,
    riskPercent: { toNumber: () => 0.5 } as never,
    status: "CLOSED",
    openedAt: new Date("2026-01-01T10:00:00Z"),
    closedAt: new Date("2026-01-01T12:00:00Z"),
    exitPrice: { toNumber: () => 101 } as never,
    grossPaperPnl: { toNumber: () => 0.5 } as never,
    estimatedFees: { toNumber: () => 0.01 } as never,
    estimatedSlippage: { toNumber: () => 0.01 } as never,
    netPaperPnl: { toNumber: () => 0.48 } as never,
    result: "WIN",
    confidence: { toNumber: () => 0.8 } as never,
    reason: "LONG — MAJOR | closed: TAKE_PROFIT_HIT",
    dataSource: "kraken",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

function mockBaseline(overrides: Partial<PaperTestBaseline> = {}): PaperTestBaseline {
  return {
    id: "b1",
    userId: "u1",
    strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    startedAt: new Date("2026-02-01T00:00:00Z"),
    startingPaperBalance: { toNumber: () => 9950 } as never,
    startingRealizedPnl: { toNumber: () => -50 } as never,
    startingUnrealizedPnl: { toNumber: () => 0 } as never,
    startingTradeCount: 25,
    startingClosedCount: 25,
    startingOpenCount: 0,
    notes: "test baseline",
    isActive: true,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  } as PaperTestBaseline;
}

describe("strategy versioning", () => {
  it("tags candidate writes with current strategy version", () => {
    const candidate: ScanCandidate = {
      symbol: "BTC/USD",
      coinName: "Bitcoin",
      source: "kraken",
      price: 100,
      spreadBps: 10,
      volume24hUsd: 1_000_000,
      change24hPct: 1,
      change7dPct: 2,
      marketCapUsd: 1_000_000,
      riskTier: "MAJOR",
      opportunityScore: 70,
      momentumScore: 60,
      volumeSpikeScore: 50,
      volatilityScore: 50,
      liquidityScore: 70,
      spreadScore: 80,
      trendScore: 60,
      scoreBreakdown: emptyScoreBreakdown(),
      tradableOnConfiguredExchange: true,
      action: "OPEN_PAPER_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_READY",
      reasonText: "ready",
    };
    const prepared = prepareCandidateWriteData("run1", "u1", candidate);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.data.strategyVersion).toBe(CURRENT_PAPER_STRATEGY_VERSION);
    }
  });

  it("filters strategy-version trades separately from legacy", () => {
    const legacy = mockTrade({ id: "legacy", strategyVersion: "legacy", openedAt: new Date("2026-01-01") });
    const current = mockTrade({ id: "current", openedAt: new Date("2026-03-01") });
    const filtered = filterTradesByStrategyVersion([legacy, current], CURRENT_PAPER_STRATEGY_VERSION);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("current");
  });
});

describe("paper test baseline", () => {
  it("filters baseline metrics to trades after baseline timestamp", () => {
    const baseline = mockBaseline({ startedAt: new Date("2026-02-01T00:00:00Z") });
    const before = mockTrade({
      id: "before",
      openedAt: new Date("2026-01-15T00:00:00Z"),
      strategyVersion: "legacy",
    });
    const after = mockTrade({
      id: "after",
      openedAt: new Date("2026-02-02T00:00:00Z"),
    });
    const filtered = filterTradesSinceBaseline([before, after], baseline.startedAt);
    expect(filtered.map((t) => t.id)).toEqual(["after"]);
  });

  it("keeps all-time metrics unchanged when filtering baseline subset", () => {
    const all = [
      mockTrade({ id: "a", netPaperPnl: { toNumber: () => 1 } as never, result: "WIN" }),
      mockTrade({
        id: "b",
        netPaperPnl: { toNumber: () => -2 } as never,
        result: "LOSS",
        openedAt: new Date("2026-03-01"),
        closedAt: new Date("2026-03-01T01:00:00Z"),
      }),
    ];
    const allTime = buildPaperPerformanceSummary({ trades: all });
    const baselineOnly = buildPaperPerformanceSummary({
      trades: filterTradesSinceBaseline(all, new Date("2026-02-01T00:00:00Z")),
    });
    expect(allTime.totalClosedTrades).toBe(2);
    expect(baselineOnly.totalClosedTrades).toBe(1);
    expect(allTime.totalNetPnl).not.toBe(baselineOnly.totalNetPnl);
  });

  it("defaults risk scope to baseline when active baseline exists", () => {
    expect(
      resolveRiskPerformanceScope({
        activeBaseline: mockBaseline(),
      }),
    ).toBe("baseline");
    expect(
      resolveRiskPerformanceScope({
        activeBaseline: null,
      }),
    ).toBe("all_time");
  });

  it("notes that all-time includes older strategy versions", () => {
    expect(buildAllTimePerformanceNote(true)).toContain("older strategy versions");
    expect(buildStrategyVersionMetrics({
      trades: [mockTrade()],
      strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    }).strategyVersion).toBe(CURRENT_PAPER_STRATEGY_VERSION);
  });
});

describe("thesis validation for open trades", () => {
  it("does not default unknown thesis to plain HOLD", () => {
    const review = evaluateOpenTradeThesisReview({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99,
      snapshot: {
        symbol: "BTC/USD",
        ticker: { last: 99, bid: 99, ask: 99, spreadBps: 10 },
        candles5m: [],
        relativeVolume: 1,
      } as import("@/lib/trading/data/types").NormalizedMarketSnapshot,
      hasMarketData: false,
    });
    expect(review.status).toBe("UNKNOWN_NEEDS_DATA");
    expect(review.recommendation).not.toBe("HOLD");
  });
});

describe("exposure labels", () => {
  it("distinguishes capital exposure from risk-at-stop", () => {
    const metrics = computeOpenExposureMetrics({
      openTrades: [
        {
          entryPrice: 100,
          simulatedSize: 2,
          riskAmount: 50,
        },
      ],
      accountUsd: 10_000,
      riskUsedTodayUsd: 25,
      dailyBudgetUsd: 10_000,
    });
    expect(metrics.capitalExposurePct).toBe(2);
    expect(metrics.riskAtStopPct).toBe(0.5);
    expect(metrics.auditNote).toContain("Capital exposure");
    expect(metrics.auditNote).toContain("Risk-at-stop");
  });
});

describe("risk mode baseline behavior", () => {
  it("can evaluate risk mode using baseline scope label", () => {
    const summary = buildPaperPerformanceSummary({
      trades: [
        mockTrade({ netPaperPnl: { toNumber: () => -5 } as never, result: "LOSS" }),
        mockTrade({
          id: "l2",
          netPaperPnl: { toNumber: () => -6 } as never,
          result: "LOSS",
          openedAt: new Date("2026-03-01"),
          closedAt: new Date("2026-03-01T01:00:00Z"),
        }),
        mockTrade({
          id: "l3",
          netPaperPnl: { toNumber: () => -7 } as never,
          result: "LOSS",
          openedAt: new Date("2026-03-02"),
          closedAt: new Date("2026-03-02T01:00:00Z"),
        }),
      ],
    });
    const risk = evaluateRiskMode(summary, summary.riskAtStopPct, "baseline");
    expect(risk.performanceScope).toBe("baseline");
    expect(risk.performanceScopeLabel).toBe("current baseline");
  });
});

describe("paper safety locks", () => {
  it("keeps live trading locked and Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    const unlock = evaluateAutoUnlock(defaultAutoUnlockInput());
    expect(unlock.autoExecutionEnabled).toBe(false);
  });
});

describe("createPaperTestBaseline", () => {
  it("exports createPaperTestBaseline without deleting old data (function exists)", () => {
    expect(typeof createPaperTestBaseline).toBe("function");
  });
});
