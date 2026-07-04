import { isConfirmedTradable, isUnconfirmedTradable } from "@/lib/trading/exchange/availability-types";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import type { ScoreBreakdown } from "@/lib/trading/paper/scoring";
import { SCANNER_CONFIG, type RiskTier } from "@/lib/trading/paper/scanner-config";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";

export type TradeSelectionRecommendation = "BUY" | "WATCH" | "AVOID";

export interface TradeSelectionResult {
  shouldOpen: boolean;
  recommendation: TradeSelectionRecommendation;
  reasonCode: string;
  reasonText: string;
}

function minScoreForTier(tier: RiskTier): number {
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

export function evaluateTradeSelection(input: {
  breakdown: ScoreBreakdown;
  availability: ExchangeAvailabilityResult;
  riskTier: RiskTier;
  spreadBps: number;
  volume24hUsd: number;
  change24hPct: number;
  momentumPct: number;
  hasExitPlan: boolean;
}): TradeSelectionResult {
  const minScore = minScoreForTier(input.riskTier);

  if (input.availability.recommendedAction === "AVOID") {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "NOT_TRADABLE_ON_EXCHANGE",
      reasonText: "Exchange availability confirms avoid — no paper trade.",
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
    };
  }

  if (input.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "VOLUME_TOO_LOW",
      reasonText: `Volume too low for quality entry — $${input.volume24hUsd.toFixed(0)}.`,
    };
  }

  if (input.breakdown.liquidityScore < PAPER_CONFIG.minLiquidityScore && input.riskTier === "MAJOR") {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "LIQUIDITY_TOO_LOW",
      reasonText: "Liquidity insufficient for major-tier entry.",
    };
  }

  if (input.breakdown.finalScore < minScore) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "SCORE_TOO_LOW",
      reasonText: `Final score ${input.breakdown.finalScore.toFixed(0)} below minimum ${minScore} — no forced trade.`,
    };
  }

  if (input.breakdown.confidenceLevel === "LOW") {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "SCORE_TOO_LOW",
      reasonText: "Confidence too low — waiting for stronger confirmed setup.",
    };
  }

  if (input.breakdown.riskLevel === "EXTREME" && input.breakdown.finalScore < minScore + 10) {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "PUMP_RISK_TOO_HIGH",
      reasonText: "Extreme risk tier — setup not strong enough to justify paper entry.",
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
    };
  }

  if (!input.hasExitPlan) {
    return {
      shouldOpen: false,
      recommendation: "WATCH",
      reasonCode: "RISK_REWARD_TOO_WEAK",
      reasonText: "Exit plan (stop/target) not viable for this setup.",
    };
  }

  if (input.breakdown.pumpRiskPenalty >= 40) {
    return {
      shouldOpen: false,
      recommendation: "AVOID",
      reasonCode: "PUMP_RISK_TOO_HIGH",
      reasonText: "Pump/fake-move risk too high — avoid paper entry.",
    };
  }

  return {
    shouldOpen: true,
    recommendation: "BUY",
    reasonCode: "TRADE_OPENED",
    reasonText: `Quality setup confirmed — score ${input.breakdown.finalScore.toFixed(0)}, confidence ${input.breakdown.confidenceLevel}, risk ${input.breakdown.riskLevel}.`,
  };
}
