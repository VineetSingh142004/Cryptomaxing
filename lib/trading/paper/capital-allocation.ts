import {
  PAPER_RISK_CONFIG,
  riskModeMultiplier,
  type PaperDailyBudgetMode,
  type PaperRiskMode,
} from "@/lib/trading/paper/paper-risk-config";
import { SCANNER_CONFIG, type RiskTier } from "@/lib/trading/paper/scanner-config";

export interface DailyBudgetInput {
  simulatedAccountUsd: number;
  mode?: PaperDailyBudgetMode;
  manualBudgetUsd?: number;
  /** 0–100 confidence */
  marketConfidenceScore?: number;
  currentDrawdownPct?: number;
  dailyLossPct?: number;
  riskMode?: PaperRiskMode;
}

export interface DailyBudgetResult {
  dailyBudgetUsd: number;
  source: "manual" | "ai_recommended" | "account_default";
  aiRecommendationUsd: number | null;
  maxAcceptableDailyLossUsd: number;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface PositionSizeInput {
  entryPrice: number;
  stopDistancePct: number;
  confidence: number;
  opportunityScore: number;
  riskTier: RiskTier;
  volatilityPct?: number;
  liquidityScore?: number;
  leverage?: number;
  downsideRiskScore?: number;
  dailyBudgetRemainingUsd?: number;
  totalExposureUsedUsd?: number;
  simulatedAccountUsd?: number;
  riskMode?: PaperRiskMode;
}

export interface PositionSizeResult {
  riskAmountUsd: number;
  simulatedSize: number;
  capitalAllocationPct: number;
  riskPercent: number;
  sizingReason: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function confidenceScoreAdj(score: number): number {
  if (score >= 85) return 1.1;
  if (score >= 70) return 1;
  if (score >= 55) return 0.8;
  return 0.6;
}

export function resolveDailyBudget(input: DailyBudgetInput): DailyBudgetResult {
  const account = input.simulatedAccountUsd;
  const mode = input.mode ?? PAPER_RISK_CONFIG.dailyBudgetMode;
  const maxLossPct = PAPER_RISK_CONFIG.maxDailyLossPercent;

  const aiBase = account * (PAPER_RISK_CONFIG.maxTotalExposurePercent / 100);
  const drawdownAdj = Math.max(0.4, 1 - (input.currentDrawdownPct ?? 0) / 10);
  const confAdj = confidenceScoreAdj(input.marketConfidenceScore ?? 70);
  const lossAdj =
    (input.dailyLossPct ?? 0) < -maxLossPct * 0.5 ? 0.5 : 1;
  const aiRecommendationUsd =
    Math.round(aiBase * drawdownAdj * confAdj * lossAdj * 100) / 100;

  let dailyBudgetUsd: number;
  let source: DailyBudgetResult["source"];

  if (mode === "manual" && (input.manualBudgetUsd ?? PAPER_RISK_CONFIG.manualDailyBudgetUsd) > 0) {
    dailyBudgetUsd = input.manualBudgetUsd ?? PAPER_RISK_CONFIG.manualDailyBudgetUsd;
    source = "manual";
  } else if (mode === "ai_recommended") {
    dailyBudgetUsd = aiRecommendationUsd;
    source = "ai_recommended";
  } else if (PAPER_RISK_CONFIG.manualDailyBudgetUsd > 0) {
    dailyBudgetUsd = PAPER_RISK_CONFIG.manualDailyBudgetUsd;
    source = "manual";
  } else {
    dailyBudgetUsd = account;
    source = "account_default";
  }

  return {
    dailyBudgetUsd,
    source,
    aiRecommendationUsd,
    maxAcceptableDailyLossUsd: dailyBudgetUsd * (maxLossPct / 100),
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function tierBaseRiskPct(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return SCANNER_CONFIG.riskPercentMajor;
    case "ALT_LIQUID":
      return SCANNER_CONFIG.riskPercentAlt;
    case "HIGH_VOLATILITY":
      return SCANNER_CONFIG.riskPercentHighVol;
    case "EXTREME_RISK":
      return SCANNER_CONFIG.riskPercentExtreme;
  }
}

export function calculatePaperPositionSize(input: PositionSizeInput): PositionSizeResult {
  const account = input.simulatedAccountUsd ?? SCANNER_CONFIG.simulatedAccountUsd;
  const riskMode = input.riskMode ?? PAPER_RISK_CONFIG.riskMode;
  const modeMult = riskModeMultiplier(riskMode);

  let riskPct = tierBaseRiskPct(input.riskTier) * modeMult;

  const confMult = input.confidence >= 0.85 ? 1.15 : input.confidence >= 0.7 ? 1 : 0.75;
  const scoreMult =
    input.opportunityScore >= 80 ? 1.1 : input.opportunityScore >= 65 ? 1 : 0.85;
  const liqMult =
    (input.liquidityScore ?? 60) >= 70 ? 1.05 : (input.liquidityScore ?? 60) < 45 ? 0.7 : 1;
  const volMult =
    (input.volatilityPct ?? 3) > 8 ? 0.6 : (input.volatilityPct ?? 3) > 5 ? 0.8 : 1;
  const lev = input.leverage ?? 1;
  const levMult = lev > 1 ? 1 / Math.sqrt(lev) : 1;
  const downMult =
    (input.downsideRiskScore ?? 30) > 60 ? 0.5 : (input.downsideRiskScore ?? 30) > 40 ? 0.75 : 1;

  riskPct *= confMult * scoreMult * liqMult * volMult * levMult * downMult;
  riskPct = Math.min(riskPct, PAPER_RISK_CONFIG.maxCapitalPerTradePercent);

  const dailyBudget = resolveDailyBudget({ simulatedAccountUsd: account });
  const budgetCap = dailyBudget.dailyBudgetUsd * (PAPER_RISK_CONFIG.maxCapitalPerTradePercent / 100);
  const exposureCap =
    account * (PAPER_RISK_CONFIG.maxTotalExposurePercent / 100) -
    (input.totalExposureUsedUsd ?? 0);
  const remaining = input.dailyBudgetRemainingUsd ?? dailyBudget.dailyBudgetUsd;

  const riskAmountUsd = Math.min(
    account * (riskPct / 100),
    budgetCap,
    Math.max(0, exposureCap),
    Math.max(0, remaining * 0.25),
  );

  const stopPct = input.stopDistancePct / 100 || 0.008;
  const stopDistance = input.entryPrice * stopPct;
  const simulatedSize = stopDistance > 0 ? riskAmountUsd / stopDistance : 0;
  const notional = simulatedSize * input.entryPrice;
  const capitalAllocationPct = account > 0 ? (notional / account) * 100 : 0;

  const parts: string[] = [];
  if (confMult > 1) parts.push("high confidence");
  if (scoreMult < 1) parts.push("moderate score");
  if (volMult < 1) parts.push("elevated volatility");
  if (lev > 1) parts.push(`${lev}x leverage reduces size`);
  if (downMult < 1) parts.push("higher downside risk");

  return {
    riskAmountUsd,
    simulatedSize,
    capitalAllocationPct,
    riskPercent: riskPct,
    sizingReason:
      parts.length > 0
        ? `Sized for ${parts.join(", ")} (SIMULATED)`
        : "Standard risk-based sizing (SIMULATED)",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
