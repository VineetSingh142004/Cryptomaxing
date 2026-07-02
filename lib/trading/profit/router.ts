import type { ComputedFeatures } from "@/lib/trading/features/compute";
import type { DataQualityAssessment } from "@/lib/trading/data/types";
import type { ExplosiveMoveScanResult } from "@/lib/trading/scanning/types";
import type { MicrostructureEdgeResult } from "@/lib/trading/scanning/types";
import type { TrueInvalidationStopResult } from "@/lib/trading/stops/true-invalidation";
import type { ExecutionQualityResult, VenueRoutingResult } from "@/lib/trading/execution/types";
import type { LeverageIntelligenceResult, KellySizingResult, DailyGuardrailResult } from "@/lib/trading/risk/types";
import type { ProfitPlan } from "@/lib/trading/profit/profit-plan";
import type { BacktestMetrics, MonteCarloResult } from "@/lib/trading/research/types";
import type { SessionEdgeStats } from "@/lib/trading/research/types";

export interface ProfitRouterInput {
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  correlationGroup: string;
  explosive: ExplosiveMoveScanResult;
  microstructure: MicrostructureEdgeResult;
  stop: TrueInvalidationStopResult;
  execution: ExecutionQualityResult;
  venue: VenueRoutingResult;
  leverage: LeverageIntelligenceResult;
  kelly: KellySizingResult;
  daily: DailyGuardrailResult;
  profitPlan: ProfitPlan;
  features: ComputedFeatures;
  dataQuality: DataQualityAssessment;
  strategyMetrics?: BacktestMetrics | null;
  monteCarlo?: MonteCarloResult | null;
  adversarialPassed?: boolean;
  benchmarkAlphaPassed?: boolean;
  sessionEdge?: SessionEdgeStats | null;
  liveDriftDetected?: boolean;
  edgeDecayDetected?: boolean;
  accountEquity: number;
}

export interface ProfitMaximizationBreakdown {
  expected_net_profit_after_costs: number;
  expected_profit_per_unit_risk: number;
  expected_profit_per_unit_margin: number;
  expected_profit_per_hour: number;
  explosive_move_score: number;
  microstructure_edge_score: number;
  liquidity_score: number;
  execution_quality_score: number;
  venue_quality_score: number;
  leverage_safety_score: number;
  stop_quality_score: number;
  true_invalidation_score: number;
  strategy_expectancy_score: number;
  session_edge_score: number;
  benchmark_alpha_score: number;
  monte_carlo_survival_score: number;
  adversarial_survival_score: number;
  capital_efficiency_score: number;
  fakeout_penalty: number;
  late_entry_penalty: number;
  drawdown_penalty: number;
  opportunity_cost_penalty: number;
  live_drift_penalty: number;
  risk_of_ruin_penalty: number;
  edge_decay_penalty: number;
}

export interface ProfitRouterResult {
  symbol: string;
  strategyId: string;
  profitMaximizationScore: number;
  breakdown: ProfitMaximizationBreakdown;
  decision: "RANK" | "REJECT" | "WAIT";
  hardRejects: string[];
  softPenalties: string[];
  permission: "ALLOW" | "BLOCK" | "WAIT";
  rankedAt: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function routeProfitOpportunity(input: ProfitRouterInput): ProfitRouterResult {
  const hardRejects: string[] = [];
  const softPenalties: string[] = [];

  const totalCostBps =
    input.execution.estimates.takerCostBps +
    input.execution.estimates.entrySlippageBps +
    input.execution.estimates.exitSlippageBps;

  const expectedRewardPct = input.stop.rewardToRisk
    ? input.stop.stopDistancePct * input.stop.rewardToRisk
    : input.profitPlan.expectedProfitPerUnitRisk * input.stop.stopDistancePct;

  const rewardVsCost = totalCostBps > 0 ? (expectedRewardPct * 100) / totalCostBps : 0;
  if (rewardVsCost < 3) hardRejects.push("REWARD_LT_3X_COST");

  if (input.explosive.decision === "REJECT") hardRejects.push("EXPLOSIVE_REJECT");
  if (input.explosive.scores.late_entry_risk_score > 65) hardRejects.push("LATE_ENTRY");
  if (input.explosive.scores.fakeout_risk_score > 70) hardRejects.push("FAKEOUT_HIGH");
  if (isSpreadWide(input.features)) hardRejects.push("SPREAD_WIDE");
  if ((input.features.execution.exitLiquidity ?? 0) < 500_000) hardRejects.push("LIQUIDITY_LOW");
  if (input.venue.decision === "BLOCK") hardRejects.push("BAD_VENUE");
  if (input.stop.decision === "BLOCK") hardRejects.push("STOP_MISSING_OR_INVALID");
  if (input.stop.blockReasons.includes("STOP_TOO_CLOSE_TO_LIQUIDATION")) {
    hardRejects.push("STOP_NEAR_LIQUIDATION");
  }
  if (input.strategyMetrics?.expectancy !== null && (input.strategyMetrics?.expectancy ?? 0) < 0) {
    hardRejects.push("STRATEGY_PROOF_INSUFFICIENT");
  }
  if (input.sessionEdge?.recommendation === "BLOCK") hardRejects.push("SESSION_EXPECTANCY_NEGATIVE");
  if (input.liveDriftDetected) hardRejects.push("LIVE_DRIFT");
  if (input.edgeDecayDetected) hardRejects.push("EDGE_DECAY");
  if (input.kelly.decision === "BLOCK") hardRejects.push("RISK_OF_RUIN_TOO_HIGH");
  if (!input.dataQuality.tradable) hardRejects.push("DATA_STALE");
  if (input.dataQuality.reasonCodes.includes("ORDER_BOOK_STALE")) hardRejects.push("ORDER_BOOK_UNSYNCED");
  if (input.benchmarkAlphaPassed === false) hardRejects.push("BENCHMARK_ALPHA_FAILED");
  if (input.monteCarlo?.blocked) hardRejects.push("MONTE_CARLO_SURVIVAL_FAILED");
  if (input.adversarialPassed === false) hardRejects.push("ADVERSARIAL_SURVIVAL_FAILED");
  if (input.execution.executionQualityScore < 45) hardRejects.push("EXECUTION_QUALITY_TOO_LOW");
  if (input.microstructure.decision === "BLOCK") hardRejects.push("MICROSTRUCTURE_BLOCK");
  if (!input.daily.liveTradingAllowed) hardRejects.push("DAILY_GUARDRAIL_PAUSE");

  const fakeout_penalty = input.explosive.scores.fakeout_risk_score * 0.3;
  const late_entry_penalty = input.explosive.scores.late_entry_risk_score * 0.25;
  const drawdown_penalty = (input.kelly.maxExpectedDrawdownPct ?? 0) * 2;
  const opportunity_cost_penalty = 100 - input.profitPlan.opportunityCostScore;
  const live_drift_penalty = input.liveDriftDetected ? 25 : 0;
  const risk_of_ruin_penalty = (input.kelly.accountRiskOfRuin ?? 0) * 100;
  const edge_decay_penalty = input.edgeDecayDetected ? 20 : 0;

  const expected_net_profit_after_costs = clamp(
    expectedRewardPct * 10 - totalCostBps * 0.5,
  );

  const breakdown: ProfitMaximizationBreakdown = {
    expected_net_profit_after_costs,
    expected_profit_per_unit_risk: input.profitPlan.expectedProfitPerUnitRisk ?? 0,
    expected_profit_per_unit_margin: (input.profitPlan.expectedProfitPerUnitMargin ?? 0) * 10,
    expected_profit_per_hour: clamp((input.profitPlan.expectedProfitPerHour ?? 0) / 100),
    explosive_move_score: input.explosive.scores.explosive_move_score,
    microstructure_edge_score: input.microstructure.scores.microstructure_edge_score,
    liquidity_score: clamp(input.features.execution.exitLiquidity / 100_000),
    execution_quality_score: input.execution.executionQualityScore,
    venue_quality_score: input.venue.edgeAfterExecutionScore ?? 0,
    leverage_safety_score: clamp(100 - (input.leverage.recommendedLeverage - 1) * 15),
    stop_quality_score: input.stop.decision === "VALID" ? clamp((input.stop.rewardToRisk ?? 1) * 30) : 0,
    true_invalidation_score: input.stop.candidates.length > 3 ? 75 : 50,
    strategy_expectancy_score: input.strategyMetrics?.expectancy
      ? clamp(50 + input.strategyMetrics.expectancy * 100)
      : 40,
    session_edge_score:
      input.sessionEdge?.recommendation === "PREFER"
        ? 80
        : input.sessionEdge?.recommendation === "BLOCK"
          ? 20
          : 50,
    benchmark_alpha_score: input.benchmarkAlphaPassed === true ? 80 : input.benchmarkAlphaPassed === false ? 10 : 50,
    monte_carlo_survival_score: input.monteCarlo?.blocked ? 20 : clamp(100 - (input.monteCarlo?.probAccountRuin ?? 0) * 100),
    adversarial_survival_score: input.adversarialPassed === true ? 75 : input.adversarialPassed === false ? 15 : 50,
    capital_efficiency_score: input.profitPlan.profitDensityScore,
    fakeout_penalty,
    late_entry_penalty,
    drawdown_penalty,
    opportunity_cost_penalty,
    live_drift_penalty,
    risk_of_ruin_penalty,
    edge_decay_penalty,
  };

  const profitMaximizationScore = clamp(
    breakdown.expected_net_profit_after_costs * 0.12 +
      breakdown.expected_profit_per_unit_risk * 8 +
      breakdown.expected_profit_per_hour * 0.15 +
      breakdown.explosive_move_score * 0.1 +
      breakdown.microstructure_edge_score * 0.08 +
      breakdown.liquidity_score * 0.05 +
      breakdown.execution_quality_score * 0.08 +
      breakdown.venue_quality_score * 0.05 +
      breakdown.leverage_safety_score * 0.04 +
      breakdown.stop_quality_score * 0.05 +
      breakdown.capital_efficiency_score * 0.08 +
      breakdown.session_edge_score * 0.04 +
      input.microstructure.tradeScoreModifier -
      fakeout_penalty * 0.1 -
      late_entry_penalty * 0.08 -
      drawdown_penalty * 0.05 -
      opportunity_cost_penalty * 0.05 -
      live_drift_penalty * 0.1 -
      risk_of_ruin_penalty * 0.1 -
      edge_decay_penalty * 0.08,
  );

  if (fakeout_penalty > 20) softPenalties.push("FAKEOUT_PENALTY");
  if (late_entry_penalty > 15) softPenalties.push("LATE_ENTRY_PENALTY");

  let decision: ProfitRouterResult["decision"] = "RANK";
  let permission: ProfitRouterResult["permission"] = "ALLOW";

  if (hardRejects.length > 0) {
    decision = "REJECT";
    permission = "BLOCK";
  } else if (profitMaximizationScore < 50) {
    decision = "WAIT";
    permission = "WAIT";
  } else if (input.daily.setupFilter === "A_PLUS_ONLY" && profitMaximizationScore < 70) {
    decision = "WAIT";
    permission = "WAIT";
  }

  return {
    symbol: input.symbol,
    strategyId: input.strategyId,
    profitMaximizationScore,
    breakdown,
    decision,
    hardRejects,
    softPenalties,
    permission,
    rankedAt: new Date().toISOString(),
  };
}

export function isSpreadWide(features: ComputedFeatures, threshold = 20): boolean {
  return (features.orderBook?.spreadBps ?? 0) > threshold;
}
