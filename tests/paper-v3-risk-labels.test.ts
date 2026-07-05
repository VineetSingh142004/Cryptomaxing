import { describe, expect, it } from "vitest";
import type { PaperTrade } from "@prisma/client";
import { buildTradeLossAuditReport } from "@/lib/trading/paper/loss-analysis";
import {
  evaluateRecordCautionMode,
  type RecordCautionModeState,
} from "@/lib/trading/paper/profit-protection";
import { buildPaperPerformanceSummary } from "@/lib/trading/paper/performance-summary";
import {
  mapCandidateRunDisplayLabel,
} from "@/lib/trading/paper/paper-labels";
import {
  evaluateTradeSelection,
  formatScoreTooLowMessage,
  minScoreForTier,
} from "@/lib/trading/paper/trade-selection";
import {
  buildThesisCandleDataStatus,
  evaluateOpenTradeThesisReview,
} from "@/lib/trading/paper/thesis-invalidation";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";

function bchLossTrade(): PaperTrade {
  return {
    id: "cmr6xh80m0232cexsuqq443vf",
    userId: "u1",
    signalId: null,
    symbol: "BCH/USD",
    baseAsset: "BCH",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    status: "CLOSED",
    result: "LOSS",
    reason:
      "controlled-active-paper-v1: LONG — MAJOR, score 62, R:R 1.50, alloc: 31.88%, spread: 4.2 bps | closed: STOP_LOSS_HIT",
    entryPrice: 235.35,
    exitPrice: 233.18703936,
    simulatedSize: 13.543658381134,
    netPaperPnl: -52.7793,
    grossPaperPnl: -30.89,
    estimatedFees: -16.5,
    estimatedSlippage: -5.39,
    riskAmount: 25.5,
    riskPercent: 0.258,
    confidence: 0.75,
    plannedStopLoss: 233.4672,
    plannedTakeProfit: 238.1742,
    isRealTrade: false,
    openedAt: new Date("2026-07-04T22:22:25.392Z"),
    closedAt: new Date("2026-07-04T23:16:00.680Z"),
  } as PaperTrade;
}

describe("BCH V3 loss audit report", () => {
  it("includes all required audit fields", () => {
    const report = buildTradeLossAuditReport(bchLossTrade());
    expect(report.symbol).toBe("BCH/USD");
    expect(report.entryTime).toBeTruthy();
    expect(report.exitTime).toBeTruthy();
    expect(report.entryPrice).toBeCloseTo(235.35, 2);
    expect(report.exitPrice).toBeCloseTo(233.187, 2);
    expect(report.quantity).toBeCloseTo(13.54, 1);
    expect(report.allocationPct).toBeCloseTo(31.88, 1);
    expect(report.riskTier).toBe("MAJOR");
    expect(report.entryScore).toBe(62);
    expect(report.confidence).toBe(0.75);
    expect(report.rewardRiskRatio).toBe(1.5);
    expect(report.stopLossDistancePct).not.toBeNull();
    expect(report.takeProfitDistancePct).not.toBeNull();
    expect(report.spreadBps).toBeCloseTo(4.2, 1);
    expect(report.thesisStatusAtEntry).toContain("MAJOR");
    expect(report.whyAllowed).toBeTruthy();
    expect(report.ruleAllowed).toBeTruthy();
    expect(report.lossBreakdown.netPnl).toBeCloseTo(-52.7793, 2);
    expect(report.riskSizingTooLarge).toBe(true);
    expect(report.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});

describe("record caution mode", () => {
  it("activates CAUTION_MODE after first large loss in fresh record", () => {
    const trade = bchLossTrade();
    const summary = buildPaperPerformanceSummary({
      trades: [trade],
      latestMarkByTradeId: new Map(),
      maxDrawdown: null,
    });
    const caution = evaluateRecordCautionMode(summary, 9871.862);
    expect(caution.active).toBe(true);
    expect(caution.mode).toBe("CAUTION_MODE");
    expect(caution.dashboardLabel).toBe("CAUTION_MODE");
    expect(caution.dashboardMessage).toContain("Caution mode active");
    expect(caution.allocationMultiplier).toBeLessThan(1);
  });

  it("does not show LOW when profit factor is 0 with losses", () => {
    const summary = buildPaperPerformanceSummary({
      trades: [bchLossTrade()],
      latestMarkByTradeId: new Map(),
      maxDrawdown: null,
    });
    expect(summary.profitFactor).toBe(0);
    const caution: RecordCautionModeState = evaluateRecordCautionMode(summary, 9871.862);
    expect(caution.dashboardLabel).not.toBe("LOW");
    expect(["CAUTION_MODE", "RISK_MODE_ACTIVE"]).toContain(caution.dashboardLabel);
  });
});

describe("candidate run display labels", () => {
  it("shows PAPER_TRADE_OPENED only when trade actually opened this run", () => {
    expect(
      mapCandidateRunDisplayLabel({
        action: "OPEN_TRADE",
        reasonCode: "TRADE_READY",
        tradesOpenedThisRun: 1,
        openedThisRun: true,
      }),
    ).toBe("PAPER_TRADE_OPENED");

    expect(
      mapCandidateRunDisplayLabel({
        action: "OPEN_TRADE",
        reasonCode: "TRADE_READY",
        tradesOpenedThisRun: 0,
      }),
    ).toBe("QUALIFIED_BUT_NOT_OPENED");
  });

  it("TRADE_READY does not imply a trade opened when none opened this run", () => {
    const label = mapCandidateRunDisplayLabel({
      action: "OPEN_PAPER_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_READY",
      tradesOpenedThisRun: 0,
    });
    expect(label).not.toBe("PAPER_TRADE_OPENED");
    expect(label).toBe("QUALIFIED_BUT_NOT_OPENED");
  });
});

describe("SCORE_TOO_LOW threshold context", () => {
  it("includes required threshold in message", () => {
    const required = minScoreForTier("EXTREME_RISK");
    expect(formatScoreTooLowMessage(70, "EXTREME_RISK")).toBe(
      `Score 70 below required ${required} for EXTREME_RISK.`,
    );
  });

  it("evaluateTradeSelection uses threshold message for SCORE_TOO_LOW", () => {
    const result = evaluateTradeSelection({
      breakdown: emptyScoreBreakdown({ finalScore: 70, confidenceLevel: "MEDIUM" }),
      availability: {
        listedOnKraken: "YES",
        krakenSpotAvailable: "YES",
        krakenMarginAvailable: "UNKNOWN",
        krakenFuturesAvailable: "UNKNOWN",
        usLeverageAvailable: "UNKNOWN",
        availablePairs: ["X/USD"],
        bestExchange: "kraken",
        recommendedAction: "SPOT_ONLY",
        evidenceSource: "test",
        checkedAt: new Date().toISOString(),
        confidence: "high",
        availabilityNote: null,
      },
      riskTier: "EXTREME_RISK",
      spreadBps: 10,
      volume24hUsd: 10_000_000,
      change24hPct: 5,
      momentumPct: 1,
      hasExitPlan: true,
      entryPrice: 100,
      tradableOnConfiguredExchange: true,
    });
    expect(result.reasonCode).toBe("SCORE_TOO_LOW");
    expect(result.reasonText).toContain("below required");
    expect(result.reasonText).toContain("EXTREME_RISK");
  });
});

describe("thesis validation candle data visibility", () => {
  it("shows candle status when market data is missing", () => {
    const snapshot = {
      symbol: "BTC/USD",
      ticker: { last: 100, bid: 99.9, ask: 100.1, spreadBps: 10 },
      candles5m: [],
      relativeVolume: 1,
    } as NormalizedMarketSnapshot;

    const status = buildThesisCandleDataStatus({
      snapshot,
      hasMarketData: false,
      dataSource: "kraken",
    });
    expect(status.available).toBe(false);
    expect(status.candleCount).toBe(0);
    expect(status.timeframe).toBe("5m");
    expect(status.missingReason).toBeTruthy();

    const review = evaluateOpenTradeThesisReview({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99,
      snapshot,
      hasMarketData: false,
      dataSource: "kraken",
    });
    expect(review.recommendation).toBe("NEEDS_MORE_DATA");
    expect(review.candleData?.available).toBe(false);
    expect(review.candleData?.provider).toBe("kraken");
  });
});

describe("safety locks unchanged", () => {
  it("keeps all P&L simulated and live/Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
    expect(buildTradeLossAuditReport(bchLossTrade()).simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});
