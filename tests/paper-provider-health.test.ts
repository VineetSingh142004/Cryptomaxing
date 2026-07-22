import { describe, expect, it, beforeEach } from "vitest";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { evaluateProviderHealth } from "@/lib/trading/paper/provider-health-gate";
import {
  clearKrakenLastGoodCache,
  resolveKrakenCacheStatus,
  saveKrakenLastGoodCache,
} from "@/lib/trading/paper/kraken-last-good-cache";
import { sanitizeChange24hPct } from "@/lib/trading/paper/field-sanitization";
import {
  computeStrategyFeatureScores,
  scoreForCalibration,
} from "@/lib/trading/paper/strategy-score-state";
import {
  evaluateEntryQualityBlockers,
  tinyBEntryQualityBlock,
} from "@/lib/trading/paper/entry-quality";
import { evaluateExitQuality } from "@/lib/trading/paper/exit-quality";
import { computeProfitQualityScore } from "@/lib/trading/paper/profit-quality-score";
import {
  buildV6LossPostmortemReport,
  analyzeV6ClosedTrade,
} from "@/lib/trading/paper/v6-loss-postmortem";
import { evaluateV8Readiness } from "@/lib/trading/paper/v8-readiness";
import {
  canOpenPaperTrade,
  passedHardSafetyFilters,
} from "@/lib/trading/paper/paper-decision-pipeline";
import { buildThresholdCalibrationReport } from "@/lib/trading/paper/threshold-calibration";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import type { PaperTrade } from "@prisma/client";

function baseCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "SOL/USD",
    price: 150,
    spreadBps: 12,
    volume24hUsd: 5_000_000,
    change24hPct: 3,
    change1hPct: 0.5,
    marketCapUsd: 1e10,
    momentumScore: 55,
    volumeSpikeScore: 50,
    volatilityScore: 45,
    liquidityScore: 70,
    spreadScore: 80,
    trendScore: 48,
    dataQualityScore: 75,
    riskPenalty: 5,
    pumpRiskPenalty: 5,
    opportunityScore: 62,
    scoreBreakdown: emptyScoreBreakdown({ finalScore: 62 }),
    riskTier: "LARGE",
    shortTermReturnPct: 0.3,
    breakoutScore: 42,
    breakoutScoreStatus: "COMPUTED",
    trendScoreStatus: "COMPUTED",
    source: "kraken",
    tradableOnConfiguredExchange: true,
    availability: {
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
    },
    action: "NO_TRADE",
    actionType: "REJECTED",
    reasonCode: "SCORE_TOO_LOW",
    reasonText: "test",
    candlesLoaded: true,
    candleCount: 55,
    discoveryOnly: false,
    ...overrides,
  } as ScanCandidate;
}

describe("provider health and data pipeline", () => {
  beforeEach(() => {
    clearKrakenLastGoodCache();
  });

  it("1. Kraken unavailable blocks strategy trading", () => {
    const health = evaluateProviderHealth({
      krakenStatus: "unavailable",
      coingeckoStatus: "skipped",
    });
    expect(health.tradeReadyCandidatesAllowed).toBe(false);
    expect(health.strategyScoringAllowed).toBe(false);
    expect(health.status).toBe("KRAKEN_UNAVAILABLE");
  });

  it("2. CoinGecko fallback is discovery-only unless Kraken tradability confirmed", () => {
    const health = evaluateProviderHealth({
      krakenStatus: "unavailable",
      coingeckoStatus: "ok",
      krakenFallbackUsed: true,
    });
    expect(health.status).toBe("COINGECKO_FALLBACK_DISCOVERY_ONLY");
    expect(health.discoveryOnly).toBe(true);
    const c = baseCandidate({
      source: "coingecko",
      discoveryOnly: true,
      tradableOnConfiguredExchange: false,
    });
    expect(passedHardSafetyFilters(c)).toBe(false);
  });

  it("3. Last-good Kraken cache used only when fresh", () => {
    saveKrakenLastGoodCache({
      pairMap: new Map([
        [
          "SOLUSD",
          {
            krakenPair: "SOLUSD",
            symbol: "SOL/USD",
            baseAsset: "SOL",
            quoteAsset: "USD",
            wsname: "SOL/USD",
            status: "online",
            hasMarginLeverage: false,
          },
        ],
      ]),
      tradableSymbols: ["SOL/USD"],
      fetchedAt: new Date(),
    });
    const fresh = resolveKrakenCacheStatus();
    expect(fresh.label).toBe("USING_LAST_GOOD_KRAKEN_UNIVERSE");
    expect(fresh.canOpenTrades).toBe(true);
    expect(fresh.canUseForTradability).toBe(true);
  });

  it("4. Stale Kraken cache cannot open trades", () => {
    const stale = new Date(Date.now() - 90 * 60 * 1000);
    saveKrakenLastGoodCache({
      pairMap: new Map(),
      tradableSymbols: [],
      fetchedAt: stale,
    });
    const status = resolveKrakenCacheStatus();
    expect(status.label).toBe("KRAKEN_CACHE_STALE");
    expect(status.canOpenTrades).toBe(false);
    const health = evaluateProviderHealth({
      krakenStatus: "ok",
      coingeckoStatus: "skipped",
      krakenCacheStatus: status,
      candlesLoadedPct: 0.9,
      tradabilityUnknownPct: 0,
    });
    expect(health.tradeReadyCandidatesAllowed).toBe(false);
  });

  it("5. Missing candles produces STRATEGY_SCORING_BLOCKED_NO_CANDLES", () => {
    const scores = computeStrategyFeatureScores({ candles: [] });
    expect(scores.blockReason).toBe("STRATEGY_SCORING_BLOCKED_NO_CANDLES");
    expect(scores.breakoutScoreStatus).toBe("NOT_COMPUTED");
    const health = evaluateProviderHealth({
      krakenStatus: "ok",
      coingeckoStatus: "skipped",
      candlesLoadedPct: 0,
      featureHealth: {
        summary: "no candles",
        candlesLoaded: false,
        candlesLoadedPct: 0,
        providerSource: "kraken",
        warningFlags: ["CANDLES_MISSING_FOR_STRATEGY"],
        zeroScoreExplanations: { trendScore: "NOT_COMPUTED", breakoutScore: "NOT_COMPUTED" },
        distributions: {
          momentumScore: { min: 0, median: 0, max: 0 },
          trendScore: { min: 0, median: 0, max: 0 },
          breakoutScore: { min: 0, median: 0, max: 0 },
          opportunityScore: { min: 0, median: 0, max: 0 },
        },
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      },
    });
    expect(health.status).toBe("STRATEGY_SCORING_BLOCKED_NO_CANDLES");
  });

  it("6. NOT_COMPUTED scores excluded from threshold calibration", () => {
    expect(scoreForCalibration(0, "NOT_COMPUTED")).toBeNull();
    expect(scoreForCalibration(40, "COMPUTED")).toBe(40);
    const ranked = [
      baseCandidate({ breakoutScore: 0, breakoutScoreStatus: "NOT_COMPUTED" }),
      baseCandidate({ symbol: "ETH/USD", breakoutScore: 40, breakoutScoreStatus: "NOT_COMPUTED" }),
    ];
    const cal = buildThresholdCalibrationReport(ranked);
    const breakout = cal.strategies.find((s) => s.feature === "breakoutScore");
    expect(breakout?.conclusion).toMatch(/NOT_COMPUTED|excluded|verify candles/i);
  });

  it("7. Absurd provider percentage changes sanitized and blocked from scoring", () => {
    const s = sanitizeChange24hPct(68_410_132);
    expect(s.outlier).toBe(true);
    expect(s.reasonCode).toBe("DATA_OUTLIER_SANITIZED");
    const c = baseCandidate({
      change24hPct: s.value,
      providerAnomalyFlags: ["DATA_OUTLIER_SANITIZED"],
    });
    const block = evaluateEntryQualityBlockers({ candidate: c });
    expect(block.blocked).toBe(true);
    expect(block.reasonCode).toBe("DATA_OUTLIER_SANITIZED");
  });

  it("8. Unknown exchange availability cannot open paper trade", () => {
    const c = baseCandidate({
      reasonCode: "EXCHANGE_AVAILABILITY_UNKNOWN",
      tradableOnConfiguredExchange: false,
    });
    expect(passedHardSafetyFilters(c)).toBe(false);
    const health = evaluateProviderHealth({
      krakenStatus: "ok",
      coingeckoStatus: "skipped",
      candlesLoadedPct: 0.9,
      tradabilityUnknownPct: 0.6,
    });
    expect(health.status).toBe("EXCHANGE_TRADABILITY_UNKNOWN");
    expect(health.tradeReadyCandidatesAllowed).toBe(false);
  });

  it("9. Tiny B cannot open from fallback-only CoinGecko data", () => {
    const c = baseCandidate({
      source: "coingecko",
      discoveryOnly: true,
      tradableOnConfiguredExchange: false,
      candlesLoaded: false,
      candleCount: 0,
      breakoutScoreStatus: "NOT_COMPUTED",
    });
    const block = tinyBEntryQualityBlock({ candidate: c, providerDiscoveryOnly: true });
    expect(block.blocked).toBe(true);
    expect(block.reasonCode).toMatch(/COINGECKO|CANDLES|DATA/);
  });

  it("10. V6 loss postmortem reports all closed trades", () => {
    const trades = [
      {
        id: "t1",
        symbol: "SOL/USD",
        side: "LONG",
        status: "CLOSED",
        result: "LOSS",
        entryPrice: 100,
        exitPrice: 95,
        netPaperPnl: -5,
        plannedStopLoss: 94,
        plannedTakeProfit: 110,
        riskAmount: 10,
        openedAt: new Date("2026-01-01"),
        closedAt: new Date("2026-01-02"),
        reason: "Tiny B | score: 60 | spread: 15 bps | closed: STOP_LOSS_HIT",
      },
      {
        id: "t2",
        symbol: "ETH/USD",
        side: "LONG",
        status: "CLOSED",
        result: "LOSS",
        entryPrice: 3000,
        exitPrice: 2950,
        netPaperPnl: -3,
        plannedStopLoss: 2900,
        plannedTakeProfit: 3200,
        riskAmount: 8,
        openedAt: new Date("2026-01-03"),
        closedAt: new Date("2026-01-04"),
        reason: "VWAP reclaim | score: 55 | spread: 10 bps | closed: STOP_LOSS_HIT",
      },
    ] as PaperTrade[];
    const report = buildV6LossPostmortemReport({
      recordNumber: 6,
      recordName: "V6",
      totalPnl: -8,
      trades,
    });
    expect(report.closedTrades).toBe(2);
    expect(report.closedTradeDetails).toHaveLength(2);
    expect(analyzeV6ClosedTrade(trades[0]).symbol).toBe("SOL/USD");
  });

  it("11. Entry quality blocks negative shortTermReturn unless pullback confirms", () => {
    const blocked = evaluateEntryQualityBlockers({
      candidate: baseCandidate({ shortTermReturnPct: -0.5 }),
      pullbackStrategyConfirmed: false,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasonCode).toBe("ENTRY_BLOCKED_NEGATIVE_SHORT_RETURN");
    const allowed = evaluateEntryQualityBlockers({
      candidate: baseCandidate({ shortTermReturnPct: -0.2 }),
      pullbackStrategyConfirmed: true,
    });
    expect(allowed.blocked).toBe(false);
  });

  it("12. Exit quality exits early on thesis invalidation", () => {
    const exit = evaluateExitQuality({
      side: "LONG",
      entryPrice: 100,
      markPrice: 99,
      unrealizedPnl: -1,
      plannedStopLoss: 95,
      plannedTakeProfit: 110,
      runsHeld: 2,
      thesisStatus: "INVALIDATED",
      thesisRecommendation: "EXIT_EARLY",
    });
    expect(exit.recommendation).toBe("THESIS_INVALIDATED_EXIT");
  });

  it("13. Profit Quality Score penalizes setups similar to V6 losers", () => {
    const c = baseCandidate({ momentumScore: 35, shortTermReturnPct: -0.4 });
    const score = computeProfitQualityScore({
      candidate: c,
      v6Lessons: [
        {
          commonPattern: "negative momentum at entry",
          ruleToAdd: "block",
          thresholdToReview: "momentum",
          prevention: "gate",
          lossCharacter: "AVOIDABLE",
          simulatedLabel: "SIMULATED_PAPER_ONLY",
        },
      ],
    });
    expect(score.lossPatternPenalty).toBeGreaterThan(0);
    expect(score.similarV6Loss).toBe(true);
  });

  it("14. V8 cannot start if provider health is broken", () => {
    const health = evaluateProviderHealth({
      krakenStatus: "unavailable",
      coingeckoStatus: "ok",
      krakenFallbackUsed: true,
    });
    const readiness = evaluateV8Readiness({
      providerHealth: health,
      featureHealth: null,
      rankedCount: 20,
      tradableRankedCount: 0,
      v6Postmortem: buildV6LossPostmortemReport({
        recordNumber: 6,
        recordName: "V6",
        totalPnl: -65,
        trades: [{ id: "x", status: "CLOSED", result: "LOSS", netPaperPnl: -10 } as PaperTrade],
      }),
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it("15. Export/dashboard accounting still match (record export helper present)", async () => {
    const mod = await import("@/lib/trading/paper/export-log");
    expect(typeof mod.buildPaperExportLog).toBe("function");
  });

  it("16. Live trading remains LOCKED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
  });

  it("17. Auto remains LOCKED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.autoExecutionLocked).toBe(true);
  });

  it("18. All P&L remains SIMULATED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.paperPnlSimulated).toBe(true);
    expect(canOpenPaperTrade("OPEN_PAPER_TRADE")).toBe(true);
    const exit = evaluateExitQuality({
      side: "LONG",
      entryPrice: 100,
      markPrice: 101,
      unrealizedPnl: 1,
      plannedStopLoss: 95,
      plannedTakeProfit: 110,
      runsHeld: 1,
    });
    expect(exit.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });
});
