import type { FullOpportunityAnalysis } from "@/lib/trading/profit/analyze-opportunity";
import type { TradePermissionResult } from "@/lib/trading/permission/types";

export interface ManualTradeCard {
  id: string;
  status: "ACTIVE" | "WAIT" | "EXPIRED";
  asset: string;
  venue: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  partialTarget: number;
  trailingLogic: string | null;
  size: number | null;
  leverage: number;
  maxPlannedLossPct: number;
  expectedFees: number;
  expectedSlippage: number;
  expectedFunding: number;
  expectedNetReward: number;
  expectedProfitPerUnitRisk: number | null;
  expectedProfitPerHour: number | null;
  timeToTargetMinutes: number | null;
  opportunityCost: number;
  profitDensity: number;
  benchmarkAlpha: number | null;
  monteCarloSurvival: number | null;
  adversarialSurvival: number | null;
  microstructureEdge: number;
  riskReward: number | null;
  strategy: string;
  regime: string;
  sessionQuality: number;
  explosiveScore: number;
  fakeoutRisk: number;
  lateEntryRisk: number;
  confidence: number;
  whyNow: string[];
  whyItCanFail: string[];
  userSteps: string[];
  invalidation: string[];
  skipConditions: string[];
  earlyExitConditions: string[];
  permissionDecision: string;
  createdAt: string;
  expiresAt: string;
}

export function buildManualTradeCard(input: {
  analysis: FullOpportunityAnalysis;
  permission: TradePermissionResult;
  accountEquity: number;
}): ManualTradeCard {
  const { analysis, permission, accountEquity } = input;
  const now = new Date();

  if (
    permission.decision === "WAIT" ||
    permission.decision === "BLOCK" ||
    permission.decision === "NO_EDGE" ||
    analysis.router.permission === "BLOCK"
  ) {
    return waitCard(analysis.symbol, analysis.strategyId, permission.decision, now);
  }

  const size =
    accountEquity *
    (analysis.kelly.riskPerTradePct / 100) /
    Math.max(analysis.stop.stopDistancePct / 100, 0.001);

  const expectedFees =
    (analysis.execution.estimates.takerCostBps / 10_000) * analysis.stop.entryPrice * size;
  const expectedSlippage =
    (analysis.execution.estimates.entrySlippageBps / 10_000) * analysis.stop.entryPrice * size;

  return {
    id: `card-${analysis.symbol}-${now.getTime()}`,
    status: permission.manualAllowed ? "ACTIVE" : "WAIT",
    asset: analysis.symbol,
    venue: analysis.venue.recommendedVenue ?? "kraken",
    direction: analysis.explosive.direction === "short" ? "short" : "long",
    entry: analysis.stop.entryPrice,
    stop: analysis.stop.recommendedStop,
    target: analysis.profitPlan.secondTpPrice,
    partialTarget: analysis.profitPlan.partialTpPrice,
    trailingLogic:
      analysis.profitPlan.trailingStopTriggerR !== null
        ? `Trail after ${analysis.profitPlan.trailingStopTriggerR}R if momentum holds`
        : null,
    size: permission.manualAllowed ? size : null,
    leverage: analysis.leverage.recommendedLeverage,
    maxPlannedLossPct: analysis.kelly.riskPerTradePct,
    expectedFees,
    expectedSlippage,
    expectedFunding: 0,
    expectedNetReward: analysis.router.breakdown.expected_net_profit_after_costs,
    expectedProfitPerUnitRisk: analysis.profitPlan.expectedProfitPerUnitRisk,
    expectedProfitPerHour: analysis.profitPlan.expectedProfitPerHour,
    timeToTargetMinutes: analysis.explosive.scores.time_to_target_estimate_minutes,
    opportunityCost: analysis.profitPlan.opportunityCostScore,
    profitDensity: analysis.profitPlan.profitDensityScore,
    benchmarkAlpha: analysis.router.breakdown.benchmark_alpha_score,
    monteCarloSurvival: analysis.router.breakdown.monte_carlo_survival_score,
    adversarialSurvival: analysis.router.breakdown.adversarial_survival_score,
    microstructureEdge: analysis.microstructure.scores.microstructure_edge_score,
    riskReward: analysis.stop.rewardToRisk,
    strategy: analysis.strategyId,
    regime: analysis.explosive.signalFlags.join(", ") || "unknown",
    sessionQuality: analysis.router.breakdown.session_edge_score,
    explosiveScore: analysis.explosive.scores.explosive_move_score,
    fakeoutRisk: analysis.explosive.scores.fakeout_risk_score,
    lateEntryRisk: analysis.explosive.scores.late_entry_risk_score,
    confidence: analysis.router.profitMaximizationScore,
    whyNow: analysis.explosive.signalFlags,
    whyItCanFail: [
      ...analysis.explosive.rejectReasons,
      ...permission.reasonCodes,
      ...analysis.stop.blockReasons,
    ],
    userSteps: [
      "Confirm permission decision is MANUAL_ONLY or ALLOW",
      "Verify stop at true invalidation before entry",
      "Use limit order at or inside entry zone",
      "Set stop immediately after fill",
      "Take partial at partial target; move stop to breakeven if thesis holds",
    ],
    invalidation: analysis.profitPlan.invalidationConditions,
    skipConditions: permission.reasonCodes,
    earlyExitConditions: analysis.profitPlan.earlyExitConditions,
    permissionDecision: permission.decision,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  };
}

function waitCard(asset: string, strategy: string, decision: string, now: Date): ManualTradeCard {
  return {
    id: `wait-${now.getTime()}`,
    status: "WAIT",
    asset,
    venue: "",
    direction: "long",
    entry: 0,
    stop: 0,
    target: 0,
    partialTarget: 0,
    trailingLogic: null,
    size: null,
    leverage: 1,
    maxPlannedLossPct: 0,
    expectedFees: 0,
    expectedSlippage: 0,
    expectedFunding: 0,
    expectedNetReward: 0,
    expectedProfitPerUnitRisk: null,
    expectedProfitPerHour: null,
    timeToTargetMinutes: null,
    opportunityCost: 0,
    profitDensity: 0,
    benchmarkAlpha: null,
    monteCarloSurvival: null,
    adversarialSurvival: null,
    microstructureEdge: 0,
    riskReward: null,
    strategy,
    regime: "none",
    sessionQuality: 0,
    explosiveScore: 0,
    fakeoutRisk: 0,
    lateEntryRisk: 0,
    confidence: 0,
    whyNow: ["No clean setup — WAIT"],
    whyItCanFail: [decision],
    userSteps: ["Do not enter. Wait for next scan."],
    invalidation: [],
    skipConditions: [decision],
    earlyExitConditions: [],
    permissionDecision: decision,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
}
