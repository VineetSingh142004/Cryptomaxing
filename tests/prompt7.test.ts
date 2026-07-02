import { describe, expect, it } from "vitest";
import { evaluateTradePermission } from "@/lib/trading/permission";
import { evaluateLifecycleTransition } from "@/lib/trading/strategy-lifecycle";
import { runShadowExperiment } from "@/lib/trading/experiments";
import { evaluateEmergencyPlaybook } from "@/lib/trading/emergency";
import { evaluateSmallAccountMode } from "@/lib/trading/accounts/small-account";
import { evaluateMemeSurvival } from "@/lib/trading/accounts/meme-survival";
import { buildManualTradeCard } from "@/lib/trading/cards/builder";

const basePermissionInput = {
  mode: "MANUAL" as const,
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
  evidenceLevel: 8,
  proofGateApproved: true,
};

describe("trade permission engine", () => {
  it("blocks on unreconciled P&L", () => {
    const r = evaluateTradePermission({ ...basePermissionInput, reconciliationPassed: false });
    expect(r.reasonCodes).toContain("UNRECONCILED_PNL");
    expect(r.autoAllowed).toBe(false);
  });

  it("returns WAIT when no edge", () => {
    const r = evaluateTradePermission({
      ...basePermissionInput,
      explosiveScore: 30,
      profitMaximizationScore: 40,
    });
    expect(["WAIT", "NO_EDGE", "WATCH_ONLY"]).toContain(r.decision);
  });
});

describe("strategy lifecycle", () => {
  it("cooldowns after 3 losses", () => {
    const r = evaluateLifecycleTransition({
      strategyId: "s",
      current: {
        strategyId: "s",
        stage: "MANUAL_APPROVED",
        consecutiveLosses: 0,
        drawdownPct: 0,
        fakeoutRate: 0,
        slippageVsModel: 0,
        liveExpectancy: 1,
        profitFactor: 1.5,
        vsRandomBaseline: 1,
        parameterVersion: "v1",
        priorParameterVersion: null,
        cooldownUntil: null,
        reasonCodes: [],
        updatedAt: new Date().toISOString(),
      },
      degradation: { lossesInRow: 3 },
    });
    expect(r.toStage).toBe("COOLDOWN");
    expect(r.action).toBe("COOLDOWN");
  });
});

describe("shadow experiment", () => {
  it("cannot approve itself", () => {
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
    expect(r.canApprove).toBe(false);
    expect(r.affectsLiveAuto).toBe(false);
  });
});

describe("emergency playbook", () => {
  it("blocks entries when no position and API outage", () => {
    const r = evaluateEmergencyPlaybook({
      failures: ["API_OUTAGE"],
      hasOpenPosition: false,
      stopStatusKnown: true,
      cancelConfirmed: true,
      positionCertain: true,
      duplicateOrderRisk: false,
      allProvidersFailed: true,
      emergencyExitFailed: false,
      reconciliationMismatch: false,
    });
    expect(r.blockNewTrades).toBe(true);
    expect(r.freezeEntries).toBe(true);
  });
});

describe("small account mode", () => {
  it("defaults to paper for $25 account", () => {
    const r = evaluateSmallAccountMode({
      accountEquityUsd: 15,
      spreadBps: 10,
      feeBps: 26,
      minOrderSizeUsd: 5,
    });
    expect(r.paperModeDefault).toBe(true);
    expect(r.leverageAllowed).toBe(false);
  });
});

describe("meme survival", () => {
  it("blocks honeypot", () => {
    const r = evaluateMemeSurvival({
      symbol: "SCAM/USD",
      security: { symbol: "SCAM", isHoneypot: true, buyTax: null, sellTax: null, isVerified: false, riskScore: 99, source: "test", checkedAt: "" },
      exitLiquidityUsd: 1_000_000,
      spreadBps: 10,
      relativeVolume: 1,
      mode: "AUTO",
    });
    expect(r.grade).toBe("F");
    expect(r.autoEligible).toBe(false);
  });
});

describe("manual trade card", () => {
  it("returns WAIT card when permission blocks", () => {
    const card = buildManualTradeCard({
      analysis: {
        symbol: "BTC/USD",
        strategyId: "test",
        router: { permission: "BLOCK", profitMaximizationScore: 30, hardRejects: ["X"], breakdown: {} },
      } as never,
      permission: { decision: "BLOCK", manualAllowed: false, reasonCodes: ["BLOCK"] } as never,
      accountEquity: 10_000,
    });
    expect(card.status).toBe("WAIT");
  });
});
