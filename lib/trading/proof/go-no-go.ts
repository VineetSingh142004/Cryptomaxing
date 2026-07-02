import type { EvidenceLevelNumber, GoNoGoDecision, ProfitabilityScorecard, TodayMarketProof } from "@/lib/trading/proof/types";
import type { TodayAlphaBetaResult } from "@/lib/trading/proof/alpha-beta";
import type { PaperDailySummary } from "@/lib/trading/paper/types";
import { canPromoteOneStage } from "@/lib/trading/proof/evidence-level";

export interface GoNoGoInput {
  reportDate: string;
  currentEvidenceLevel: EvidenceLevelNumber;
  todayProof: TodayMarketProof;
  alphaBeta: TodayAlphaBetaResult | null;
  paperSummary: PaperDailySummary | null;
  scorecard: ProfitabilityScorecard;
  consecutiveCleanPaperDays?: number;
  tinyCanaryPassed?: boolean;
  sampleSize?: number;
  drawdownThresholdPct?: number;
  edgeDecayDetected?: boolean;
}

export interface GoNoGoResult {
  reportDate: string;
  decision: GoNoGoDecision;
  proposedEvidenceLevel: EvidenceLevelNumber;
  reasonCodes: string[];
  gatesPassed: string[];
  gatesFailed: string[];
  decidedAt: string;
}

export function decideGoNoGo(input: GoNoGoInput): GoNoGoResult {
  const reasonCodes: string[] = [];
  const gatesPassed: string[] = [];
  const gatesFailed: string[] = [];
  const ddThreshold = input.drawdownThresholdPct ?? 3;

  let decision: GoNoGoDecision = "HOLD_CURRENT_STAGE";
  let proposed = input.currentEvidenceLevel;

  const paper = input.paperSummary;
  const alpha = input.alphaBeta;

  if (input.scorecard.status === "DISABLED" || input.scorecard.status === "BAD_DATA") {
    return buildResult("DISABLE_STRATEGY", input.currentEvidenceLevel, ["BAD_DATA_OR_DISABLED"], gatesPassed, gatesFailed, input.reportDate);
  }

  if (alpha?.flags.includes("BETA_NOT_ALPHA")) {
    gatesFailed.push("BETA_PROFIT");
    decision = "SCALE_DOWN";
    reasonCodes.push("BETA_NOT_ALPHA");
  }

  if (alpha?.flags.includes("NO_SIGNAL_EDGE")) {
    gatesFailed.push("NO_SIGNAL");
    decision = "RESEARCH_ONLY";
    reasonCodes.push("NO_SIGNAL_EDGE");
  }

  if (alpha?.flags.includes("COST_KILLED")) {
    gatesFailed.push("COSTS");
    decision = "CONTINUE_PAPER";
    reasonCodes.push("COST_KILLED");
  }

  if (paper && paper.maxDrawdown > ddThreshold) {
    gatesFailed.push("DRAWDOWN");
    decision = "SCALE_DOWN";
    reasonCodes.push("DRAWDOWN_EXCEEDED");
  }

  if (input.todayProof.verdict === "NO_EDGE_TODAY") {
    const protectedDay = input.todayProof.moneyProtected > 0;
    decision = protectedDay ? "HOLD_CURRENT_STAGE" : "CONTINUE_SHADOW";
    reasonCodes.push("NO_EDGE_TODAY");
  }

  if (input.todayProof.verdict === "EDGE_FOUND_EXECUTION_FAILED") {
    decision = "CONTINUE_PAPER";
    reasonCodes.push("EXECUTION_FAILED");
  }

  if (input.scorecard.categories.fillRealismScore < 45) {
    gatesFailed.push("FILL_REALISM");
    decision = "CONTINUE_PAPER";
    reasonCodes.push("PAPER_NOT_REALISTICALLY_FILLABLE");
  }

  if (paper && paper.tradeCount === 1 && paper.netPnl > 0) {
    gatesFailed.push("ONE_LUCKY_TRADE");
    reasonCodes.push("ONE_DAY_LUCKY_TRADE");
    decision = "HOLD_CURRENT_STAGE";
  }

  if (
    (input.consecutiveCleanPaperDays ?? 0) >= 3 &&
    input.currentEvidenceLevel === 8 &&
    canPromoteOneStage(8, 9)
  ) {
    gatesPassed.push("MULTI_DAY_PAPER_SHADOW");
    decision = "TINY_CANARY_ELIGIBLE";
    proposed = 9;
    reasonCodes.push("RECOMMEND_TINY_CANARY_REVIEW");
  }

  if (input.tinyCanaryPassed && (input.sampleSize ?? 0) >= 20) {
    gatesPassed.push("TINY_CANARY_RECONCILED");
    decision = "STAY_TINY_CANARY";
    proposed = Math.min(input.currentEvidenceLevel + 1, 11) as EvidenceLevelNumber;
  }

  if (input.edgeDecayDetected) {
    decision = "REVALIDATION_REQUIRED";
    reasonCodes.push("EDGE_DECAY");
  }

  if (input.currentEvidenceLevel <= 7) {
    if (decision === "HOLD_CURRENT_STAGE") decision = "RESEARCH_ONLY";
  }

  if (input.currentEvidenceLevel === 8 && decision === "HOLD_CURRENT_STAGE") {
    decision = "MANUAL_ONLY";
  }

  if (!canPromoteOneStage(input.currentEvidenceLevel, proposed)) {
    proposed = input.currentEvidenceLevel;
    reasonCodes.push("MAX_ONE_STAGE_PROMOTION");
  }

  return buildResult(decision, proposed, reasonCodes, gatesPassed, gatesFailed, input.reportDate);
}

function buildResult(
  decision: GoNoGoDecision,
  proposed: EvidenceLevelNumber,
  reasonCodes: string[],
  gatesPassed: string[],
  gatesFailed: string[],
  reportDate: string,
): GoNoGoResult {
  return {
    reportDate,
    decision,
    proposedEvidenceLevel: proposed,
    reasonCodes,
    gatesPassed,
    gatesFailed,
    decidedAt: new Date().toISOString(),
  };
}
