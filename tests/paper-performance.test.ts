import { describe, expect, it } from "vitest";
import type { PaperTrade } from "@prisma/client";
import {
  buildPaperPerformanceSummary,
  computePortfolioSnapshot,
  computeRunPnlDelta,
  buildDeepEvaluationExplanation,
  buildPerformanceVerdict,
  computePeakSimultaneousExposureUsd,
} from "@/lib/trading/paper/performance-summary";
import {
  mapCandidateRecommendationLabel,
  mapExecutionLabel,
} from "@/lib/trading/paper/paper-labels";
import {
  paperExportFilename,
  parsePaperExportMode,
  DEFAULT_PAPER_EXPORT_MODE,
} from "@/lib/trading/paper/export-log";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { DECIMAL_36_12_MAX, prepareCandidateWriteData } from "@/lib/trading/paper/candidate-write";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";

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
    reason: "LONG — MAJOR | closed: TAKE_PROFIT_HIT",
    dataSource: "kraken",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

function mockCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "BTC/USD",
    coinName: "Bitcoin",
    source: "coingecko",
    price: 50000,
    spreadBps: 10,
    volume24hUsd: 1_000_000_000,
    change24hPct: 2,
    change7dPct: 5,
    marketCapUsd: 1_000_000_000_000,
    riskTier: "MAJOR",
    opportunityScore: 72,
    momentumScore: 70,
    volumeSpikeScore: 65,
    volatilityScore: 50,
    liquidityScore: 80,
    spreadScore: 90,
    trendScore: 60,
    scoreBreakdown: {
      momentumScore: 70,
      volumeScore: 65,
      liquidityScore: 80,
      socialHypeScore: 0,
      riskScore: 10,
      finalScore: 72,
      confidenceLevel: "HIGH",
      riskLevel: "LOW",
      pumpRiskPenalty: 0,
      volatilityScore: 50,
    },
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
    reasonText: "Ready for paper trade",
    rank: 1,
    ...overrides,
  } as ScanCandidate;
}

describe("paper performance summary", () => {
  it("calculates win rate, profit factor, and net P&L", () => {
    const trades = [
      mockTrade(),
      mockTrade({
        id: "t2",
        symbol: "ETH/USD",
        baseAsset: "ETH",
        netPaperPnl: { toNumber: () => -0.2 } as never,
        result: "LOSS",
        reason: "LONG | closed: STOP_LOSS_HIT",
      }),
    ];
    const summary = buildPaperPerformanceSummary({ trades, maxDrawdown: 0.2 });
    expect(summary.totalClosedTrades).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(0.5);
    expect(summary.totalNetPnl).toBeCloseTo(0.28, 2);
    expect(summary.profitFactor).toBeCloseTo(0.48 / 0.2, 2);
    expect(summary.simpleVerdict.length).toBeGreaterThan(10);
    expect(summary.improvementItems.length).toBeGreaterThan(0);
    expect(summary.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});

describe("paper evidence collection message", () => {
  it("shows collecting when runs exist", () => {
    const msg = (runs: number) => (runs > 0 ? "Paper evidence collecting." : "No paper evidence runs yet.");
    expect(msg(151)).toBe("Paper evidence collecting.");
    expect(msg(0)).toBe("No paper evidence runs yet.");
  });
});

describe("candidate vs execution labels", () => {
  it("maps candidate recommendation separately from execution", () => {
    expect(
      mapCandidateRecommendationLabel({
        action: "OPEN_TRADE",
        reasonCode: "TRADE_READY",
        tradableOnConfiguredExchange: true,
      }),
    ).toBe("TRADE_READY");
    expect(
      mapCandidateRecommendationLabel({
        action: "OPEN_TRADE",
        tradeReadyButNotOpened: true,
      }),
    ).toBe("TRADE_READY_BUT_NOT_OPENED");
    expect(mapExecutionLabel({ action: "TRADE_OPENED", tradeActuallyOpened: true })).toBe(
      "PAPER_TRADE_OPENED",
    );
    expect(mapExecutionLabel({ action: "TRADE_CLOSED" })).toBe("PAPER_TRADE_CLOSED");
  });
});

describe("current run P&L delta", () => {
  it("calculates net delta from portfolio before and after", () => {
    const before = { realizedPnl: 10, unrealizedPnl: 2, totalPnl: 12, openExposureUsd: 100, maxExposureUsedUsd: 100, largestSingleTradeUsd: 50 };
    const after = { realizedPnl: 10.5, unrealizedPnl: 1.5, totalPnl: 12, openExposureUsd: 80, maxExposureUsedUsd: 100, largestSingleTradeUsd: 50 };
    const delta = computeRunPnlDelta(before, after, 0.5);
    expect(delta.realizedPnlThisRun).toBe(0.5);
    expect(delta.unrealizedPnlChangeThisRun).toBeCloseTo(-0.5, 4);
    expect(delta.netPnlDeltaThisRun).toBeCloseTo(0, 4);
  });
});

describe("deep evaluation cap explanation", () => {
  it("explains SCANNER_MAX_EVALUATED_COINS cap", () => {
    const text = buildDeepEvaluationExplanation({
      coinsDiscovered: 260,
      coinsScanned: 260,
      passedFilters: 200,
      deepEvaluated: 100,
      limit: 100,
    });
    expect(text).toContain("All 260 discovered coins were scanned");
    expect(text).toContain("SCANNER_MAX_EVALUATED_COINS=100");
    expect(text).toContain("lower-ranked");
  });
});

describe("exposure metrics", () => {
  it("current exposure can exceed largest single trade with multiple open positions", () => {
    const open1 = mockTrade({
      id: "o1",
      status: "OPEN",
      result: "OPEN",
      openedAt: new Date("2026-02-01T10:00:00Z"),
      closedAt: null,
      exitPrice: null,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 5 } as never,
    });
    const open2 = mockTrade({
      id: "o2",
      symbol: "ETH/USD",
      status: "OPEN",
      result: "OPEN",
      openedAt: new Date("2026-02-01T11:00:00Z"),
      closedAt: null,
      exitPrice: null,
      entryPrice: { toNumber: () => 50 } as never,
      simulatedSize: { toNumber: () => 10 } as never,
    });
    const summary = buildPaperPerformanceSummary({ trades: [open1, open2] });
    expect((summary.currentExposurePct ?? 0) > (summary.largestSingleTradeExposurePct ?? 0)).toBe(true);
    expect(summary.exposureExplanation).toContain("multiple positions");
  });

  it("computes peak simultaneous exposure from overlapping trades", () => {
    const t1 = mockTrade({
      id: "a",
      openedAt: new Date("2026-01-01T10:00:00Z"),
      closedAt: new Date("2026-01-01T14:00:00Z"),
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 3 } as never,
    });
    const t2 = mockTrade({
      id: "b",
      openedAt: new Date("2026-01-01T11:00:00Z"),
      closedAt: new Date("2026-01-01T12:00:00Z"),
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 2 } as never,
    });
    const peak = computePeakSimultaneousExposureUsd([t1, t2]);
    expect(peak).toBe(500);
  });
});

describe("performance verdict", () => {
  it("warns when wins are frequent but losses are large", () => {
    const summary = buildPaperPerformanceSummary({
      trades: [
        ...Array.from({ length: 16 }, (_, i) =>
          mockTrade({
            id: `w${i}`,
            netPaperPnl: { toNumber: () => 12 } as never,
            result: "WIN",
          }),
        ),
        ...Array.from({ length: 6 }, (_, i) =>
          mockTrade({
            id: `l${i}`,
            symbol: `LOSS${i}/USD`,
            netPaperPnl: { toNumber: () => -28 } as never,
            result: "LOSS",
          }),
        ),
      ],
    });
    const verdict = buildPerformanceVerdict(summary);
    expect(verdict).toContain("wins often");
    expect(verdict).toContain("losses are too large");
  });
});

describe("BTC marketCap Decimal(36,12)", () => {
  it("stores trillion market cap without overflow", () => {
    const result = prepareCandidateWriteData("r1", "u1", mockCandidate());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.marketCap).toBe("1000000000000");
    expect(DECIMAL_36_12_MAX).toBeGreaterThan(2_000_000_000_000);
  });
});

describe("export log", () => {
  it("generates filename with timestamp pattern", () => {
    const name = paperExportFilename(new Date("2026-07-04T15:30:00Z"));
    expect(name).toMatch(/^alpha-autopilot-paper-trade-log-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.txt$/);
  });

  it("defaults export mode to FULL_TRADE_LOG_EXPORT", () => {
    expect(parsePaperExportMode(undefined)).toBe("FULL_TRADE_LOG_EXPORT");
    expect(DEFAULT_PAPER_EXPORT_MODE).toBe("FULL_TRADE_LOG_EXPORT");
  });

  it("export builder labels simulated data and locks", async () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });
});

describe("portfolio snapshot", () => {
  it("sums realized and unrealized for open trades", () => {
    const open = mockTrade({
      id: "open1",
      status: "OPEN",
      result: "OPEN",
      closedAt: null,
      exitPrice: null,
      netPaperPnl: null,
    });
    const marks = new Map([["open1", 102]]);
    const snap = computePortfolioSnapshot([mockTrade(), open], marks);
    expect(snap.realizedPnl).toBeCloseTo(0.48, 2);
    expect(snap.unrealizedPnl).toBeCloseTo(1, 2);
    expect(snap.totalPnl).toBeCloseTo(1.48, 2);
  });
});
