import { describe, expect, it } from "vitest";
import type { PaperTrade } from "@prisma/client";
import {
  buildPaperTradeHistory,
  buildTradeHistoryRow,
  buildTradeHistorySummary,
} from "@/lib/trading/paper/trade-history";
import { buildFinalCandidateOutput } from "@/lib/trading/paper/candidate-output";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import { computeCoinsFilteredOut, EMPTY_PIPELINE } from "@/lib/trading/paper/scan-pipeline";
import { evaluateTradeSelection } from "@/lib/trading/paper/trade-selection";
import {
  CARRIED_FROM_PREVIOUS_RECORD,
  computeRecordPerformanceBreakdown,
} from "@/lib/trading/paper/paper-record";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
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
    reason: "LONG — MAJOR | leverage: 1x (spot) | closed: TAKE_PROFIT_HIT",
    dataSource: "kraken",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

const spotAvailability: ExchangeAvailabilityResult = {
  listedOnKraken: "YES",
  krakenSpotAvailable: "YES",
  krakenMarginAvailable: "UNKNOWN",
  krakenFuturesAvailable: "UNKNOWN",
  usLeverageAvailable: "UNKNOWN",
  availablePairs: ["SOL/USD"],
  bestExchange: "kraken",
  recommendedAction: "SPOT_ONLY",
  evidenceSource: "test",
  checkedAt: new Date().toISOString(),
  confidence: "high",
  availabilityNote: null,
};

describe("trade history table fields", () => {
  it("includes required paper trade history columns", () => {
    const row = buildTradeHistoryRow(mockTrade(), 1);
    expect(row.tradeNumber).toBe(1);
    expect(row.coin).toBe("BTC/USD");
    expect(row.exchange).toBe("kraken");
    expect(row.marketType).toBe("spot");
    expect(row.leverageUsed).toBe(1);
    expect(row.entryTime).not.toBeNull();
    expect(row.exitTime).not.toBeNull();
    expect(row.entryPrice).toBe(100);
    expect(row.exitPrice).toBe(101);
    expect(row.amountEntered).toBe(0.5);
    expect(row.capitalUsed).toBe(50);
    expect(row.netPnl).toBe(0.48);
    expect(row.entryReason).toContain("LONG");
    expect(row.exitReason).toBe("TAKE_PROFIT_HIT");
    expect(row.followedBotRules).toBe(true);
    expect(row.finalResult).toBe("WIN");
    expect(row.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});

describe("trade history summary stats", () => {
  it("computes win rate and net P&L", () => {
    const rows = [
      buildTradeHistoryRow(mockTrade(), 1),
      buildTradeHistoryRow(
        mockTrade({
          id: "t2",
          symbol: "ETH/USD",
          baseAsset: "ETH",
          netPaperPnl: { toNumber: () => -0.2 } as never,
          result: "LOSS",
          reason: "LONG | closed: STOP_LOSS_HIT",
        }),
        2,
      ),
    ];
    const summary = buildTradeHistorySummary(rows);
    expect(summary.totalTrades).toBe(2);
    expect(summary.profitableTrades).toBe(1);
    expect(summary.losingTrades).toBe(1);
    expect(summary.winRate).toBe(0.5);
    expect(summary.netProfitLoss).toBeCloseTo(0.28, 2);
    expect(summary.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });

  it("buildPaperTradeHistory wraps rows and summary", () => {
    const hist = buildPaperTradeHistory([mockTrade()]);
    expect(hist.rows.length).toBe(1);
    expect(hist.summary.totalTrades).toBe(1);
    expect(hist.warning).toContain("simulated");
  });
});

describe("final candidate output fields", () => {
  it("exposes PART 2 candidate fields", () => {
    const out = buildFinalCandidateOutput({
      name: "Solana",
      symbol: "SOL/USD",
      baseAsset: "SOL",
      currentPrice: 150,
      volume24hUsd: 50_000_000,
      marketCapUsd: 80e9,
      liquidityUsd: 50_000_000,
      change24hPct: 8,
      change7dPct: 12,
      availability: spotAvailability,
      enriched: { providerStatus: {} },
      action: "OPEN_TRADE",
      scoreBreakdown: emptyScoreBreakdown({ finalScore: 75, confidenceLevel: "HIGH", riskLevel: "LOW" }),
      riskTier: "MAJOR",
    });
    expect(out.name).toBe("Solana");
    expect(out.symbol).toBe("SOL/USD");
    expect(out.volume24hUsd).toBe(50_000_000);
    expect(out.change7dPct).toBe(12);
    expect(out.scores.momentum).toBeDefined();
    expect(out.availabilitySummary.krakenSpotAvailable).toBe("YES");
    expect(out.availabilitySummary.usAvailability).toBe("UNKNOWN");
    expect(out.recommendedTradeType).toBe("spot");
    expect(out.exitConditions.length).toBeGreaterThan(0);
    expect(out.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});

describe("scan pipeline transparency", () => {
  it("tracks filtered vs deep-evaluated counts", () => {
    const filtered = computeCoinsFilteredOut({
      coinsDiscovered: 300,
      passedBasicFilters: 75,
      removedByLiquidity: 50,
      removedByVolume: 100,
      removedByMarketCapRisk: 25,
      removedByExchangeAvailability: 30,
      removedByUsAvailability: 20,
    });
    expect(filtered).toBe(225);
    expect(EMPTY_PIPELINE.deepEvaluationLimitReason).toBe("");
  });
});

describe("trade selection quality rules", () => {
  it("does not force low-quality trades", () => {
    const result = evaluateTradeSelection({
      breakdown: emptyScoreBreakdown({ finalScore: 40, confidenceLevel: "LOW" }),
      availability: spotAvailability,
      riskTier: "MAJOR",
      spreadBps: 20,
      volume24hUsd: 5_000_000,
      change24hPct: 1,
      momentumPct: 0.01,
      hasExitPlan: true,
      entryPrice: 100,
    });
    expect(result.shouldOpen).toBe(false);
    expect(result.recommendation).toBe("WATCH");
  });
});

describe("dashboard current record view", () => {
  it("defaults dashboard view to current record", async () => {
    const { DEFAULT_DASHBOARD_VIEW } = await import("@/lib/trading/paper/evidence-service");
    expect(DEFAULT_DASHBOARD_VIEW).toBe("current_record");
  });

  it("builds record activity feed and bot health from runs", async () => {
    const {
      buildRecordActivityFeed,
      buildRecordBotHealthCheck,
    } = await import("@/lib/trading/paper/paper-record");
    const runs = [
      {
        startedAt: new Date("2026-07-04T20:00:00Z"),
        status: "COMPLETED",
        reasonCode: "NO_TRADE_BEST_DECISION",
        tradesOpened: 0,
        tradesUpdated: 3,
        tradesClosed: 0,
        scanSummary: { rejectionSummary: { SCORE_TOO_LOW: 12 } },
      },
    ];
    const feed = buildRecordActivityFeed(runs, 10);
    expect(feed.length).toBeGreaterThan(0);
    const health = buildRecordBotHealthCheck({
      latestRun: {
        startedAt: runs[0]!.startedAt,
        status: "COMPLETED",
        reasonCode: "NO_TRADE_BEST_DECISION",
        tradesUpdated: 3,
        candidatesStored: 120,
        coinsDiscovered: 259,
      },
      activityCounts: {
        runsCompletedInRecord: 1,
        tradesUpdatedInRecord: 3,
        candidatesScannedInRecord: 120,
        rejectionsInRecord: 12,
        newTradesOpenedInRecord: 0,
        carriedTradesMonitored: 3,
      },
    });
    expect(health.isWorking).toBe(true);
    expect(health.plainEnglishSummary).toContain("Bot is working");
    expect(health.plainEnglishSummary).toContain("259 coins");
  });

  it("fresh record shows zero record P&L", () => {
    const carried = mockTrade({
      id: "c1",
      status: "OPEN",
      result: "OPEN",
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 1 } as never,
      carriedBaselineUnrealizedPnl: { toNumber: () => 5 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-3",
        startingPaperBalance: { toNumber: () => 9871.862 } as never,
      } as import("@prisma/client").PaperRecord,
      recordTrades: [carried],
      markMap: new Map([["c1", 105]]),
    });
    expect(breakdown.recordPnl).toBe(0);
    expect(breakdown.newTradesOpened).toBe(0);
    expect(breakdown.carriedOpenTrades).toBe(1);
  });

  it("keeps live trading and Auto locked on dashboard safety checks", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });

  it("aggregates rejection categories for dashboard scanner display", async () => {
    const { summarizeRejectionCategories } = await import("@/lib/trading/paper/paper-labels");
    const categories = summarizeRejectionCategories({
      SCORE_TOO_LOW: 24,
      VOLUME_TOO_LOW: 68,
      NOT_TRADABLE_ON_EXCHANGE: 20,
      REJECTED_BAD_RISK_REWARD: 4,
      WATCH_ONLY_FAKE_PUMP_RISK: 2,
    });
    expect(categories.BAD_RISK_REWARD).toBe(4);
    expect(categories.FAKE_PUMP).toBe(2);
    expect(categories.SCORE_TOO_LOW).toBe(24);
  });

  it("new record carry baseline enables carry delta", () => {
    const carried = mockTrade({
      id: "c2",
      status: "OPEN",
      result: "OPEN",
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      carriedAt: new Date("2026-07-04T10:00:00Z"),
      carriedBaselineUnrealizedPnl: { toNumber: () => 5 } as never,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 1 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-4",
        startingPaperBalance: { toNumber: () => 9871.862 } as never,
      } as import("@prisma/client").PaperRecord,
      recordTrades: [carried],
      markMap: new Map([["c2", 108]]),
    });
    expect(breakdown.carriedPnlSinceCarry).toBeCloseTo(3, 4);
  });
});

describe("safety verification", () => {
  it("keeps live trading and Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(safety.realOrderEndpointsCalled).toBe(false);
    expect(safety.withdrawalKeysAccepted).toBe(false);
    expect(safety.tradingEnabledKeysBlocked).toBe(true);
    expect(safety.leveragePaperModeOnly).toBe(true);
    expect(safety.usLeverageDefaultUnknown).toBe(true);
    expect(safety.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });

  it("Auto remains locked", () => {
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });
});
