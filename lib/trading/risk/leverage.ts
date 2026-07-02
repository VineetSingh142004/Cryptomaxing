import type { LeverageInput, LeverageIntelligenceResult } from "@/lib/trading/risk/types";

const LEVERAGE_BANDS = {
  default: 1,
  strong: 2,
  highQuality: 3,
  exceptional: 5,
  maxAllowed: 5,
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function computeLeverageIntelligence(input: LeverageInput): LeverageIntelligenceResult {
  const {
    stop,
    execution,
    features,
    accountEquity,
    proofGateApproved = false,
    riskOfRuinApproved = false,
    losingStreak = 0,
    sessionExpectancyPositive = true,
    liveDriftDetected = false,
    expectedRewardPct = 0,
  } = input;

  const blockReasons: string[] = [];
  const gatesPassed: string[] = [];
  const gatesFailed: string[] = [];

  if (stop.decision === "VALID") gatesPassed.push("EXECUTABLE_STOP");
  else gatesFailed.push("STOP_INVALID");

  if (stop.liquidationPrice !== null || input.entryPrice > 0) {
    gatesPassed.push("LIQUIDATION_KNOWN");
  }

  const stopGap = stop.stopToLiquidationGapPct;
  if (stopGap === null || stopGap >= stop.stopDistancePct) {
    gatesPassed.push("STOP_FAR_FROM_LIQUIDATION");
  } else {
    gatesFailed.push("STOP_NEAR_LIQUIDATION");
  }

  const totalCostBps =
    execution.estimates.takerCostBps +
    execution.estimates.entrySlippageBps +
    execution.estimates.exitSlippageBps;
  const rewardVsCost = expectedRewardPct > 0 ? (expectedRewardPct * 100) / totalCostBps : 0;
  if (rewardVsCost >= 3) gatesPassed.push("REWARD_GT_COSTS");
  else gatesFailed.push("REWARD_LT_COSTS");

  if (features.execution.exitLiquidity > accountEquity * 0.1) gatesPassed.push("SUFFICIENT_LIQUIDITY");
  else gatesFailed.push("INSUFFICIENT_LIQUIDITY");

  if (features.volatility.realizedVolatility < 5) gatesPassed.push("ACCEPTABLE_VOLATILITY");
  else if (features.volatility.realizedVolatility > 8) gatesFailed.push("VOLATILITY_TOO_HIGH");

  if (proofGateApproved) gatesPassed.push("PROOF_GATE");
  else gatesFailed.push("PROOF_GATE");

  if (riskOfRuinApproved) gatesPassed.push("RISK_OF_RUIN");
  else gatesFailed.push("RISK_OF_RUIN");

  if (execution.decision === "ALLOW") gatesPassed.push("EXECUTION_QUALITY");
  else gatesFailed.push("EXECUTION_QUALITY");

  const volAdj = clamp(5 - features.volatility.realizedVolatility, 1, 5);
  const accountAdj = accountEquity >= 50_000 ? 1.2 : accountEquity >= 10_000 ? 1 : 0.8;
  const proofAdj = proofGateApproved ? 1 : 0.5;
  const streakAdj = losingStreak >= 3 ? 0.5 : losingStreak >= 2 ? 0.7 : 1;
  const sessionAdj = sessionExpectancyPositive ? 1 : 0.6;
  const driftAdj = liveDriftDetected ? 0.5 : 1;

  let baseLeverage = LEVERAGE_BANDS.default;
  const setupQuality =
    (execution.executionQualityScore / 100) * 0.4 +
    (stop.rewardToRisk ?? 0) * 0.2 +
    (rewardVsCost / 10) * 0.2 +
    (stopGap !== null ? Math.min(stopGap / 5, 1) : 0) * 0.2;

  if (setupQuality >= 0.85 && gatesFailed.length === 0) baseLeverage = LEVERAGE_BANDS.exceptional;
  else if (setupQuality >= 0.7 && gatesFailed.length <= 1) baseLeverage = LEVERAGE_BANDS.highQuality;
  else if (setupQuality >= 0.55) baseLeverage = LEVERAGE_BANDS.strong;

  const adjusted =
    baseLeverage * proofAdj * streakAdj * sessionAdj * driftAdj * (volAdj / 3) * accountAdj;
  const maxSafeLeverage = clamp(Math.floor(adjusted), 1, LEVERAGE_BANDS.maxAllowed);
  const recommendedLeverage = gatesFailed.length > 2 ? 1 : maxSafeLeverage;

  if (recommendedLeverage > LEVERAGE_BANDS.maxAllowed) blockReasons.push("LEVERAGE_ABOVE_5X_BLOCKED");
  if (gatesFailed.includes("PROOF_GATE")) blockReasons.push("NO_PROOF_GATE");
  if (gatesFailed.includes("STOP_INVALID")) blockReasons.push("NO_CLEAN_ENTRY");
  if (gatesFailed.includes("EXECUTION_QUALITY")) blockReasons.push("EXECUTION_NOT_APPROVED");

  return {
    maxSafeLeverage,
    recommendedLeverage: clamp(recommendedLeverage, 1, LEVERAGE_BANDS.maxAllowed),
    liquidationPrice: stop.liquidationPrice,
    stopDistancePct: stop.stopDistancePct,
    stopToLiquidationGapPct: stop.stopToLiquidationGapPct,
    volatilityAdjustedLeverage: volAdj,
    accountSizeAdjustedLeverage: accountAdj,
    proofAdjustedLeverage: proofAdj,
    losingStreakAdjustedLeverage: streakAdj,
    sessionAdjustedLeverage: sessionAdj,
    liveDriftAdjustedLeverage: driftAdj,
    decision: blockReasons.length > 0 && recommendedLeverage > 1 ? "BLOCK" : "ALLOW",
    blockReasons,
    gatesPassed,
    gatesFailed,
    computedAt: new Date().toISOString(),
  };
}
