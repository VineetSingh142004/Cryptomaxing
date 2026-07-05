import { describe, expect, it } from "vitest";
import type { PaperRecord, PaperTrade } from "@prisma/client";
import {
  buildCarriedClosedTradeSnapshots,
  buildCleanFreshStartStatus,
  buildRecordVerdicts,
  computeCarriedTradeStats,
} from "@/lib/trading/paper/record-accounting";
import {
  buildRecordActivityFeed,
  buildCurrentRecordAccounting,
  CARRIED_FROM_PREVIOUS_RECORD,
  computeRecordPerformanceBreakdown,
} from "@/lib/trading/paper/paper-record";
import { buildPaperPerformanceSummary, formatProfitFactorDisplay } from "@/lib/trading/paper/performance-summary";
import { evaluateRecordCautionMode } from "@/lib/trading/paper/profit-protection";
import { buildWhyNoTradeReport } from "@/lib/trading/paper/why-no-trade-report";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { minScoreForTier } from "@/lib/trading/paper/trade-selection";

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
    recordId: "rec-1",
    strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    symbol: "BTC/USD",
    baseAsset: "BTC",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    entryPrice: { toNumber: () => 100 } as never,
    plannedStopLoss: { toNumber: () => 99 } as never,
    plannedTakeProfit: { toNumber: () => 101 } as never,
    simulatedSize: { toNumber: () => 1 } as never,
    riskAmount: { toNumber: () => 50 } as never,
    riskPercent: { toNumber: () => 0.5 } as never,
    status: "CLOSED",
    openedAt: new Date("2026-01-01T10:00:00Z"),
    closedAt: new Date("2026-01-01T12:00:00Z"),
    exitPrice: { toNumber: () => 101 } as never,
    grossPaperPnl: { toNumber: () => 0.5 } as never,
    estimatedFees: { toNumber: () => 0.01 } as never,
    estimatedSlippage: { toNumber: () => 0.01 } as never,
    netPaperPnl: { toNumber: () => 10 } as never,
    result: "WIN",
    confidence: { toNumber: () => 0.8 } as never,
    reason: "LONG — MAJOR | closed: TAKE_PROFIT_HIT",
    dataSource: "kraken",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    carriedAt: null,
    carriedBaselineUnrealizedPnl: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

describe("record verdict accounting", () => {
  it("never shows profitable when total record P&L is negative", () => {
    const verdicts = buildRecordVerdicts({
      recordPnl: -162.7909,
      newRecordRealizedPnl: 21.8369,
      newRecordUnrealizedPnl: 0,
      carriedPnlSinceCarry: -184.6279,
      newTradesSummary: {
        wins: 2,
        losses: 0,
        totalClosedTrades: 2,
        closedTradesInRecord: 2,
        winRate: 1,
        profitFactor: null,
      },
      carriedStats: {
        openCount: 0,
        closedCount: 3,
        wins: 0,
        losses: 3,
        breakevens: 0,
        realizedPnlSinceCarry: -184.6279,
        unrealizedPnlSinceCarry: 0,
        totalPnlSinceCarry: -184.6279,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      },
    });
    expect(verdicts.totalRecordVerdict.code).toBe("LOSING_OVERALL");
    expect(verdicts.simpleVerdict).not.toContain("bot is profitable");
    expect(verdicts.simpleVerdict).toContain("Do not treat the record as profitable");
    expect(verdicts.overallRecordStatus).toBe("Losing");
  });

  it("labels new-trade win rate separately from total record result", () => {
    const verdicts = buildRecordVerdicts({
      recordPnl: -162.7909,
      newRecordRealizedPnl: 21.8369,
      newRecordUnrealizedPnl: 0,
      carriedPnlSinceCarry: -184.6279,
      newTradesSummary: {
        wins: 2,
        losses: 0,
        totalClosedTrades: 2,
        closedTradesInRecord: 2,
        winRate: 1,
        profitFactor: null,
      },
      carriedStats: {
        openCount: 0,
        closedCount: 3,
        wins: 0,
        losses: 3,
        breakevens: 0,
        realizedPnlSinceCarry: -184.6279,
        unrealizedPnlSinceCarry: 0,
        totalPnlSinceCarry: -184.6279,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      },
    });
    expect(verdicts.newTradesVerdict.code).toBe("NEW_TRADES_PROFITABLE_BUT_SMALL_SAMPLE");
    expect(verdicts.carriedTradesVerdict.code).toBe("CARRIED_TRADES_CAUSED_MAJOR_LOSS");
  });
});

describe("carried closed trade accounting", () => {
  it("lists carried losses in carried closed section", () => {
    const carried = mockTrade({
      id: "c1",
      symbol: "ETH/USD",
      result: "LOSS",
      netPaperPnl: { toNumber: () => -60 } as never,
      reason: `entry | ${CARRIED_FROM_PREVIOUS_RECORD} | closed: STOP_LOSS_HIT`,
      carriedAt: new Date("2026-03-01T12:00:00Z"),
      carriedBaselineUnrealizedPnl: { toNumber: () => 5 } as never,
    });
    const closed = buildCarriedClosedTradeSnapshots([carried], new Map());
    expect(closed).toHaveLength(1);
    expect(closed[0]?.pnlSinceCarry).toBe(-65);
    expect(closed[0]?.countsTowardRecordPnl).toBe(true);
  });
});

describe("cooldown explanation", () => {
  it("matches visible carried loss source", () => {
    const summary = buildPaperPerformanceSummary({ trades: [], latestMarkByTradeId: new Map() });
    const caution = evaluateRecordCautionMode(summary, 9779.8715, {
      recordPnl: -162.79,
      newTradeLosses: 0,
      carriedTradeLosses: 3,
      allRecordLosses: 3,
      carriedPnlSinceCarry: -184.6279,
    });
    expect(caution.mode).toBe("COOLDOWN_MODE");
    expect(caution.dashboardMessage).toContain("carried-trade losses");
    expect(caution.dashboardMessage).not.toContain("3+ losses in current record");
    expect(caution.metricsUsed.carriedTradeLosses).toBe(3);
    expect(caution.metricsUsed.newTradeLosses).toBe(0);
  });
});

describe("clean fresh start", () => {
  it("is allowed when active open trade count is 0", () => {
    const status = buildCleanFreshStartStatus([]);
    expect(status.available).toBe(true);
    expect(status.blockingOpenTradeCount).toBe(0);
  });

  it("is blocked only when active open trades exist", () => {
    const status = buildCleanFreshStartStatus([
      mockTrade({ id: "open-1", status: "OPEN", result: "OPEN", closedAt: null }),
    ]);
    expect(status.available).toBe(false);
    expect(status.blockingOpenTradeCount).toBe(1);
    expect(status.blockingSymbols).toContain("BTC/USD");
  });
});

describe("why-no-trade counts", () => {
  it("cannot report failed count above total candidates", () => {
    const report = buildWhyNoTradeReport({
      tradesOpenedThisRun: 0,
      ranked: Array.from({ length: 120 }, (_, i) =>
        ({
          symbol: `COIN${i}/USD`,
          opportunityScore: 50,
          riskTier: "MAJOR",
          action: "NO_TRADE",
          reasonCode: "SCORE_TOO_LOW",
          reasonText: "too low",
          scoreBreakdown: emptyScoreBreakdown(),
        }) as ScanCandidate,
      ),
      rejectionSummary: { SCORE_TOO_LOW: 121 },
      openTradesCount: 0,
      availableSlots: 1,
      riskMode: "WARMUP_MODE",
      totalCandidates: 120,
    });
    expect(report?.candidateCounts.totalRanked).toBe(120);
    expect(report?.candidateCounts.failedFilters).toBeLessThanOrEqual(120);
    expect(report?.finalReason).toContain("120 candidates ranked");
  });
});

describe("score threshold message", () => {
  it("does not say score below required when score is above base threshold", () => {
    const report = buildWhyNoTradeReport({
      tradesOpenedThisRun: 0,
      ranked: [
        {
          symbol: "BTC/USD",
          opportunityScore: 68,
          riskTier: "MAJOR",
          action: "NO_TRADE",
          reasonCode: "SCORE_TOO_LOW",
          reasonText: `Score 68 below required ${minScoreForTier("MAJOR")} for MAJOR.`,
          scoreBreakdown: emptyScoreBreakdown({ finalScore: 68 }),
        } as ScanCandidate,
      ],
      rejectionSummary: { SCORE_TOO_LOW: 1 },
      openTradesCount: 0,
      availableSlots: 1,
      riskMode: "CAUTION_MODE",
      recordCaution: {
        active: true,
        mode: "CAUTION_MODE",
        dashboardLabel: "CAUTION_MODE",
        dashboardMessage: "Caution mode active",
        allocationMultiplier: 0.5,
        minScoreBoost: 12,
        blockHighVolAlts: true,
        pauseNewEntries: false,
        reasons: [],
        triggerSource: "warmup",
        metricsUsed: {
          newTradeLosses: 0,
          carriedTradeLosses: 0,
          allRecordLosses: 0,
          recordPnl: 0,
          drawdownPct: null,
        },
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      },
      totalCandidates: 1,
    });
    expect(report?.finalReason).not.toContain("68 below required 60");
    expect(report?.finalReason).toMatch(/caution mode|Score passed/i);
  });
});

describe("profit factor display", () => {
  it("shows no losses yet for wins with zero losses", () => {
    expect(formatProfitFactorDisplay(null, 2, 0)).toBe("No losses yet — profit factor not meaningful");
  });
});

describe("activity feed vs trade history", () => {
  it("uses ACCOUNTING_SYNC when zero trades closed", () => {
    const feed = buildRecordActivityFeed([], 10, {
      newTradesClosedInRecord: 0,
      carriedTradesClosedInRecord: 0,
    });
    expect(feed.some((e) => e.type === "TRADE_CLOSED")).toBe(false);
    expect(feed.some((e) => e.type === "ACCOUNTING_SYNC")).toBe(true);
  });

  it("uses TRADE_CLOSED only when trades actually closed", () => {
    const feed = buildRecordActivityFeed(
      [
        {
          startedAt: new Date("2026-07-04T20:01:27Z"),
          status: "COMPLETED",
          reasonCode: "SCAN_COMPLETE",
          tradesOpened: 0,
          tradesUpdated: 0,
          tradesClosed: 2,
          scanSummary: {},
        },
        {
          startedAt: new Date("2026-07-04T20:03:22Z"),
          status: "COMPLETED",
          reasonCode: "SCAN_COMPLETE",
          tradesOpened: 0,
          tradesUpdated: 0,
          tradesClosed: 1,
          scanSummary: {},
        },
      ],
      10,
      { newTradesClosedInRecord: 2, carriedTradesClosedInRecord: 1 },
    );
    const closeEvents = feed.filter((e) => e.type === "TRADE_CLOSED");
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0]?.summary).toContain("2 closed new trade(s), 1 closed carried trade(s)");
  });
});

describe("safety unchanged", () => {
  it("keeps P&L simulated and live/Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });
});

describe("current record accounting sync", () => {
  it("counts open ADA trade as newTradesOpened = 1 with unrealized P&L", () => {
    const markMap = new Map<string, number>([["ada-1", 0.52]]);
    const openAda = mockTrade({
      id: "ada-1",
      symbol: "ADA/USD",
      baseAsset: "ADA",
      status: "OPEN",
      result: "OPEN",
      closedAt: null,
      exitPrice: null,
      netPaperPnl: null,
      entryPrice: { toNumber: () => 0.48 } as never,
      simulatedSize: { toNumber: () => 10000 } as never,
      recordId: "rec-v5",
    });
    const accounting = buildCurrentRecordAccounting({
      record: {
        id: "rec-v5",
        startingPaperBalance: { toNumber: () => 9617.0806 } as never,
      } as PaperRecord,
      recordTrades: [openAda],
      markMap,
    });
    expect(accounting.newTradesOpened).toBe(1);
    expect(accounting.newOpenTrades).toBe(1);
    expect(accounting.newClosedTrades).toBe(0);
    expect(accounting.newUnrealizedPnl).toBeCloseTo(400, 0);
    expect(accounting.currentEquity).toBeCloseTo(accounting.startingEquity + accounting.totalRecordPnl, 4);
    expect(accounting.newOpenTradeDetails).toHaveLength(1);
    expect(accounting.newOpenTradeDetails[0]?.symbol).toBe("ADA/USD");
    expect(accounting.newOpenTradeDetails[0]?.unrealizedPnl).not.toBe(0);
    expect(accounting.cleanFreshStart.available).toBe(false);
    expect(accounting.cleanFreshStart.blockingSymbols).toContain("ADA/USD");
  });

  it("current equity equals starting plus total record P&L after closed loss", () => {
    const closedAda = mockTrade({
      id: "ada-closed",
      symbol: "ADA/USD",
      status: "CLOSED",
      result: "LOSS",
      netPaperPnl: { toNumber: () => -18.6465 } as never,
      recordId: "rec-v5",
    });
    const accounting = buildCurrentRecordAccounting({
      record: {
        id: "rec-v5",
        startingPaperBalance: { toNumber: () => 9617.0806 } as never,
      } as PaperRecord,
      recordTrades: [closedAda],
      markMap: new Map(),
    });
    expect(accounting.totalRecordPnl).toBeCloseTo(-18.6465, 4);
    expect(accounting.currentEquity).toBeCloseTo(9598.4341, 4);
    expect(accounting.currentEquity).toBeCloseTo(accounting.startingEquity + accounting.totalRecordPnl, 4);
  });

  it("dashboard and export metrics stay aligned via shared accounting", () => {
    const entry = 0.48;
    const size = 10387.5;
    const mark = entry + 4.9612 / size;
    const markMap = new Map<string, number>([["ada-1", mark]]);
    const openAda = mockTrade({
      id: "ada-1",
      symbol: "ADA/USD",
      status: "OPEN",
      result: "OPEN",
      closedAt: null,
      netPaperPnl: null,
      recordId: "rec-v5",
      entryPrice: { toNumber: () => entry } as never,
      simulatedSize: { toNumber: () => size } as never,
    });
    const accounting = buildCurrentRecordAccounting({
      record: {
        id: "rec-v5",
        startingPaperBalance: { toNumber: () => 9617.0806 } as never,
      } as PaperRecord,
      recordTrades: [openAda],
      markMap,
    });
    expect(accounting.currentEquity).toBeCloseTo(9622.0418, 3);
    expect(accounting.totalRecordPnl).toBeCloseTo(4.9612, 3);
    expect(accounting.newUnrealizedPnl).toBeCloseTo(4.9612, 3);
    expect(accounting.newTradesOpened).toBe(1);
    expect(accounting.newOpenTrades).toBe(1);
  });

  it("trade log detail cannot disagree with summary open count", () => {
    const accounting = buildCurrentRecordAccounting({
      record: {
        id: "rec-v5",
        startingPaperBalance: { toNumber: () => 9617.0806 } as never,
      } as PaperRecord,
      recordTrades: [
        mockTrade({
          id: "ada-1",
          symbol: "ADA/USD",
          status: "OPEN",
          result: "OPEN",
          recordId: "rec-v5",
        }),
      ],
      markMap: new Map([["ada-1", 0.5]]),
    });
    expect(accounting.newTradesOpened).toBe(accounting.newOpenTradeDetails.length);
  });
});

describe("record performance breakdown", () => {
  it("computes total record P&L including carried closed losses", () => {
    const newWin = mockTrade({ id: "n1", netPaperPnl: { toNumber: () => 10 } as never });
    const newWin2 = mockTrade({ id: "n2", netPaperPnl: { toNumber: () => 11.8369 } as never });
    const carriedLoss = mockTrade({
      id: "c1",
      result: "LOSS",
      netPaperPnl: { toNumber: () => -184.6279 } as never,
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD} | closed: STOP_LOSS_HIT`,
      carriedBaselineUnrealizedPnl: { toNumber: () => 0 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-4",
        startingPaperBalance: { toNumber: () => 9779.8715 } as never,
      } as PaperRecord,
      recordTrades: [newWin, newWin2, carriedLoss],
      markMap: new Map(),
    });
    expect(breakdown.newRecordRealizedPnl).toBeCloseTo(21.8369, 4);
    expect(breakdown.carriedPnlSinceCarry).toBeCloseTo(-184.6279, 4);
    expect(breakdown.recordPnl).toBeCloseTo(-162.7909, 3);
  });
});
