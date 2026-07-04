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
    });
    expect(result.shouldOpen).toBe(false);
    expect(result.recommendation).toBe("WATCH");
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
