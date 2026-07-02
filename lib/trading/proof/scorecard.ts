import type { EvidenceLevelNumber, ProfitabilityScorecard, ScorecardStatus } from "@/lib/trading/proof/types";
import type { TodayAlphaBetaResult } from "@/lib/trading/proof/alpha-beta";
import type { PaperDailySummary } from "@/lib/trading/paper/types";

export interface ScorecardInput {
  period: string;
  evidenceLevel: EvidenceLevelNumber;
  dataQualityScore: number;
  signalQualityScore: number;
  executionQualityScore: number;
  fillRealismScore: number;
  sampleSize: number;
  maxDrawdownPct: number;
  liveReconciled: boolean;
  edgeDecayDetected: boolean;
  regimeBreadth: number;
  alphaBeta: TodayAlphaBetaResult | null;
  paperSummary: PaperDailySummary | null;
  luckyTradeDominance: number | null;
  costDragPct: number;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function buildProfitabilityScorecard(input: ScorecardInput): ProfitabilityScorecard {
  const reasonCodes: string[] = [];

  const sampleSizeScore = clamp(input.sampleSize >= 50 ? 90 : input.sampleSize >= 20 ? 70 : input.sampleSize >= 5 ? 45 : 15);
  if (sampleSizeScore < 45) reasonCodes.push("SMALL_SAMPLE");

  const liveReconciliationScore = input.liveReconciled ? 85 : input.evidenceLevel >= 10 ? 25 : 50;
  if (!input.liveReconciled && input.evidenceLevel >= 10) reasonCodes.push("UNRECONCILED_PNL");

  const costSurvivalScore = clamp(100 - input.costDragPct * 5);
  if (costSurvivalScore < 40) reasonCodes.push("HIGH_COST_DRAG");

  const alphaVsBetaScore = input.alphaBeta
    ? clamp(100 - input.alphaBeta.beta_dependency_score)
    : 50;
  if (input.alphaBeta?.flags.includes("BETA_NOT_ALPHA")) reasonCodes.push("BETA_DEPENDENCE");

  const randomBaselineScore = input.alphaBeta
    ? clamp(50 + (input.alphaBeta.today_alpha_vs_random > 0 ? 30 : -20))
    : 50;

  const drawdownControlScore = clamp(100 - input.maxDrawdownPct * 8);
  const edgeDecayScore = input.edgeDecayDetected ? 25 : 80;
  const regimeSurvivalScore = clamp(input.regimeBreadth * 25);

  const profitAttributionScore =
    input.luckyTradeDominance !== null
      ? clamp(100 - input.luckyTradeDominance * 100)
      : 50;
  if ((input.luckyTradeDominance ?? 0) > 0.5) reasonCodes.push("ONE_TRADE_DOMINANCE");

  const categories = {
    dataQualityScore: clamp(input.dataQualityScore),
    signalQualityScore: clamp(input.signalQualityScore),
    executionQualityScore: clamp(input.executionQualityScore),
    fillRealismScore: clamp(input.fillRealismScore),
    costSurvivalScore,
    alphaVsBetaScore,
    randomBaselineScore,
    drawdownControlScore,
    sampleSizeScore,
    liveReconciliationScore,
    edgeDecayScore,
    regimeSurvivalScore,
    profitAttributionScore,
  };

  const overallScore =
    Object.values(categories).reduce((s, v) => s + v, 0) / Object.keys(categories).length;

  let status: ScorecardStatus = "NOT_TESTED";
  if (input.dataQualityScore < 40) status = "BAD_DATA";
  else if (overallScore < 35) status = "NO_EDGE";
  else if (overallScore < 50) status = "WEAK_EDGE";
  else if (input.evidenceLevel >= 14 && overallScore >= 75 && input.liveReconciled) {
    status = "SCALABLE_LIVE_EDGE";
  } else if (input.evidenceLevel >= 10 && overallScore >= 65) status = "TINY_LIVE_EDGE";
  else if (input.evidenceLevel >= 9 && overallScore >= 55) status = "SHADOW_EDGE_ONLY";
  else if (input.evidenceLevel >= 8 && overallScore >= 50) status = "PAPER_EDGE_ONLY";
  else if (input.edgeDecayDetected) status = "DECAYING_EDGE";
  else if (overallScore >= 55 && input.evidenceLevel >= 10) status = "LIVE_EDGE_UNDER_REVIEW";

  if (status === "SCALABLE_LIVE_EDGE" && !input.liveReconciled) {
    status = "LIVE_EDGE_UNDER_REVIEW";
    reasonCodes.push("NEVER_PROVEN_WITHOUT_LIVE");
  }

  return {
    period: input.period,
    categories,
    overallScore,
    status,
    reasonCodes,
    generatedAt: new Date().toISOString(),
  };
}
