import { describe, expect, it } from "vitest";
import { computeWeightedScore, emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import { evaluateTradeSelection } from "@/lib/trading/paper/trade-selection";
import { buildFinalCandidateOutput } from "@/lib/trading/paper/candidate-output";
import {
  PAPER_ROTATION_CONFIG,
  rotationWarning,
  serializeRotationConfig,
} from "@/lib/trading/paper/paper-rotation-config";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";

const confirmedAvailability: ExchangeAvailabilityResult = {
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

const unknownLeverageAvailability: ExchangeAvailabilityResult = {
  ...confirmedAvailability,
  krakenMarginAvailable: "UNKNOWN",
};

function strongBreakdown() {
  return computeWeightedScore({
    volume24hUsd: 50_000_000,
    change24hPct: 12,
    change1hPct: 3,
    marketCapUsd: 5_000_000_000,
    spreadBps: 15,
    momentumPct: 0.8,
    volatilityPct: 3,
    shortTermReturnPct: 0.5,
    breakoutScore: 20,
    volumeSpikeScore: 80,
    dataQualityScore: 85,
    riskTier: "ALT_LIQUID",
    availability: confirmedAvailability,
    pumpRiskPenalty: 5,
    riskTierPenalty: 5,
  });
}

describe("weighted scoring", () => {
  it("computes positive final score from strong inputs", () => {
    const b = strongBreakdown();
    expect(b.finalScore).toBeGreaterThan(50);
    expect(b.volumeScore).toBeGreaterThan(0);
    expect(b.momentumScore).toBeGreaterThan(0);
    expect(b.positiveTotal).toBeGreaterThan(b.riskTotal * 0.1);
  });

  it("leverage unknown does not boost leverage score", () => {
    const withUnknown = computeWeightedScore({
      volume24hUsd: 10_000_000,
      change24hPct: 8,
      change1hPct: 1,
      marketCapUsd: 1e9,
      spreadBps: 20,
      momentumPct: 0.3,
      volatilityPct: 2,
      shortTermReturnPct: 0.2,
      breakoutScore: 10,
      volumeSpikeScore: 60,
      dataQualityScore: 70,
      riskTier: "ALT_LIQUID",
      availability: unknownLeverageAvailability,
      pumpRiskPenalty: 0,
    });
    expect(withUnknown.leverageAvailabilityScore).toBe(0);
  });

  it("exchange availability affects exchange score", () => {
    const noExchange = computeWeightedScore({
      volume24hUsd: 10_000_000,
      change24hPct: 8,
      change1hPct: 1,
      marketCapUsd: 1e9,
      spreadBps: 20,
      momentumPct: 0.3,
      volatilityPct: 2,
      shortTermReturnPct: 0.2,
      breakoutScore: 10,
      volumeSpikeScore: 60,
      dataQualityScore: 70,
      riskTier: "ALT_LIQUID",
      availability: {
        ...confirmedAvailability,
        krakenSpotAvailable: "NO",
        listedOnKraken: "NO",
      },
      pumpRiskPenalty: 0,
    });
    expect(noExchange.exchangeAvailabilityScore).toBe(0);
    expect(noExchange.finalScore).toBeLessThan(strongBreakdown().finalScore);
  });
});

describe("trade selection quality filter", () => {
  it("weak setup returns WATCH not BUY", () => {
    const breakdown = emptyScoreBreakdown({ finalScore: 40, confidenceLevel: "LOW" });
    const result = evaluateTradeSelection({
      breakdown,
      availability: confirmedAvailability,
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

  it("does not force trades when score too low", () => {
    const breakdown = emptyScoreBreakdown({ finalScore: 45, confidenceLevel: "MEDIUM", liquidityScore: 60 });
    const result = evaluateTradeSelection({
      breakdown,
      availability: confirmedAvailability,
      riskTier: "ALT_LIQUID",
      spreadBps: 15,
      volume24hUsd: 10_000_000,
      change24hPct: 5,
      momentumPct: 0.2,
      hasExitPlan: true,
    });
    expect(result.shouldOpen).toBe(false);
    expect(result.reasonCode).toBe("SCORE_TOO_LOW");
  });

  it("allows open only on strong confirmed setup", () => {
    const breakdown = strongBreakdown();
    const result = evaluateTradeSelection({
      breakdown,
      availability: confirmedAvailability,
      riskTier: "ALT_LIQUID",
      spreadBps: 15,
      volume24hUsd: 50_000_000,
      change24hPct: 12,
      momentumPct: 0.8,
      hasExitPlan: true,
    });
    expect(result.shouldOpen).toBe(true);
    expect(result.recommendation).toBe("BUY");
  });
});

describe("rotation defaults", () => {
  it("defaults to disabled unless env overrides", () => {
    expect(["disabled", "manual_review", "auto_paper_only"]).toContain(PAPER_ROTATION_CONFIG.mode);
    if (PAPER_ROTATION_CONFIG.mode === "auto_paper_only") {
      expect(rotationWarning()).toContain("experimental");
    } else {
      expect(PAPER_ROTATION_CONFIG.enabled).toBe(false);
    }
  });

  it("serializeRotationConfig includes mode and warning", () => {
    const s = serializeRotationConfig();
    expect(s.mode).toBeDefined();
    expect("warning" in s).toBe(true);
  });
});

describe("final candidate output", () => {
  it("includes score fields and simulated labels", () => {
    const breakdown = strongBreakdown();
    const out = buildFinalCandidateOutput({
      name: "Solana",
      symbol: "SOL/USD",
      baseAsset: "SOL",
      currentPrice: 150,
      volume24hUsd: 50_000_000,
      marketCapUsd: 80e9,
      liquidityUsd: 50_000_000,
      change24hPct: 8,
      availability: confirmedAvailability,
      enriched: { providerStatus: {} },
      action: "OPEN_TRADE",
      scoreBreakdown: breakdown,
      riskTier: "MAJOR",
    });
    expect(out.scores.finalTotal).toBe(breakdown.finalScore);
    expect(out.scores.momentum).toBe(breakdown.momentumScore);
    expect(out.simulatedLabel).toBe("SIMULATED_PAPER_ONLY");
    expect(out.entryPrice).toBe(150);
    expect(out.stopLossPrice).not.toBeNull();
    expect(out.recommendedTradeType).toBe("spot");
    expect(out.availabilitySummary.krakenSpotAvailable).toBe("YES");
    expect(out.leverageDetail.useLeverage).toBe(false);
    expect(out.exitConditions.some((e) => e.includes("SIMULATED"))).toBe(true);
  });
});

describe("auto remains locked", () => {
  it("scoring changes do not unlock Auto", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        apiSecure: true,
        noWithdrawalPermission: true,
        executionEngineWired: false,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
  });
});
