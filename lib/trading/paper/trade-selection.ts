import { isConfirmedTradable, isUnconfirmedTradable } from "@/lib/trading/exchange/availability-types";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import type { ScoreBreakdown } from "@/lib/trading/paper/scoring";
import { SCANNER_CONFIG, type RiskTier, riskPercentForTier } from "@/lib/trading/paper/scanner-config";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import {
  computeTierExitDistances,
  evaluateFakePumpRisk,
  evaluateRiskReward,
  MIN_REWARD_RISK_BY_TIER,
} from "@/lib/trading/paper/profit-protection";

export type TradeSelectionRecommendation = "BUY" | "WATCH" | "AVOID";

export interface TradeSelectionResult {
  shouldOpen: boolean;
  recommendation: TradeSelectionRecommendation;
  reasonCode: string;
  reasonText: string;
  decisionReasoning?: string[];
}

export function minScoreForTier(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return PAPER_CONFIG.minOpportunityScore;
    case "ALT_LIQUID":
      return Math.max(PAPER_CONFIG.minOpportunityScore - 5, 55);
    case "HIGH_VOLATILITY":
      return PAPER_CONFIG.minOpportunityScore + 8;
    case "EXTREME_RISK":
      return PAPER_CONFIG.minOpportunityScore + 15;
  }
}

export function formatScoreTooLowMessage(
  score: number,
  tier: RiskTier,
  requiredScore: number = minScoreForTier(tier),
): string {
  if (score >= requiredScore) {
    return `Score ${score.toFixed(0)} passed required ${requiredScore} for ${tier} — blocked by another filter.`;
  }
  return `Score ${score.toFixed(0)} below required ${requiredScore} for ${tier}.`;
}

/** Never show "below required" when score already meets the effective threshold. */
export function resolveCandidateBlockReason(input: {
  score: number;
  tier: RiskTier;
  reasonCode: string;
  reasonText: string;
  recordCaution?: { active: boolean; minScoreBoost: number };
}): string {
  const baseMin = minScoreForTier(input.tier);
  const effectiveMin =
    baseMin + (input.recordCaution?.active ? input.recordCaution.minScoreBoost : 0);
  const code = input.reasonCode.toUpperCase();

  if (code === "SCORE_TOO_LOW" && input.score >= baseMin) {
    if (input.recordCaution?.active && input.score < effectiveMin) {
      return `Score ${input.score.toFixed(0)} passed base ${baseMin} but below caution effective ${effectiveMin} for ${input.tier}.`;
    }
    if (input.reasonText && !input.reasonText.includes("below required")) {
      return input.reasonText;
    }
    return `Score ${input.score.toFixed(0)} passed ${baseMin} for ${input.tier} — blocked by confidence or another rule (not score threshold).`;
  }

  if (code === "SCORE_TOO_LOW" && input.score < effectiveMin) {
    return formatScoreTooLowMessage(input.score, input.tier, effectiveMin);
  }

  if (code === "NO_BLUEPRINT_STRATEGY_MATCH" || code.includes("BLUEPRINT")) {
    return input.reasonText || "Score passed — no blueprint strategy match (WATCH_ONLY in paper mode).";
  }

  return input.reasonText;
}

export function evaluateTradeSelection(input: {
  breakdown: ScoreBreakdown;
  availability: ExchangeAvailabilityResult;
  riskTier: RiskTier;
  spreadBps: number;
  volume24hUsd: number;
  change24hPct: number;
  change1hPct?: number | null;
  momentumPct: number;
  hasExitPlan: boolean;
  entryPrice: number;
  pumpRiskPenalty?: number;
  momentumScore?: number;
  volumeSpikeScore?: number;
  shortTermReturnPct?: number;
  tradableOnConfiguredExchange?: boolean;
  recordCaution?: {
    active: boolean;
    minScoreBoost: number;
    blockHighVolAlts: boolean;
  };
}): TradeSelectionResult {
  let minScore = minScoreForTier(input.riskTier);
  if (input.recordCaution?.active) {
    minScore += input.recordCaution.minScoreBoost;
    if (
      input.recordCaution.blockHighVolAlts &&
      (input.riskTier === "ALT_LIQUID" ||
        input.riskTier === "HIGH_VOLATILITY" ||
        input.riskTier === "EXTREME_RISK")
    ) {
      return {
        shouldOpen: false,
        recommendation: "WATCH",
        reasonCode: "SCORE_TOO_LOW",
        reasonText: `Caution mode active — ${input.riskTier} entries blocked until more record evidence.`,
        decisionReasoning: ["Record caution mode blocks high-vol/alt entries"],
      };
    }
  }
  const reasoning: string[] = [];

  if (input.availability.recommendedAction === "AVOID") {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "NOT_TRADABLE_ON_EXCHANGE",
      reasonText: "Exchange availability confirms avoid — no paper trade.",
      decisionReasoning: ["Kraken/exchange marks pair as AVOID"],
    };
  }

  if (!isConfirmedTradable(input.availability)) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: isUnconfirmedTradable(input.availability)
        ? "EXCHANGE_AVAILABILITY_UNKNOWN"
        : "NOT_TRADABLE_ON_EXCHANGE",
      reasonText:
        input.availability.availabilityNote ??
        "Detected externally but not confirmed tradable on connected exchange — watch only.",
      decisionReasoning: ["Not confirmed tradable on configured exchange"],
    };
  }

  const fakePump = evaluateFakePumpRisk({
    riskTier: input.riskTier,
    change24hPct: input.change24hPct,
    change1hPct: input.change1hPct ?? null,
    volume24hUsd: input.volume24hUsd,
    liquidityScore: input.breakdown.liquidityScore,
    spreadBps: input.spreadBps,
    pumpRiskPenalty: input.pumpRiskPenalty ?? 0,
    momentumScore: input.momentumScore ?? input.breakdown.trendScore,
    volumeSpikeScore: input.volumeSpikeScore ?? 50,
    tradableOnConfiguredExchange: input.tradableOnConfiguredExchange ?? true,
    breakdown: input.breakdown,
    shortTermReturnPct: input.shortTermReturnPct,
  });
  reasoning.push(...fakePump.decisionReasoning);

  if (!fakePump.passed) {
    return {
      shouldOpen: false,
      recommendation: fakePump.watchOnly ? "WATCH" : "AVOID",
      reasonCode: fakePump.reasonCode,
      reasonText: fakePump.reasonText,
      decisionReasoning: reasoning,
    };
  }

  if (input.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "VOLUME_TOO_LOW",
      reasonText: `Volume too low for quality entry — $${input.volume24hUsd.toFixed(0)}.`,
      decisionReasoning: [...reasoning, "24h volume below scanner minimum"],
    };
  }

  if (input.breakdown.liquidityScore < PAPER_CONFIG.minLiquidityScore && input.riskTier === "MAJOR") {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "LIQUIDITY_TOO_LOW",
      reasonText: "Liquidity insufficient for major-tier entry.",
      decisionReasoning: [...reasoning, "Major-tier liquidity score too low"],
    };
  }

  if (input.breakdown.finalScore < minScore) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "SCORE_TOO_LOW",
      reasonText: formatScoreTooLowMessage(input.breakdown.finalScore, input.riskTier, minScore),
      decisionReasoning: [...reasoning, `Score ${input.breakdown.finalScore.toFixed(0)} < ${minScore}`],
    };
  }

  if (input.breakdown.confidenceLevel === "LOW") {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "SCORE_TOO_LOW",
      reasonText: "Confidence too low — waiting for stronger confirmed setup.",
      decisionReasoning: [...reasoning, "Confidence level LOW"],
    };
  }

  if (input.breakdown.riskLevel === "EXTREME" && input.breakdown.finalScore < minScore + 10) {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "PUMP_RISK_TOO_HIGH",
      reasonText: "Extreme risk tier — setup not strong enough to justify paper entry.",
      decisionReasoning: [...reasoning, "Extreme risk level with insufficient score cushion"],
    };
  }

  if (
    Math.abs(input.change24hPct) < SCANNER_CONFIG.min24hChangePct &&
    input.riskTier !== "MAJOR" &&
    Math.abs(input.momentumPct) < 0.05
  ) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "VOLATILITY_TOO_LOW",
      reasonText: "Momentum and 24h move too weak — no trade is better than a bad trade.",
      decisionReasoning: [...reasoning, "NO_TRADE_BEST_DECISION — weak momentum"],
    };
  }

  const { stopDistancePct, takeProfitDistancePct } = computeTierExitDistances(input.riskTier);
  const plannedStopLoss = input.entryPrice * (1 - stopDistancePct / 100);
  const plannedTakeProfit = input.entryPrice * (1 + takeProfitDistancePct / 100);
  const simulatedRiskUsd =
    SCANNER_CONFIG.simulatedAccountUsd * (riskPercentForTier(input.riskTier) / 100);

  const rr = evaluateRiskReward({
    riskTier: input.riskTier,
    side: "LONG",
    entryPrice: input.entryPrice,
    plannedStopLoss,
    plannedTakeProfit,
    riskAmountUsd: simulatedRiskUsd,
    opportunityScore: input.breakdown.finalScore,
    winProbability:
      input.breakdown.confidenceLevel === "HIGH"
        ? 0.85
        : input.breakdown.confidenceLevel === "MEDIUM"
          ? 0.7
          : 0.55,
  });
  reasoning.push(...rr.decisionReasoning);

  if (!input.hasExitPlan || !rr.passed) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: rr.passed ? "RISK_REWARD_TOO_WEAK" : "REJECTED_BAD_RISK_REWARD",
      reasonText: rr.passed
        ? "Exit plan (stop/target) not viable for this setup."
        : rr.reasonText,
      decisionReasoning: reasoning,
    };
  }

  if (input.breakdown.pumpRiskPenalty >= 40) {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "REJECTED_FAKE_PUMP_RISK",
      reasonText: "Pump/fake-move risk too high — avoid paper entry.",
      decisionReasoning: [...reasoning, `Legacy pump penalty ${input.breakdown.pumpRiskPenalty}`],
    };
  }

  reasoning.push(
    `Risk/reward ${rr.rewardRiskRatio.toFixed(2)} >= ${MIN_REWARD_RISK_BY_TIER[input.riskTier]} for ${input.riskTier}`,
  );

  return {
    shouldOpen: true,
    recommendation: "BUY",
    reasonCode: "TRADE_READY",
    reasonText: `Quality setup confirmed — score ${input.breakdown.finalScore.toFixed(0)}, R:R ${rr.rewardRiskRatio.toFixed(2)}, confidence ${input.breakdown.confidenceLevel}.`,
    decisionReasoning: reasoning,
  };
}
