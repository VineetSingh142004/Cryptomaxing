import { describe, expect, it } from "vitest";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  canOpenPaperTrade,
  evaluatePaperDecision,
} from "@/lib/trading/paper/paper-decision-pipeline";
import { evaluateControlledActiveStrategy } from "@/lib/trading/paper/controlled-active-strategy";
import {
  resolveTinyBExecutionBlocker,
  mapStrategyLayerBlockToTinyBReason,
} from "@/lib/trading/paper/tiny-b-execution";
import { isActionablePaperTrade } from "@/lib/trading/paper/paper-record";
import { buildCleanFreshStartStatus } from "@/lib/trading/paper/record-accounting";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAllBlueprintStrategies } from "@/lib/trading/paper/strategy-mapping";
import type { PaperTrade } from "@prisma/client";

function nearMissCandidate(overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    symbol: "BTC/USD",
    price: 100_000,
    spreadBps: 10,
    volume24hUsd: 50_000_000,
    change24hPct: 4,
    change1hPct: 0.5,
    marketCapUsd: 1e12,
    momentumScore: 58,
    volumeSpikeScore: 60,
    volatilityScore: 50,
    liquidityScore: 80,
    spreadScore: 85,
    trendScore: 52,
    dataQualityScore: 85,
    riskPenalty: 5,
    pumpRiskPenalty: 5,
    opportunityScore: 68,
    scoreBreakdown: emptyScoreBreakdown({
      finalScore: 68,
      confidenceLevel: "MEDIUM",
      momentumScore: 58,
      trendStrengthScore: 52,
    }),
    riskTier: "MAJOR",
    shortTermReturnPct: 0.4,
    breakoutScore: 40,
    source: "kraken",
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
    action: "NO_TRADE",
    actionType: "REJECTED",
    reasonCode: "SCORE_TOO_LOW",
    reasonText: "near miss",
    candlesLoaded: true,
    candleCount: 20,
    ...overrides,
  } as ScanCandidate;
}

describe("tiny B paper execution", () => {
  it("TINY_B_SETUP_PAPER_ONLY can open when hard safety filters pass", () => {
    const c = nearMissCandidate();
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).toBe("TINY_B_SETUP_PAPER_ONLY");
    expect(canOpenPaperTrade(decision.decision)).toBe(true);
    const strategy = evaluateControlledActiveStrategy(c, 0.2, {
      allocationMultiplier: decision.allocationMultiplier,
      paperExecutionMode: "TINY_B_SETUP_PAPER_ONLY",
    });
    expect(strategy.decision).not.toBe("NO_TRADE");
    expect(strategy.reasonCode).toBe("TINY_B_SETUP_PAPER_ONLY");
    expect(strategy.reason).toContain("TINY B PAPER-ONLY TEST");
  });

  it("TINY_B blocked when volume is low", () => {
    const c = nearMissCandidate({ volume24hUsd: 1000, reasonCode: "VOLUME_TOO_LOW" });
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).not.toBe("TINY_B_SETUP_PAPER_ONLY");
  });

  it("TINY_B blocked when spread is wide", () => {
    const c = nearMissCandidate({ spreadBps: 500, reasonCode: "SPREAD_TOO_WIDE" });
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).not.toBe("TINY_B_SETUP_PAPER_ONLY");
  });

  it("TINY_B blocked when not tradable", () => {
    const c = nearMissCandidate({ tradableOnConfiguredExchange: false, reasonCode: "NOT_TRADABLE_ON_EXCHANGE" });
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).toBe("REJECT");
  });

  it("TINY_B blocked when fake-pump risk fails", () => {
    const c = nearMissCandidate({ pumpRiskPenalty: 45, reasonCode: "PUMP_RISK_TOO_HIGH" });
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).not.toBe("TINY_B_SETUP_PAPER_ONLY");
  });

  it("TINY_B blocked when R:R fails at candidate layer", () => {
    const c = nearMissCandidate({ reasonCode: "RISK_REWARD_TOO_WEAK" });
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).not.toBe("TINY_B_SETUP_PAPER_ONLY");
  });

  it("caution mode reduces Tiny B size instead of blocking safe Tiny B", () => {
    const c = nearMissCandidate();
    const decision = evaluatePaperDecision(c, {
      recordCaution: {
        active: true,
        mode: "WARMUP_MODE",
        dashboardLabel: "WARMUP",
        dashboardMessage: "warmup",
        allocationMultiplier: 0.5,
        minScoreBoost: 5,
        blockHighVolAlts: false,
        pauseNewEntries: false,
        reasons: [],
      },
    });
    expect(decision.decision).toBe("TINY_B_SETUP_PAPER_ONLY");
    expect(decision.allocationMultiplier).toBeLessThanOrEqual(0.35);
  });

  it("pauseNewEntries blocks Tiny B with clear reason", () => {
    const c = nearMissCandidate();
    const decision = evaluatePaperDecision(c);
    expect(decision.decision).toBe("TINY_B_SETUP_PAPER_ONLY");
    const block = resolveTinyBExecutionBlocker({
      candidate: c,
      paperDecision: decision,
      recordCaution: {
        active: true,
        mode: "CAUTION",
        dashboardLabel: "CAUTION",
        dashboardMessage: "pause active",
        allocationMultiplier: 0.5,
        minScoreBoost: 5,
        blockHighVolAlts: true,
        pauseNewEntries: true,
        reasons: [],
      },
      openSlotsAvailable: true,
      maxOpenTradesReached: false,
      symbolAlreadyOpen: false,
    });
    expect(block?.reasonCode).toBe("TINY_B_BLOCKED_CAUTION_CRITICAL");
  });

  it("export excludes NO_TRADE diagnostic rows from actionable trades", () => {
    const noTrade = { status: "NO_TRADE", side: "NO_TRADE" } as PaperTrade;
    const open = { status: "OPEN", side: "LONG" } as PaperTrade;
    expect(isActionablePaperTrade(noTrade)).toBe(false);
    expect(isActionablePaperTrade(open)).toBe(true);
  });

  it("strategy layer maps R:R block to TINY_B_BLOCKED_RISK_REWARD", () => {
    expect(mapStrategyLayerBlockToTinyBReason("RISK_REWARD_TOO_WEAK", "TINY_B_SETUP_PAPER_ONLY")).toBe(
      "TINY_B_BLOCKED_RISK_REWARD",
    );
  });

  it("duplicate open symbol maps to TINY_B_BLOCKED_DUPLICATE_SYMBOL", () => {
    const c = nearMissCandidate();
    const decision = evaluatePaperDecision(c);
    const block = resolveTinyBExecutionBlocker({
      candidate: c,
      paperDecision: decision,
      recordCaution: {
        active: false,
        mode: "NORMAL",
        dashboardLabel: "NORMAL",
        dashboardMessage: "ok",
        allocationMultiplier: 1,
        minScoreBoost: 0,
        blockHighVolAlts: false,
        pauseNewEntries: false,
        reasons: [],
      },
      openSlotsAvailable: true,
      maxOpenTradesReached: false,
      symbolAlreadyOpen: true,
    });
    expect(block?.reasonCode).toBe("TINY_B_BLOCKED_DUPLICATE_SYMBOL");
  });

  it("V6 clean start begins at 0 open trades requirement", () => {
    expect(buildCleanFreshStartStatus([]).available).toBe(true);
  });

  it("live trading remains LOCKED", () => {
    expect(verifyPaperSafetyGates().liveTradingLocked).toBe(true);
  });

  it("Auto remains LOCKED", () => {
    expect(verifyPaperSafetyGates().autoExecutionLocked).toBe(true);
  });

  it("all P&L remains SIMULATED", () => {
    expect(verifyPaperSafetyGates().paperPnlSimulated).toBe(true);
  });

  it("near-miss blueprint produces Tiny B decision", () => {
    const c = nearMissCandidate();
    const debug = evaluateAllBlueprintStrategies(c);
    expect(debug.vwapReclaimMomentum.passed).toBe(false);
    expect(evaluatePaperDecision(c).decision).toBe("TINY_B_SETUP_PAPER_ONLY");
  });
});
