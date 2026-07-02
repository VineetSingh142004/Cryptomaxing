import { describe, expect, it } from "vitest";
import { assessEvidenceLevel, canPromoteOneStage } from "@/lib/trading/proof/evidence-level";
import { analyzeTodayAlphaBeta } from "@/lib/trading/proof/alpha-beta";
import { buildTodayMarketProof } from "@/lib/trading/proof/today-proof";
import { decideGoNoGo } from "@/lib/trading/proof/go-no-go";
import { buildProfitabilityScorecard } from "@/lib/trading/proof/scorecard";
import { recordBlockedTrade, summarizeMoneyProtected, updateBlockOutcome } from "@/lib/trading/proof/money-protected";
import { createShadowTrade, validateRealtimeSignal } from "@/lib/trading/shadow";
import { openPaperTrade, closePaperTrade, summarizePaperDay } from "@/lib/trading/paper";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";

describe("evidence levels", () => {
  it("rejects mocked artifacts at level 0", () => {
    const r = assessEvidenceLevel({
      entityType: "strategy",
      entityId: "test",
      backtestCompleted: true,
      artifacts: [{ dataSource: "mock", timeRange: null, assumptions: {}, costs: {}, sampleSize: 0, recordedAt: "", mocked: true }],
    });
    expect(r.level).toBe(0);
    expect(r.reasonCodes).toContain("MOCKED_DATA_REJECTED");
  });

  it("allows only one stage promotion", () => {
    expect(canPromoteOneStage(8, 9)).toBe(true);
    expect(canPromoteOneStage(8, 10)).toBe(false);
  });
});

describe("shadow trades", () => {
  it("rejects retroactive shadow signals", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    expect(validateRealtimeSignal(old)).toContain("RETROACTIVE_SHADOW_REJECTED");
  });

  it("creates shadow without fake P&L until closed", () => {
    const now = new Date().toISOString();
    const s = createShadowTrade({
      signalTimestamp: now,
      symbol: "BTC/USD",
      venue: "kraken",
      strategyId: "vwap-reclaim-momentum",
      marketRegime: "trend",
      direction: "long",
      entryPrice: 100,
      stopPrice: 98,
      targetPrices: [102],
      exitPlan: ["partial at 1R"],
      size: 1,
      feeModel: DEFAULT_FEE_MODEL,
      spreadBps: 5,
      entryReason: ["test"],
      stopReason: "structure",
      entryWouldFill: true,
      now,
    });
    expect(s.status).toBe("OPEN");
    expect(s.netPnlEstimate).toBeNull();
  });
});

describe("paper forward", () => {
  it("rejects non-same-day signals", () => {
    const trade = openPaperTrade({
      signalTimestamp: "2020-01-01T12:00:00.000Z",
      symbol: "BTC/USD",
      strategyId: "test",
      direction: "long",
      entryPrice: 100,
      size: 1,
      feeModel: DEFAULT_FEE_MODEL,
      spreadBps: 5,
      reportDate: "2026-07-02",
      rng: () => 1,
    });
    expect(trade.rejected).toBe(true);
  });

  it("applies costs on close", () => {
    const now = new Date().toISOString();
    const open = openPaperTrade({
      signalTimestamp: now,
      symbol: "BTC/USD",
      strategyId: "test",
      direction: "long",
      entryPrice: 100,
      size: 1,
      feeModel: DEFAULT_FEE_MODEL,
      spreadBps: 5,
      reportDate: now.slice(0, 10),
      rng: () => 1,
    });
    const closed = closePaperTrade({ trade: open, exitPrice: 101 });
    expect(closed.netPnl).not.toBeNull();
    if (closed.netPnl !== null) expect(closed.netPnl).toBeLessThan(closed.grossPnl ?? 999);
  });
});

describe("alpha vs beta", () => {
  it("flags beta when BTC explains profit", () => {
    const r = analyzeTodayAlphaBeta({
      reportDate: "2026-07-02",
      strategyNetPnl: 50,
      strategyGrossPnl: 60,
      notional: 10_000,
      tradeWindows: [],
      benchmarkReturns: { btc: { symbol: "BTC", returnPct: 2.5, windowStart: "", windowEnd: "" } },
      randomEntryNetPnl: 10,
      randomSameHoldNetPnl: 5,
      netPnlBeforeCosts: 55,
      netPnlAfterCosts: 50,
      totalCosts: 5,
    });
    expect(r.flags).toContain("BETA_NOT_ALPHA");
  });
});

describe("money protected", () => {
  it("counts correct blocks as money protected", () => {
    let r = recordBlockedTrade({
      symbol: "BTC/USD",
      strategyId: "test",
      blockReason: "FAKEOUT_HIGH",
      blockCategory: "FAKEOUT_HIGH",
      signalTimestamp: new Date().toISOString(),
      estimatedLossAvoided: 25,
    });
    r = updateBlockOutcome(r, "LOST");
    const s = summarizeMoneyProtected({ reportDate: "2026-07-02", records: [r] });
    expect(s.correctBlocks).toBe(1);
    expect(s.estimatedLossAvoided).toBe(25);
  });
});

describe("auto execution gate", () => {
  it("remains locked even at evidence level 10", () => {
    const r = evaluateAutoExecution({
      emergencyPaused: false,
      autoSelected: true,
      currentMode: "AUTO",
      evidenceLevel: 10,
      evidenceAutoAllowed: true,
      sameDayEvidencePresent: true,
      liveEvidencePresent: true,
    });
    expect(r.autoExecutionEnabled).toBe(false);
  });
});

describe("go no go", () => {
  it("never scales from one lucky trade", () => {
    const scorecard = buildProfitabilityScorecard({
      period: "2026-07-02",
      evidenceLevel: 8,
      dataQualityScore: 80,
      signalQualityScore: 70,
      executionQualityScore: 70,
      fillRealismScore: 70,
      sampleSize: 1,
      maxDrawdownPct: 0.5,
      liveReconciled: false,
      edgeDecayDetected: false,
      regimeBreadth: 2,
      alphaBeta: null,
      paperSummary: {
        reportDate: "2026-07-02",
        startingBalance: 10_000,
        endingBalance: 10_100,
        grossPnl: 100,
        netPnl: 100,
        feesPaid: 5,
        slippagePaid: 2,
        fundingPaid: 0,
        spreadCost: 1,
        tradeCount: 1,
        wins: 1,
        losses: 0,
        expectancy: 100,
        profitFactor: null,
        maxDrawdown: 0,
        largestLoss: 0,
        averageWin: 100,
        averageLoss: null,
        missedFills: 0,
        rejectedTrades: 0,
        noTradeDecisions: 0,
        moneyProtected: 0,
        generatedAt: new Date().toISOString(),
      },
      luckyTradeDominance: 0.9,
      costDragPct: 1,
    });

    const paperSummary = {
        reportDate: "2026-07-02",
        startingBalance: 10_000,
        endingBalance: 10_100,
        grossPnl: 100,
        netPnl: 100,
        feesPaid: 5,
        slippagePaid: 2,
        fundingPaid: 0,
        spreadCost: 1,
        tradeCount: 1,
        wins: 1,
        losses: 0,
        expectancy: 100,
        profitFactor: null,
        maxDrawdown: 0,
        largestLoss: 0,
        averageWin: 100,
        averageLoss: null,
        missedFills: 0,
        rejectedTrades: 0,
        noTradeDecisions: 0,
        moneyProtected: 0,
        generatedAt: new Date().toISOString(),
      };

    const todayProof = buildTodayMarketProof({
      reportDate: "2026-07-02",
      scannedAssets: [],
      approvedAssets: [],
      blockedAssets: [],
      marketRegime: "trend",
      bestSessions: [],
      worstSessions: [],
      aPlusSetupsFound: 0,
      bcSetupsRejected: 0,
      noTradeDecisions: 0,
      tradeCandidates: 1,
      shadowTrades: [],
      paperSummary,
      moneyProtected: summarizeMoneyProtected({ reportDate: "2026-07-02", records: [] }),
      alphaBeta: null,
    });

    const go = decideGoNoGo({
      reportDate: "2026-07-02",
      currentEvidenceLevel: 8,
      todayProof,
      alphaBeta: null,
      paperSummary,
      scorecard,
    });

    expect(go.reasonCodes).toContain("ONE_DAY_LUCKY_TRADE");
  });
});
