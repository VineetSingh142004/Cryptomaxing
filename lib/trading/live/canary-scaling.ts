import type {
  CanaryScalingInput,
  CanaryScalingResult,
  CanaryStage,
} from "@/lib/trading/live/types";
import { STAGE_ORDER } from "@/lib/trading/live/sample-confidence";

const RISK_BANDS: Record<CanaryStage, { min: number; max: number } | null> = {
  NO_LIVE: null,
  TINY_CANARY: { min: 0.01, max: 0.02 },
  MICRO_LIVE: { min: 0.05, max: 0.1 },
  SMALL_LIVE: { min: 0.1, max: 0.25 },
  CONTROLLED_LIVE: { min: 0.25, max: 0.5 },
  NORMAL_AUTO: { min: 0.5, max: 1.0 },
};

function stageIndex(s: CanaryStage): number {
  return STAGE_ORDER.indexOf(s);
}

export function evaluateCanaryScaling(input: CanaryScalingInput): CanaryScalingResult {
  const reasonCodes: string[] = [];
  const from = input.currentStage;
  const requested = input.requestedStage;
  const fromIdx = stageIndex(from);
  const reqIdx = stageIndex(requested);

  if (reqIdx > fromIdx + 1) {
    return {
      strategyId: input.strategyId,
      fromStage: from,
      toStage: from,
      direction: "BLOCKED",
      accountRiskBandPct: RISK_BANDS[from],
      reasonCodes: ["NEVER_JUMP_STAGES"],
      requiresUserApproval: true,
      decidedAt: new Date().toISOString(),
    };
  }

  if (reqIdx < fromIdx) {
    return {
      strategyId: input.strategyId,
      fromStage: from,
      toStage: requested,
      direction: "SCALE_DOWN",
      accountRiskBandPct: RISK_BANDS[requested],
      reasonCodes: ["AUTOMATIC_SCALE_DOWN"],
      requiresUserApproval: false,
      decidedAt: new Date().toISOString(),
    };
  }

  if (reqIdx === fromIdx) {
    return {
      strategyId: input.strategyId,
      fromStage: from,
      toStage: from,
      direction: "HOLD",
      accountRiskBandPct: RISK_BANDS[from],
      reasonCodes: [],
      requiresUserApproval: false,
      decidedAt: new Date().toISOString(),
    };
  }

  const blocks: [boolean | undefined, string][] = [
    [input.oneBigWinDetected, "ONE_BIG_WIN"],
    [input.luckyStreakWithoutSample, "LUCKY_STREAK_NO_SAMPLE"],
    [input.liveSlippageWorseThanModel, "LIVE_SLIPPAGE_WORSE_THAN_MODEL"],
    [input.audit.maxDrawdown > (input.audit.liveExpectancy ?? 0) * 20 + 50, "DRAWDOWN_EXCEEDS"],
    [input.profitableBeforeFeesOnly, "PROFITABLE_BEFORE_FEES_ONLY"],
    [input.stopExecutionUnreliable, "STOP_EXECUTION_UNRELIABLE"],
    [input.exchangeReliabilityPoor, "EXCHANGE_RELIABILITY_POOR"],
    [!input.sample.scalingAllowed, "SAMPLE_NOT_READY"],
    [stageIndex(input.sample.maxAllowedStage) < reqIdx, "EXCEEDS_MAX_ALLOWED_STAGE"],
    [input.audit.decision === "DISABLE_AUTO", "AUDIT_DISABLE_AUTO"],
    [input.audit.decision === "DEMOTE", "AUDIT_DEMOTE"],
    [!input.userApproved, "USER_APPROVAL_REQUIRED"],
  ];

  for (const [cond, code] of blocks) {
    if (cond) reasonCodes.push(code);
  }

  if (reasonCodes.length > 0) {
    return {
      strategyId: input.strategyId,
      fromStage: from,
      toStage: from,
      direction: "BLOCKED",
      accountRiskBandPct: RISK_BANDS[from],
      reasonCodes,
      requiresUserApproval: !input.userApproved,
      decidedAt: new Date().toISOString(),
    };
  }

  return {
    strategyId: input.strategyId,
    fromStage: from,
    toStage: requested,
    direction: "SCALE_UP",
    accountRiskBandPct: RISK_BANDS[requested],
    reasonCodes: ["STAGE_EARNED"],
    requiresUserApproval: true,
    decidedAt: new Date().toISOString(),
  };
}

export function autoScaleDownTriggers(input: {
  audit: CanaryScalingInput["audit"];
  decaySeverity?: "MILD" | "MODERATE" | "SEVERE";
}): CanaryStage | null {
  if (input.decaySeverity === "SEVERE") return "NO_LIVE";
  if (input.audit.decision === "DISABLE_AUTO") return "TINY_CANARY";
  if (input.audit.decision === "DEMOTE" || input.decaySeverity === "MODERATE") return "MICRO_LIVE";
  if (input.audit.decision === "REDUCE" || input.decaySeverity === "MILD") {
    return null;
  }
  return null;
}

export { RISK_BANDS };
