import { describe, expect, it } from "vitest";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { buildFeatureScoreHealth } from "@/lib/trading/paper/feature-score-health";
import { buildStrategyFormulaHealth } from "@/lib/trading/paper/strategy-formula-health";
import { resolveBotWorkingVerdict } from "@/lib/trading/paper/bot-diagnostic-verdict";
import { buildThresholdCalibrationReport } from "@/lib/trading/paper/threshold-calibration";
import {
  buildShadowReplayEntry,
  buildShadowReplayReport,
} from "@/lib/trading/paper/shadow-replay-diagnostics";
import { buildTinyBEligibilityReport } from "@/lib/trading/paper/tiny-b-eligibility";
import { buildPaperRunDiagnostics } from "@/lib/trading/paper/paper-diagnostics";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { buildCleanFreshStartStatus } from "@/lib/trading/paper/record-accounting";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import type { PipelineSummaryCounts } from "@/lib/trading/paper/paper-decision-pipeline";

function mockCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "ETH/USD",
    price: 3000,
    spreadBps: 10,
    volume24hUsd: 50_000_000,
    change24hPct: 2,
    change1hPct: 0.1,
    marketCapUsd: 1e11,
    momentumScore: 8,
    volumeSpikeScore: 50,
    volatilityScore: 40,
    liquidityScore: 75,
    spreadScore: 80,
    trendScore: 0,
    dataQualityScore: 80,
    riskPenalty: 5,
    pumpRiskPenalty: 5,
    opportunityScore: 64,
    scoreBreakdown: emptyScoreBreakdown({ finalScore: 64, momentumScore: 8, trendStrengthScore: 0 }),
    riskTier: "MAJOR",
    shortTermReturnPct: 0.05,
    breakoutScore: 0,
    source: "kraken",
    tradableOnConfiguredExchange: true,
    availability: {
      listedOnKraken: "YES",
      krakenSpotAvailable: "YES",
      krakenMarginAvailable: "UNKNOWN",
      krakenFuturesAvailable: "UNKNOWN",
      usLeverageAvailable: "UNKNOWN",
      availablePairs: ["ETH/USD"],
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
    reasonText: "blocked",
    candlesLoaded: true,
    candleCount: 12,
    ...overrides,
  } as ScanCandidate;
}

const emptyPipeline: PipelineSummaryCounts = {
  discovered: 100,
  evaluated: 100,
  ranked: 10,
  failedFilters: 8,
  aPlusMatches: 0,
  aMatches: 0,
  bNearMisses: 0,
  cWatchOnly: 2,
  rejected: 8,
};

describe("paper diagnostics", () => {
  it("feature score health detects all-zero trendScore", () => {
    const health = buildFeatureScoreHealth({
      ranked: [mockCandidate({ trendScore: 0 }), mockCandidate({ symbol: "BTC/USD", trendScore: 0 })],
    });
    expect(health.warningFlags).toContain("TREND_SCORE_ALWAYS_ZERO");
  });

  it("feature score health detects all-zero breakoutScore", () => {
    const health = buildFeatureScoreHealth({
      ranked: [mockCandidate({ breakoutScore: 0 })],
    });
    expect(health.warningFlags).toContain("BREAKOUT_SCORE_ALWAYS_ZERO");
  });

  it("missing candle data shows DATA_PROVIDER_INCOMPLETE via verdict", () => {
    const health = buildFeatureScoreHealth({
      ranked: [
        mockCandidate({ candlesLoaded: false, candleCount: 0, breakoutScore: 0, trendScore: 0 }),
        mockCandidate({ symbol: "SOL/USD", candlesLoaded: false, candleCount: 0 }),
      ],
    });
    const verdict = resolveBotWorkingVerdict({
      featureHealth: health,
      pipelineCounts: emptyPipeline,
      tradesOpenedThisRun: 0,
      marketDataStatus: "MARKET_DATA_PARTIAL",
    });
    expect(verdict.status).toBe("DATA_PROVIDER_INCOMPLETE");
  });

  it("strategy formula health marks real formulas as IMPLEMENTED", () => {
    const health = buildStrategyFormulaHealth({ ranked: [mockCandidate()] });
    expect(health.strategies.every((s) => s.formulaStatus === "IMPLEMENTED")).toBe(true);
    expect(health.strategies.some((s) => s.zeroScoreReason?.includes("breakoutScore=0"))).toBe(true);
  });

  it("bad market verdict appears when features are valid but no setups pass", () => {
    const ranked = [
      mockCandidate({ momentumScore: 25, trendScore: 12, breakoutScore: 5, candlesLoaded: true, candleCount: 20 }),
    ];
    const health = buildFeatureScoreHealth({ ranked });
    const verdict = resolveBotWorkingVerdict({
      featureHealth: health,
      pipelineCounts: emptyPipeline,
      tradesOpenedThisRun: 0,
    });
    expect(["BOT_WORKING_NO_EDGE_FOUND", "MARKET_WEAK_WAIT", "BOT_WORKING_TOO_STRICT"]).toContain(
      verdict.status,
    );
  });

  it("broken feature verdict appears when features default to zero", () => {
    const health = buildFeatureScoreHealth({
      ranked: [
        mockCandidate({
          momentumScore: 0,
          trendScore: 0,
          breakoutScore: 0,
          volatilityScore: 0,
          opportunityScore: 0,
          candlesLoaded: false,
        }),
      ],
    });
    const verdict = resolveBotWorkingVerdict({
      featureHealth: health,
      pipelineCounts: emptyPipeline,
      tradesOpenedThisRun: 0,
    });
    expect(verdict.status).toBe("FEATURE_ENGINE_BROKEN");
  });

  it("calibration report does not auto-lower thresholds", () => {
    const report = buildThresholdCalibrationReport([mockCandidate()]);
    expect(report.thresholdsChanged).toBe(false);
    expect(report.strategies.every((s) => s.autoAdjustRecommended === false)).toBe(true);
  });

  it("shadow replay stores blocked candidates without calling them real trades", () => {
    const report = buildShadowReplayReport({
      ranked: [mockCandidate()],
      timestamp: new Date().toISOString(),
    });
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.entries.every((e) => e.isRealTrade === false)).toBe(true);
  });

  it("money protected is separate from profit wording", () => {
    const entry = buildShadowReplayEntry(mockCandidate(), new Date().toISOString(), 2900);
    expect(entry.blockProtectedMoney).toBe(true);
    expect(entry.isRealTrade).toBe(false);
    const report = buildShadowReplayReport({
      ranked: [mockCandidate()],
      timestamp: new Date().toISOString(),
      followUpPrices: new Map([["ETH/USD", 2900]]),
    });
    expect(report.moneyProtectedNote).toContain("NOT paper P&L");
  });

  it("missed opportunity is separate from profit wording", () => {
    const report = buildShadowReplayReport({
      ranked: [mockCandidate()],
      timestamp: new Date().toISOString(),
      followUpPrices: new Map([["ETH/USD", 3100]]),
    });
    expect(report.missedOpportunityNote).toContain("diagnostic only");
    expect(report.missedWinners).toBeGreaterThanOrEqual(0);
  });

  it("tiny B report explains exact blockers", () => {
    const report = buildTinyBEligibilityReport({
      ranked: [mockCandidate({ opportunityScore: 70, momentumScore: 55, trendScore: 50 })],
      tradesOpenedThisRun: 0,
    });
    expect(report.message.length).toBeGreaterThan(0);
    if (report.nearMisses.length > 0) {
      expect(report.nearMisses[0]?.exactBlocker).toBeTruthy();
    }
  });

  it("V6 clean start works when no open trades", () => {
    const status = buildCleanFreshStartStatus([]);
    expect(status.available).toBe(true);
  });

  it("live trading remains LOCKED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
  });

  it("Auto remains LOCKED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.autoExecutionLocked).toBe(true);
  });

  it("all P&L remains SIMULATED", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.paperPnlSimulated).toBe(true);
    const diagnostics = buildPaperRunDiagnostics({
      ranked: [mockCandidate()],
      pipelineCounts: emptyPipeline,
      tradesOpenedThisRun: 0,
    });
    expect(diagnostics.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
  });

  it("strategy version label is v0.10-feature-calibration", () => {
    expect(CURRENT_PAPER_STRATEGY_VERSION).toBe("v0.10-feature-calibration");
  });
});
