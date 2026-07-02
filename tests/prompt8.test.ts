import { describe, expect, it } from "vitest";
import { buildProfitabilityReport } from "@/lib/trading/reports";
import { runSameDayRealityCheck } from "@/lib/trading/reality";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { evaluateLearningAction } from "@/lib/trading/learning";
import { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";
import { evaluateTradePermission } from "@/lib/trading/permission";
import { runShadowExperiment } from "@/lib/trading/experiments";
import { buildTodayMarketProof } from "@/lib/trading/proof/today-proof";
import { buildProfitabilityScorecard } from "@/lib/trading/proof/scorecard";
import { recordBlockedTrade, updateBlockOutcome } from "@/lib/trading/proof/money-protected";
import { createShadowTrade, validateRealtimeSignal } from "@/lib/trading/shadow";
import { openPaperTrade, closePaperTrade } from "@/lib/trading/paper";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { runFinalReadinessCheck } from "@/lib/trading/readiness";
import type { LiveTradeRecord } from "@/lib/trading/live/types";

const basePermission = {
  mode: "AUTO" as const,
  routerHardRejects: [],
  routerPermission: "ALLOW" as const,
  profitMaximizationScore: 70,
  fakeoutRiskScore: 30,
  lateEntryRiskScore: 20,
  explosiveScore: 65,
  executionQualityScore: 75,
  spreadBps: 5,
  liquidityUsd: 2_000_000,
  venueQualityScore: 80,
  dataTradable: true,
  dataStale: false,
  apiHealthy: true,
  stopValid: true,
  leverageRecommended: 1,
  riskOfRuinBlocked: false,
  accountEquity: 10_000,
  expectedEdgeAfterCosts: 10,
  profitDensityScore: 65,
  microstructureDecision: "SUPPORT" as const,
  evidenceLevel: 10,
  proofGateApproved: true,
  autoExecutionEnabled: false,
};

describe("profitability report", () => {
  it("shows net P&L more prominently than gross", () => {
    const trades: LiveTradeRecord[] = [
      {
        id: "1",
        strategyId: "s",
        symbol: "BTC/USD",
        venue: "kraken",
        direction: "long",
        entryTime: "2026-07-01T10:00:00Z",
        exitTime: "2026-07-01T11:00:00Z",
        entryPrice: 100,
        exitPrice: 102,
        size: 1,
        grossPnl: 2,
        fees: 0.5,
        spreadCost: 0.3,
        slippage: 0.2,
        funding: 0.1,
        reconciled: true,
      },
    ];
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_000.9,
      trades,
      evidenceLevel: 10,
      sampleSize: 1,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.realizedNetPnl).toBeLessThan(r.grossPnl);
    expect(r.profitabilityClaim).not.toBe("RECONCILED_EDGE");
    expect(r.annualizationWarning).toContain("Annualization suppressed");
  });

  it("never claims proven profitability without live evidence", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_000,
      trades: [],
      evidenceLevel: 2,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.profitabilityClaim).toBe("NOT_PROVEN");
  });
});

describe("same-day reality check", () => {
  it("never overstates proof at level 0", () => {
    const r = runSameDayRealityCheck({
      evidenceLevel: 0,
      todayProofAvailable: false,
      todayGoNoGoAllows: false,
      paperProfitToday: 100,
      shadowProfitToday: 50,
      liveNetToday: null,
      liveReconciled: false,
      liveTradeCount: 0,
      edgeDecaySeverity: "NONE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: false,
    });
    expect(r.status).toBe("DO_NOT_TRADE_LIVE");
    expect(r.warnings.some((w) => w.includes("Not enough data"))).toBe(true);
    expect(r.paperProfitIsReal).toBe(false);
    expect(r.shadowProfitIsReal).toBe(false);
    expect(r.tinyCanaryIsScalable).toBe(false);
    expect(r.warnings.some((w) => w.includes("paper profit"))).toBe(true);
  });

  it("labels backtest-only correctly", () => {
    const r = runSameDayRealityCheck({
      evidenceLevel: 5,
      todayProofAvailable: true,
      todayGoNoGoAllows: true,
      paperProfitToday: null,
      shadowProfitToday: null,
      liveNetToday: null,
      liveReconciled: false,
      liveTradeCount: 0,
      edgeDecaySeverity: "NONE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: false,
    });
    expect(r.status).toBe("BACKTEST_ONLY");
  });

  it("flags decaying strategy", () => {
    const r = runSameDayRealityCheck({
      evidenceLevel: 11,
      todayProofAvailable: true,
      todayGoNoGoAllows: true,
      paperProfitToday: null,
      shadowProfitToday: null,
      liveNetToday: 10,
      liveReconciled: true,
      liveTradeCount: 25,
      edgeDecaySeverity: "SEVERE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: true,
    });
    expect(r.status).toBe("DECAYING");
  });
});

describe("auto strict unlock", () => {
  it("blocks when insufficient data", () => {
    const r = evaluateAutoUnlock(defaultAutoUnlockInput({ evidenceLevel: 0 }));
    expect(r.autoExecutionEnabled).toBe(false);
    expect(r.decision).toBe("PAPER_ONLY");
  });

  it("never scales on backtest profit alone", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        evidenceLevel: 7,
        backtestPasses: true,
        backtestProfitOnly: true,
        executionEngineWired: true,
        userApprovedAutoStage: true,
      }),
    );
    expect(r.scalingAllowed).toBe(false);
    expect(r.autoExecutionEnabled).toBe(false);
  });

  it("blocks unreconciled P&L", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        evidenceLevel: 11,
        unreconciledPnl: true,
        liveReconciliationPasses: false,
      }),
    );
    expect(r.decision).toBe("REVALIDATION_REQUIRED");
    expect(r.reasonCodes).toContain("RECONCILIATION_REQUIRED");
  });

  it("blocks scale-up after one big live win", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        evidenceLevel: 11,
        oneBigLiveWin: true,
        liveReconciliationPasses: true,
        liveSampleSizePasses: false,
      }),
    );
    expect(r.scalingAllowed).toBe(false);
    expect(["TINY_CANARY_ONLY", "BLOCK", "WATCH"]).toContain(r.decision);
  });

  it("requires execution engine wired", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        evidenceLevel: 12,
        executionEngineWired: false,
        userApprovedAutoStage: true,
        liveReconciliationPasses: true,
        liveSampleSizePasses: true,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
    expect(r.reasonCodes).toContain("EXECUTION_ENGINE_NOT_WIRED");
  });
});

describe("auto blocks via permission engine", () => {
  it("blocks insufficient live sample", () => {
    const r = evaluateTradePermission({
      ...basePermission,
      evidenceLevel: 10,
      reconciliationPassed: false,
    });
    expect(r.reasonCodes).toContain("UNRECONCILED_PNL");
  });

  it("blocks benchmark failure", () => {
    const r = evaluateTradePermission({ ...basePermission, benchmarkAlphaPassed: false });
    expect(r.reasonCodes).toContain("BENCHMARK_ALPHA_FAILED");
  });

  it("blocks Monte Carlo failure", () => {
    const r = evaluateTradePermission({ ...basePermission, monteCarloBlocked: true });
    expect(r.reasonCodes).toContain("MONTE_CARLO_FAILED");
  });

  it("blocks adversarial failure", () => {
    const r = evaluateTradePermission({ ...basePermission, adversarialPassed: false });
    expect(r.reasonCodes).toContain("ADVERSARIAL_TEST_FAILED");
  });

  it("blocks beta-not-alpha", () => {
    const r = evaluateTradePermission({ ...basePermission, betaNotAlpha: true });
    expect(r.reasonCodes).toContain("BETA_NOT_ALPHA");
  });

  it("blocks weak today proof", () => {
    const r = evaluateTradePermission({ ...basePermission, todayProofWeak: true });
    expect(r.reasonCodes).toContain("TODAY_PROOF_WEAK");
  });

  it("blocks edge decay", () => {
    const r = evaluateTradePermission({ ...basePermission, edgeDecayDetected: true });
    expect(r.reasonCodes).toContain("EDGE_DECAY_DETECTED");
  });

  it("blocks microstructure conflict", () => {
    const r = evaluateTradePermission({
      ...basePermission,
      microstructureDecision: "CONTRADICT",
    });
    expect(r.reasonCodes).toContain("MICROSTRUCTURE_CONFLICT");
  });

  it("blocks low profit density", () => {
    const r = evaluateTradePermission({ ...basePermission, profitDensityScore: 20 });
    expect(r.reasonCodes).toContain("PROFIT_DENSITY_TOO_LOW");
  });

  it("blocks high risk of ruin", () => {
    const r = evaluateTradePermission({ ...basePermission, riskOfRuinBlocked: true });
    expect(r.reasonCodes).toContain("RISK_OF_RUIN_TOO_HIGH");
  });

  it("blocks stale data", () => {
    const r = evaluateTradePermission({ ...basePermission, dataStale: true });
    expect(r.reasonCodes).toContain("DATA_STALE");
  });

  it("blocks when auto locked", () => {
    const r = evaluateTradePermission({ ...basePermission, autoExecutionEnabled: false });
    expect(r.reasonCodes).toContain("AUTO_LOCKED");
  });
});

describe("bounded learning", () => {
  it("cannot increase risk", () => {
    const r = evaluateLearningAction({ action: "INCREASE_RISK" });
    expect(r.allowed).toBe(false);
    expect(r.requiresUserApproval).toBe(true);
  });

  it("cannot approve Auto", () => {
    const r = evaluateLearningAction({ action: "APPROVE_AUTO" });
    expect(r.allowed).toBe(false);
  });

  it("cannot martingale", () => {
    const r = evaluateLearningAction({ action: "MARTINGALE" });
    expect(r.allowed).toBe(false);
  });
});

describe("shadow and paper integrity", () => {
  it("shadow experiment cannot place live orders", () => {
    const r = runShadowExperiment({
      signalTimestamp: new Date().toISOString(),
      proposedStrategyId: "new",
      approvedStrategyId: "old",
      symbol: "BTC/USD",
      venue: "kraken",
      direction: "long",
      entryPrice: 100,
      stopPrice: 98,
      targetPrices: [102],
      spreadBps: 5,
      entryWouldFill: true,
    });
    expect(r.affectsLiveAuto).toBe(false);
    expect(r.canApprove).toBe(false);
  });

  it("shadow trades must be timestamped before outcome", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    expect(validateRealtimeSignal(old)).toContain("RETROACTIVE_SHADOW_REJECTED");
  });

  it("today paper profit is not real profit", () => {
    const r = runSameDayRealityCheck({
      evidenceLevel: 8,
      todayProofAvailable: true,
      todayGoNoGoAllows: true,
      paperProfitToday: 500,
      shadowProfitToday: null,
      liveNetToday: null,
      liveReconciled: false,
      liveTradeCount: 0,
      edgeDecaySeverity: "NONE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: false,
    });
    expect(r.paperProfitIsReal).toBe(false);
    expect(r.status).toBe("PAPER_ONLY");
  });

  it("tiny canary cannot be labeled scalable", () => {
    const r = runSameDayRealityCheck({
      evidenceLevel: 10,
      todayProofAvailable: true,
      todayGoNoGoAllows: true,
      paperProfitToday: null,
      shadowProfitToday: null,
      liveNetToday: 5,
      liveReconciled: true,
      liveTradeCount: 3,
      edgeDecaySeverity: "NONE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: false,
    });
    expect(r.tinyCanaryIsScalable).toBe(false);
  });
});

describe("money protected", () => {
  it("records money protected when blocked trades later lose", () => {
    const block = recordBlockedTrade({
      symbol: "BTC/USD",
      strategyId: "s",
      blockReason: "NO_EDGE",
      blockCategory: "blockedByRisk",
      signalTimestamp: new Date().toISOString(),
      estimatedLossAvoided: 5,
    });
    const updated = updateBlockOutcome(block, "LOST");
    expect(updated.laterOutcome).toBe("LOST");
    expect(block.estimatedLossAvoided).toBe(5);
  });
});

describe("scorecard penalizes missing reconciliation", () => {
  it("flags unreconciled at live evidence levels", () => {
    const r = buildProfitabilityScorecard({
      period: "2026-07",
      evidenceLevel: 11,
      dataQualityScore: 80,
      signalQualityScore: 70,
      executionQualityScore: 75,
      fillRealismScore: 70,
      sampleSize: 25,
      maxDrawdownPct: 5,
      liveReconciled: false,
      edgeDecayDetected: false,
      regimeBreadth: 2,
      alphaBeta: null,
      paperSummary: null,
      luckyTradeDominance: null,
      costDragPct: 10,
    });
    expect(r.reasonCodes).toContain("UNRECONCILED_PNL");
  });
});

describe("auto execution evaluation", () => {
  it("remains locked without execution engine", () => {
    const r = evaluateAutoExecution({
      emergencyPaused: false,
      autoSelected: true,
      currentMode: "AUTO",
      evidenceLevel: 12,
      evidenceAutoAllowed: true,
      sameDayEvidencePresent: true,
      liveEvidencePresent: true,
      reconciliationPassed: true,
    });
    expect(r.autoExecutionEnabled).toBe(false);
  });
});

describe("final readiness", () => {
  it("reports auto execution as not implemented", () => {
    const r = runFinalReadinessCheck();
    const autoExec = r.items.find((i) => i.id === "auto_execution");
    expect(autoExec?.status).toBe("FAIL");
    expect(r.items.some((i) => i.id === "profit_report" && i.status === "PASS")).toBe(true);
  });
});

describe("NO_EDGE_TODAY", () => {
  it("returns WAIT when no valid setup", () => {
    const r = evaluateTradePermission({
      ...basePermission,
      mode: "MANUAL",
      explosiveScore: 20,
      profitMaximizationScore: 30,
    });
    expect(["WAIT", "NO_EDGE", "WATCH_ONLY"]).toContain(r.decision);
  });
});
