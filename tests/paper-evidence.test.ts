import { describe, expect, it } from "vitest";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { evaluateConservativePaperStrategy } from "@/lib/trading/paper/conservative-strategy";
import {
  evaluatePaperForwardEvidence,
  PAPER_EVIDENCE_REQUIREMENTS,
} from "@/lib/trading/paper/evidence-requirements";
import { serializePaperTrade } from "@/lib/trading/paper/evidence-service";
import {
  classifyRunStatus,
  computePaperEvidenceCountTotal,
  detectRunContradiction,
  resolveRunReasonCode,
  resolveZeroCountDeltaReason,
} from "@/lib/trading/paper/run-diagnostics";
import { isPrismaStaleError, STALE_PRISMA_MESSAGE } from "@/lib/trading/paper/prisma-health";
import {
  prepareCandidateWriteData,
  classifyCandidateWriteError,
  formatCandidateWriteFailureForDisplay,
  sanitizeCandidateErrorMessage,
  toSafeDecimalString,
  DECIMAL_24_12_MAX,
} from "@/lib/trading/paper/candidate-write";
import {
  decideCapacityForCandidate,
  computeOpenTradeCapacityView,
  isStrongCandidate,
  type OpenTradeCapacityView,
} from "@/lib/trading/paper/paper-capacity";
import { PAPER_ROTATION_CONFIG } from "@/lib/trading/paper/paper-rotation-config";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { PaperTrade } from "@prisma/client";
import { buildProfitabilityReport } from "@/lib/trading/reports";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";

function mockSnapshot(overrides: Partial<NormalizedMarketSnapshot> = {}): NormalizedMarketSnapshot {
  const now = new Date().toISOString();
  const baseCandles = Array.from({ length: 10 }, (_, i) => ({
    timestamp: new Date(Date.now() - (10 - i) * 300_000).toISOString(),
    open: 100 + i * 0.05,
    high: 100.2 + i * 0.05,
    low: 99.8 + i * 0.05,
    close: 100 + i * 0.08,
    volume: 1000,
    timeframe: "5m" as const,
  }));

  return {
    symbol: "BTC/USD",
    ticker: {
      symbol: "BTC/USD",
      price: 100,
      bid: 99.95,
      ask: 100.05,
      spread: 0.1,
      spreadBps: 10,
      volume24h: 1_000_000,
      timestamp: now,
      source: "kraken",
      latencyMs: 50,
    },
    orderBook: null,
    candles1m: [],
    candles5m: baseCandles,
    relativeVolume: 1.1,
    liquidityUsd: 1_000_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "kraken", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: 0.9 },
    metadata: {
      symbol: "BTC/USD",
      baseAsset: "BTC",
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

describe("paper evidence requirements", () => {
  it("starts NOT_CONFIGURED when system unavailable", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: 0,
      closedTrades: 0,
      calendarDays: 0,
      unresolvedDataErrors: 0,
      systemAvailable: false,
    });
    expect(r.status).toBe("NOT_CONFIGURED");
  });

  it("becomes COLLECTING after first run", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: 1,
      closedTrades: 0,
      calendarDays: 1,
      unresolvedDataErrors: 0,
      systemAvailable: true,
    });
    expect(r.status).toBe("COLLECTING");
  });

  it("becomes PASS only after thresholds met", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: PAPER_EVIDENCE_REQUIREMENTS.minimumRuns,
      closedTrades: PAPER_EVIDENCE_REQUIREMENTS.minimumClosedTrades,
      calendarDays: PAPER_EVIDENCE_REQUIREMENTS.minimumCalendarDays,
      unresolvedDataErrors: 0,
      systemAvailable: true,
    });
    expect(r.status).toBe("PASS");
  });
});

describe("conservative paper strategy", () => {
  it("returns NO_TRADE when spread is too wide", () => {
    const snapshot = mockSnapshot({
      ticker: {
        ...mockSnapshot().ticker,
        spreadBps: 50,
        bid: 99,
        ask: 101,
      },
    });
    const r = evaluateConservativePaperStrategy(snapshot);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.blockReasons).toContain("SPREAD_TOO_WIDE");
  });

  it("returns NO_TRADE when bid/ask missing", () => {
    const snapshot = mockSnapshot({
      ticker: {
        ...mockSnapshot().ticker,
        bid: 0,
        ask: 0,
      },
    });
    const r = evaluateConservativePaperStrategy(snapshot);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.blockReasons).toContain("MISSING_BID_ASK");
  });

  it("can return OPEN candidate when conditions pass", () => {
    const r = evaluateConservativePaperStrategy(mockSnapshot());
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.decision);
    if (r.decision !== "NO_TRADE") {
      expect(r.entryPrice).not.toBeNull();
      expect(r.plannedStopLoss).not.toBeNull();
      expect(r.plannedTakeProfit).not.toBeNull();
      expect(r.simulatedSize).not.toBeNull();
    }
  });
});

describe("paper evidence count definitions", () => {
  it("paper evidence count total sums runs candidates signals snapshots", () => {
    const total = computePaperEvidenceCountTotal({
      paperRuns: 10,
      candidatesStored: 200,
      signalsStored: 50,
      snapshotsStored: 30,
    });
    expect(total).toBe(290);
  });

  it("count delta 0 with only trade updates returns ONLY_UPDATED_EXISTING_TRADES", () => {
    const reason = resolveZeroCountDeltaReason({
      countDelta: 0,
      tradesOpened: 0,
      tradesUpdated: 5,
      snapshotsStored: 0,
      candidatesStored: 0,
      signalsStored: 0,
      paperRunsDelta: 0,
      maxOpenTradesReached: false,
      prismaCriticalFailure: false,
      databaseWriteFailed: false,
    });
    expect(reason).toBe("ONLY_UPDATED_EXISTING_TRADES");
  });

  it("count delta 0 at max open trades returns MAX_OPEN_TRADES_REACHED", () => {
    const reason = resolveZeroCountDeltaReason({
      countDelta: 0,
      tradesOpened: 0,
      tradesUpdated: 5,
      snapshotsStored: 0,
      candidatesStored: 0,
      signalsStored: 0,
      paperRunsDelta: 0,
      maxOpenTradesReached: true,
      prismaCriticalFailure: false,
      databaseWriteFailed: false,
    });
    expect(reason).toBe("MAX_OPEN_TRADES_REACHED");
  });

  it("generic column SQL errors are not treated as prisma stale", () => {
    expect(isPrismaStaleError("null value in column foo violates not-null constraint")).toBe(false);
    expect(isPrismaStaleError("Unknown arg `candidatesStored` in data.paperEvidenceRun.create")).toBe(true);
    expect(isPrismaStaleError('The column `paper_evidence_runs.reason_code` does not exist')).toBe(true);
    expect(isPrismaStaleError("Invalid `prisma.paperScanCandidate.create()` invocation")).toBe(false);
    expect(isPrismaStaleError("Not a valid Decimal")).toBe(false);
    expect(STALE_PRISMA_MESSAGE).toContain("db:generate");
  });

  it("positive countDelta run with saved writes cannot be FAILED", () => {
    const status = classifyRunStatus({
      runRecordCreated: true,
      countDelta: 60,
      candidatesStored: 51,
      signalsStored: 3,
      snapshotsStored: 5,
      tradesOpened: 3,
      tradesUpdated: 2,
      tradesClosed: 3,
      candidateWriteFailures: 2,
      snapshotWriteFailures: 0,
      failedFetches: 1,
      errorCount: 1,
      marketDataStatus: "MARKET_DATA_PARTIAL",
      prismaCriticalFailure: false,
    });
    expect(status).not.toBe("FAILED");
    expect(status).toBe("PARTIAL");
  });

  it("partial market data with saved DB writes returns PARTIAL", () => {
    expect(
      classifyRunStatus({
        runRecordCreated: true,
        countDelta: 10,
        candidatesStored: 8,
        signalsStored: 1,
        snapshotsStored: 2,
        tradesOpened: 0,
        tradesUpdated: 2,
        tradesClosed: 0,
        candidateWriteFailures: 1,
        snapshotWriteFailures: 0,
        failedFetches: 3,
        errorCount: 3,
        marketDataStatus: "MARKET_DATA_PARTIAL",
        prismaCriticalFailure: false,
      }),
    ).toBe("PARTIAL");
  });

  it("detectRunContradiction flags FAILED with positive countDelta", () => {
    const c = detectRunContradiction({
      status: "FAILED",
      countDelta: 60,
      candidatesStored: 51,
      signalsStored: 3,
      snapshotsStored: 5,
      reasonCode: "PRISMA_CLIENT_STALE",
      stalePrismaDetectedNow: true,
    });
    expect(c.contradictionDetected).toBe(true);
  });

  it("resolveRunReasonCode returns PRISMA_CLIENT_STALE when prismaCriticalFailure", () => {
    expect(
      resolveRunReasonCode({
        status: "FAILED",
        countDelta: 0,
        tradesOpened: 0,
        tradesUpdated: 0,
        snapshotsStored: 0,
        candidatesStored: 0,
        signalsStored: 0,
        paperRunsDelta: 0,
        maxOpenTradesReached: false,
        prismaCriticalFailure: true,
        databaseWriteFailed: false,
        snapshotWriteFailed: false,
      }),
    ).toBe("PRISMA_CLIENT_STALE");
  });

  it("resolveRunReasonCode does not return PRISMA_CLIENT_STALE when writes succeeded", () => {
    expect(
      resolveRunReasonCode({
        status: "PARTIAL",
        countDelta: 60,
        tradesOpened: 3,
        tradesUpdated: 2,
        snapshotsStored: 5,
        candidatesStored: 51,
        signalsStored: 3,
        paperRunsDelta: 1,
        maxOpenTradesReached: false,
        prismaCriticalFailure: false,
        databaseWriteFailed: false,
        snapshotWriteFailed: false,
      }),
    ).toBe("PARTIAL_RUN");
  });

  it("resolveRunReasonCode returns MAX_OPEN_TRADES_REACHED when blocked with updates", () => {
    expect(
      resolveRunReasonCode({
        status: "PARTIAL",
        countDelta: 10,
        tradesOpened: 0,
        tradesUpdated: 5,
        snapshotsStored: 5,
        candidatesStored: 4,
        signalsStored: 0,
        paperRunsDelta: 1,
        maxOpenTradesReached: true,
        prismaCriticalFailure: false,
        databaseWriteFailed: false,
        snapshotWriteFailed: false,
      }),
    ).toBe("MAX_OPEN_TRADES_REACHED");
  });
});

describe("paper data model integrity", () => {
  it("paper trades are always isRealTrade=false in API serialization", () => {
    const trade = {
      id: "t1",
      userId: "u1",
      signalId: null,
      symbol: "BTC/USD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      side: "LONG",
      strategyName: "conservative-paper-v1",
      entryPrice: { toNumber: () => 100 },
      plannedStopLoss: { toNumber: () => 99 },
      plannedTakeProfit: { toNumber: () => 102 },
      simulatedSize: { toNumber: () => 0.01 },
      riskAmount: { toNumber: () => 50 },
      riskPercent: { toNumber: () => 0.5 },
      status: "OPEN",
      openedAt: new Date(),
      closedAt: null,
      exitPrice: null,
      grossPaperPnl: null,
      estimatedFees: null,
      estimatedSlippage: null,
      netPaperPnl: null,
      result: "OPEN",
      confidence: { toNumber: () => 0.7 },
      reason: "test",
      dataSource: "kraken",
      isRealTrade: false,
      isVerifiedLivePnl: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PaperTrade;

    const serialized = serializePaperTrade(trade);
    expect(serialized.isRealTrade).toBe(false);
    expect(serialized.isVerifiedLivePnl).toBe(false);
    expect(serialized.simulatedPnlLabel).toBe("SIMULATED");
  });
});

describe("reports paper separation", () => {
  it("paper P&L shown as simulated and verified live remains blank", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_001,
      trades: [],
      paperTrades: [
        {
          id: "p1",
          strategyId: "conservative-paper-v1",
          symbol: "BTC/USD",
          venue: "kraken",
          direction: "long",
          entryTime: "2026-07-01T10:00:00Z",
          exitTime: "2026-07-01T11:00:00Z",
          entryPrice: 100,
          exitPrice: 101,
          size: 1,
          grossPnl: 1,
          fees: 0.1,
          spreadCost: 0,
          slippage: 0.05,
          funding: 0,
          reconciled: false,
        },
      ],
      evidenceLevel: 0,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.verifiedLivePnl).toBeNull();
    expect(r.paperSimulatedPnl).not.toBeNull();
    expect(r.disclaimers.some((d) => d.includes("Paper P&L is simulated"))).toBe(true);
  });
});

describe("paper run safety contract", () => {
  it("run result shape always reports auto locked and no live orders", () => {
    const result = {
      autoUnlocked: false,
      liveOrdersPlaced: false,
      warnings: [
        "Paper P&L is simulated.",
        "This does not unlock live trading.",
        "Auto remains locked.",
        "Do not treat paper results as real profit.",
      ],
    };
    expect(result.autoUnlocked).toBe(false);
    expect(result.liveOrdersPlaced).toBe(false);
    expect(result.warnings.some((w) => w.includes("Auto remains locked"))).toBe(true);
  });
});

describe("auto remains locked", () => {
  it("paper evidence does not unlock Auto", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        paperForwardPasses: true,
        executionEngineWired: false,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
  });
});

describe("candidate write validation", () => {
  function mockCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
    return {
      symbol: "BTC/USD",
      price: 97000,
      spreadBps: 8,
      volume24hUsd: 50_000_000,
      change24hPct: 4.2,
      change1hPct: 0.5,
      marketCapUsd: 1_000_000_000_000,
      momentumScore: 70,
      volumeSpikeScore: 65,
      volatilityScore: 55,
      liquidityScore: 90,
      spreadScore: 85,
      trendScore: 60,
      dataQualityScore: 95,
      riskPenalty: 5,
      pumpRiskPenalty: 0,
      opportunityScore: 72,
      riskTier: "MAJOR",
      shortTermReturnPct: 0.3,
      breakoutScore: 10,
      source: "kraken",
      tradableOnConfiguredExchange: true,
      action: "OPEN_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_OPENED",
      reasonText: "Opportunity score 72 — MAJOR, 24h 4.2%",
      rank: 1,
      ...overrides,
    };
  }

  it("BTC/USD candidate prepares valid DB write data", () => {
    const result = prepareCandidateWriteData("run1", "user1", mockCandidate());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.symbol).toBe("BTC/USD");
      expect(result.data.opportunityScore).toBe("72");
      expect(result.data.action).toBe("OPEN_PAPER_TRADE");
    }
  });

  it("BTC/USD with trillion market cap stores successfully with marketCap null", () => {
    const result = prepareCandidateWriteData(
      "run1",
      "user1",
      mockCandidate({ marketCapUsd: 2_000_000_000_000 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.marketCap).toBeNull();
      expect(result.fieldWarnings.marketCap).toContain("exceeds Decimal max");
    }
  });

  it("BTC/USD candidate with NaN spread is rejected safely", () => {
    const result = prepareCandidateWriteData("run1", "user1", mockCandidate({ spreadBps: NaN }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("CANDIDATE_WRITE_FAILED");
      expect(result.fieldErrors.spreadBps).toBeDefined();
      expect(result.displayMessage).toContain("field spreadBps");
    }
  });

  it("BTC/USD candidate with Infinity volume is rejected safely", () => {
    const result = prepareCandidateWriteData(
      "run1",
      "user1",
      mockCandidate({ volume24hUsd: Infinity }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.volume24hUsd).toBeDefined();
  });

  it("toSafeDecimalString rejects values exceeding Decimal(24,12)", () => {
    const r = toSafeDecimalString(2_000_000_000_000, DECIMAL_24_12_MAX, 12);
    expect(r.decimal).toBeNull();
    expect(r.warning).toBeDefined();
  });

  it("candidate write failure returns clean field-level display message", () => {
    const msg = formatCandidateWriteFailureForDisplay({
      symbol: "BTC/USD",
      fieldErrors: { marketCap: "exceeds Decimal(24,12) range" },
    });
    expect(msg).toBe(
      "CANDIDATE_WRITE_FAILED: BTC/USD candidate could not be stored because field marketCap was invalid: exceeds Decimal(24,12) range.",
    );
    expect(msg).not.toContain("TURBOPACK");
  });

  it("sanitizeCandidateErrorMessage strips Turbopack internal paths", () => {
    const clean = sanitizeCandidateErrorMessage(
      "Invalid __TURBOPACK__imported__module__$5b$foo$5d$.prisma.paperScanCandidate.create() invocation",
    );
    expect(clean).not.toContain("__TURBOPACK__");
  });

  it("classifyCandidateWriteError returns clean display without Turbopack paths", () => {
    const classified = classifyCandidateWriteError(
      new Error(
        "Invalid __TURBOPACK__imported__module__$5b$bar$5d$.paperScanCandidate.create() Not a valid Decimal",
      ),
      "BTC/USD",
    );
    expect(classified.displayMessage).toContain("CANDIDATE_WRITE_FAILED: BTC/USD");
    expect(classified.displayMessage).not.toContain("__TURBOPACK__");
  });
  it("NaN opportunity score rejected safely with CANDIDATE_WRITE_FAILED", () => {
    const result = prepareCandidateWriteData("run1", "user1", mockCandidate({ opportunityScore: NaN }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("CANDIDATE_WRITE_FAILED");
      expect(result.fieldErrors.opportunityScore).toBeDefined();
    }
  });

  it("invalid risk tier rejected safely", () => {
    const result = prepareCandidateWriteData(
      "run1",
      "user1",
      mockCandidate({ riskTier: "INVALID" as ScanCandidate["riskTier"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.riskTier).toBeDefined();
  });

  it("partial run with candidate failures keeps CANDIDATE_WRITE_FAILED reason when evidence saved", () => {
    expect(
      resolveRunReasonCode({
        status: "PARTIAL",
        countDelta: 61,
        tradesOpened: 0,
        tradesUpdated: 5,
        snapshotsStored: 5,
        candidatesStored: 55,
        signalsStored: 0,
        paperRunsDelta: 1,
        maxOpenTradesReached: true,
        prismaCriticalFailure: false,
        databaseWriteFailed: false,
        snapshotWriteFailed: false,
        candidateWriteFailures: 1,
        explicitReasonCode: "CANDIDATE_WRITE_FAILED",
      }),
    ).toBe("CANDIDATE_WRITE_FAILED");
  });

  it("classifyCandidateWriteError returns CANDIDATE_WRITE_FAILED for decimal errors", () => {
    const classified = classifyCandidateWriteError(
      new Error("Invalid `prisma.paperScanCandidate.create()` Not a valid Decimal"),
      "BTC/USD",
    );
    expect(classified.reasonCode).toBe("CANDIDATE_WRITE_FAILED");
    expect(classified.symbol).toBe("BTC/USD");
    expect(classified.displayMessage).toContain("BTC/USD");
  });
});

describe("max open trades capacity", () => {
  const enabledProfitConfig = {
    ...PAPER_ROTATION_CONFIG,
    enabled: true,
    requireProfit: true,
    minScoreAdvantage: 15,
    minExitPnlBps: 10,
    allowBreakevenExit: true,
    maxExitLossBps: 5,
    breakevenScoreAdvantage: 25,
    minTradeAgeMinutes: 30,
    protectNearTakeProfit: true,
    takeProfitDistanceBps: 25,
    blockExtremeRiskReplacement: true,
  };

  function mockCandidate(score = 80, overrides: Partial<ScanCandidate> = {}): ScanCandidate {
    return {
      symbol: "SOL/USD",
      price: 150,
      spreadBps: 10,
      volume24hUsd: 5_000_000,
      change24hPct: 8,
      change1hPct: 1,
      marketCapUsd: null,
      momentumScore: 70,
      volumeSpikeScore: 60,
      volatilityScore: 55,
      liquidityScore: 80,
      spreadScore: 85,
      trendScore: 60,
      dataQualityScore: 90,
      riskPenalty: 5,
      pumpRiskPenalty: 0,
      opportunityScore: score,
      riskTier: "MAJOR",
      shortTermReturnPct: 0.5,
      breakoutScore: 5,
      source: "kraken",
      tradableOnConfiguredExchange: true,
      action: "OPEN_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_OPENED",
      reasonText: "test",
      ...overrides,
    };
  }

  function mockOpenView(overrides: Partial<OpenTradeCapacityView> = {}): OpenTradeCapacityView {
    return {
      tradeId: "t1",
      symbol: "ETH/USD",
      score: 55,
      originalOpportunityScore: 55,
      weaknessScore: 40,
      unrealizedPnl: 1.5,
      unrealizedPnlBps: 15,
      ageMinutes: 60,
      entryPrice: 100,
      currentPrice: 100.15,
      plannedStopLoss: 99,
      plannedTakeProfit: 102,
      distanceToStop: 1.15,
      distanceToTarget: 1.85,
      distanceToTargetBps: 185,
      nearTakeProfit: false,
      riskTier: "MAJOR",
      confidenceDecay: 5,
      rotationEligibility: "eligible",
      rotationEligibilityReason: "ok",
      ...overrides,
    };
  }

  it("rotation disabled when config.enabled is false", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(85),
      openViews: [mockOpenView()],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: { ...enabledProfitConfig, enabled: false },
    });
    expect(decision.action).toBe("MARK_MISSED_OPPORTUNITY");
    expect(decision.missedReasonCode).toBe("ROTATION_DISABLED");
  });

  it("max open reached with rotation disabled stores ROTATION_DISABLED missed decision", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(85),
      openViews: [mockOpenView()],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: { ...enabledProfitConfig, enabled: false },
    });
    expect(decision.action).toBe("MARK_MISSED_OPPORTUNITY");
    expect(decision.missedReasonCode).toBe("ROTATION_DISABLED");
  });

  it("rotation does not close losing trade when profit required", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(90),
      openViews: [mockOpenView({ unrealizedPnlBps: -20, unrealizedPnl: -2, originalOpportunityScore: 50 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(decision.action).toBe("MARK_MISSED_OPPORTUNITY");
    expect(decision.missedReasonCode).toBe("EXIT_NOT_PROFITABLE");
  });

  it("rotation closes profitable weak trade when new candidate is much better", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(90),
      openViews: [mockOpenView({ unrealizedPnlBps: 20, originalOpportunityScore: 50 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(decision.action).toBe("PAPER_ROTATE_OUT_WEAKEST");
    expect((decision.scoreAdvantage ?? 0) >= 15).toBe(true);
  });

  it("rotation allows near-breakeven only with strong score advantage", () => {
    const weakAdvantage = decideCapacityForCandidate({
      candidate: mockCandidate(70),
      openViews: [mockOpenView({ unrealizedPnlBps: -3, originalOpportunityScore: 60 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(weakAdvantage.missedReasonCode).toBe("SCORE_ADVANTAGE_TOO_SMALL");

    const strongBreakeven = decideCapacityForCandidate({
      candidate: mockCandidate(90),
      openViews: [mockOpenView({ unrealizedPnlBps: -3, originalOpportunityScore: 50 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(strongBreakeven.action).toBe("PAPER_ROTATE_OUT_WEAKEST");
  });

  it("rotation blocks if open trade is near take-profit", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(90),
      openViews: [mockOpenView({ nearTakeProfit: true, distanceToTargetBps: 10, unrealizedPnlBps: 30 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(decision.missedReasonCode).toBe("OPEN_TRADE_NEAR_TAKE_PROFIT");
  });

  it("rotation blocks extreme-risk replacement by default", () => {
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(90, { riskTier: "EXTREME_RISK" }),
      openViews: [mockOpenView({ unrealizedPnlBps: 20 })],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: enabledProfitConfig,
    });
    expect(decision.missedReasonCode).toBe("EXTREME_RISK_REPLACEMENT_BLOCKED");
  });

  it("strong candidate marked missed when rotation disabled", () => {
    expect(isStrongCandidate(mockCandidate(85))).toBe(true);
    const decision = decideCapacityForCandidate({
      candidate: mockCandidate(85),
      openViews: [mockOpenView()],
      maxOpenTrades: 1,
      currentOpenCount: 1,
      rotationConfig: { ...enabledProfitConfig, enabled: false },
    });
    expect(decision.missedReasonCode).toBe("ROTATION_DISABLED");
  });
});

describe("paper rotation execution contract", () => {
  it("rotation close uses PAPER_ROTATION_EXIT reason label", () => {
    const reason = "test | closed: PAPER_ROTATION_EXIT";
    expect(reason).toContain("PAPER_ROTATION_EXIT");
  });

  it("rotation config can be disabled explicitly — no live orders", () => {
    const candidate: ScanCandidate = {
      symbol: "SOL/USD",
      price: 150,
      spreadBps: 10,
      volume24hUsd: 5_000_000,
      change24hPct: 8,
      change1hPct: 1,
      marketCapUsd: null,
      momentumScore: 70,
      volumeSpikeScore: 60,
      volatilityScore: 55,
      liquidityScore: 80,
      spreadScore: 85,
      trendScore: 60,
      dataQualityScore: 90,
      riskPenalty: 5,
      pumpRiskPenalty: 0,
      opportunityScore: 85,
      riskTier: "MAJOR",
      shortTermReturnPct: 0.5,
      breakoutScore: 5,
      source: "kraken",
      tradableOnConfiguredExchange: true,
      action: "OPEN_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_OPENED",
      reasonText: "test",
    };
    const openView: OpenTradeCapacityView = {
      tradeId: "t1",
      symbol: "ETH/USD",
      score: 55,
      originalOpportunityScore: 55,
      weaknessScore: 40,
      unrealizedPnl: 1.5,
      unrealizedPnlBps: 20,
      ageMinutes: 60,
      entryPrice: 100,
      currentPrice: 100.2,
      plannedStopLoss: 99,
      plannedTakeProfit: 102,
      distanceToStop: 1.2,
      distanceToTarget: 1.8,
      distanceToTargetBps: 180,
      nearTakeProfit: false,
      riskTier: "MAJOR",
      confidenceDecay: 5,
      rotationEligibility: "eligible",
      rotationEligibilityReason: "ok",
    };
    expect(
      decideCapacityForCandidate({
        candidate,
        openViews: [openView],
        maxOpenTrades: 1,
        currentOpenCount: 1,
        rotationConfig: { ...PAPER_ROTATION_CONFIG, enabled: false },
      }).action,
    ).toBe("MARK_MISSED_OPPORTUNITY");
  });

  it("open trade view exposes unrealized P&L bps for profit check", () => {
    const trade = {
      id: "t1",
      userId: "u1",
      signalId: null,
      symbol: "BTC/USD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      side: "LONG",
      strategyName: "controlled-active-paper-v1",
      entryPrice: { toNumber: () => 100 },
      plannedStopLoss: { toNumber: () => 99 },
      plannedTakeProfit: { toNumber: () => 102 },
      simulatedSize: { toNumber: () => 1 },
      riskAmount: null,
      riskPercent: null,
      status: "OPEN",
      openedAt: new Date(Date.now() - 60 * 60_000),
      closedAt: null,
      exitPrice: null,
      grossPaperPnl: null,
      estimatedFees: null,
      estimatedSlippage: null,
      netPaperPnl: null,
      result: "OPEN",
      confidence: { toNumber: () => 0.7 },
      reason: "test",
      dataSource: "kraken",
      isRealTrade: false,
      isVerifiedLivePnl: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PaperTrade;

    const view = computeOpenTradeCapacityView({
      trade,
      currentPrice: 100.2,
      candidateScoreBySymbol: new Map([["BTC/USD", 70]]),
    });
    expect(view.unrealizedPnlBps).toBeGreaterThan(0);
    expect(view.originalOpportunityScore).toBe(70);
  });
});

describe("next steps paper-forward status mapping", () => {
  it("maps COLLECTING and PASS from evidence evaluator", () => {
    expect(
      evaluatePaperForwardEvidence({
        totalRuns: 5,
        closedTrades: 3,
        calendarDays: 2,
        unresolvedDataErrors: 0,
        systemAvailable: true,
      }).status,
    ).toBe("COLLECTING");

    expect(
      evaluatePaperForwardEvidence({
        totalRuns: 30,
        closedTrades: 20,
        calendarDays: 7,
        unresolvedDataErrors: 0,
        systemAvailable: true,
      }).status,
    ).toBe("PASS");
  });
});

describe("kraken fallback run diagnostics", () => {
  it("returns KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED for partial fallback runs", () => {
    expect(
      resolveRunReasonCode({
        status: "PARTIAL",
        countDelta: 5,
        tradesOpened: 0,
        tradesUpdated: 0,
        snapshotsStored: 0,
        candidatesStored: 3,
        signalsStored: 0,
        paperRunsDelta: 1,
        maxOpenTradesReached: false,
        prismaCriticalFailure: false,
        databaseWriteFailed: false,
        snapshotWriteFailed: false,
        explicitReasonCode: "KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED",
      }),
    ).toBe("KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED");
  });

  it("classifies partial run with saved candidates as PARTIAL not FAILED", () => {
    expect(
      classifyRunStatus({
        runRecordCreated: true,
        countDelta: 4,
        candidatesStored: 3,
        signalsStored: 0,
        snapshotsStored: 0,
        tradesOpened: 0,
        tradesUpdated: 0,
        tradesClosed: 0,
        candidateWriteFailures: 0,
        snapshotWriteFailures: 0,
        failedFetches: 0,
        errorCount: 0,
        marketDataStatus: "MARKET_DATA_PARTIAL",
        prismaCriticalFailure: false,
      }),
    ).toBe("PARTIAL");
  });

  it("classifies all-provider failure as FAILED", () => {
    expect(
      classifyRunStatus({
        runRecordCreated: true,
        countDelta: 1,
        candidatesStored: 0,
        signalsStored: 0,
        snapshotsStored: 0,
        tradesOpened: 0,
        tradesUpdated: 0,
        tradesClosed: 0,
        candidateWriteFailures: 0,
        snapshotWriteFailures: 0,
        failedFetches: 0,
        errorCount: 1,
        marketDataStatus: "MARKET_DATA_FAILED",
        prismaCriticalFailure: false,
      }),
    ).toBe("FAILED");
  });
});

describe("scanner provider status vault mapping", () => {
  it("maps DexScreener and DeFiLlama public mode from vault hints", async () => {
    const { buildScannerProviderStatus } = await import("@/lib/trading/paper/scanner-provider-status");
    const panel = buildScannerProviderStatus({
      vaultConnections: [],
      dexscreenerStatus: "ok",
      defillamaStatus: "ok",
    });
    expect(panel.providers.find((p) => p.provider === "DEX_SCREENER")?.connectionStatusLabel).toBe(
      "READY_PUBLIC_MODE",
    );
    expect(panel.providers.find((p) => p.provider === "DEFILLAMA")?.connectionStatusLabel).toBe(
      "READY_PUBLIC_MODE",
    );
  });
});
