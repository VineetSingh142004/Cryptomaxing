import type { AvailabilityTriState } from "@/lib/trading/exchange/availability-types";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import type { RiskTier } from "@/lib/trading/paper/scanner-config";

export type PaperMarketType = "spot" | "margin" | "perp" | "futures" | "watch";

export interface PaperLeverageInput {
  availability: ExchangeAvailabilityResult;
  confidence: number;
  opportunityScore: number;
  liquidityScore: number;
  volatilityPct?: number;
  stopDistancePct: number;
  riskTier: RiskTier;
  hasClearStopLoss: boolean;
}

export interface PaperLeverageResult {
  leverageAvailable: AvailabilityTriState;
  usLeverageAvailable: AvailabilityTriState;
  recommendedLeverage: number;
  leverageUsed: number;
  leverageReason: string;
  riskWithLeverage: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  liquidationRisk: string | null;
  marketType: PaperMarketType;
  useLeverage: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function triFromMargin(avail: ExchangeAvailabilityResult): AvailabilityTriState {
  if (avail.krakenMarginAvailable === "YES" || avail.krakenFuturesAvailable === "YES") {
    return "YES";
  }
  if (avail.krakenMarginAvailable === "NO" && avail.krakenFuturesAvailable === "NO") {
    return "NO";
  }
  return "UNKNOWN";
}

function resolveMarketType(avail: ExchangeAvailabilityResult): PaperMarketType {
  if (avail.krakenFuturesAvailable === "YES") return "futures";
  if (avail.krakenMarginAvailable === "YES") return "margin";
  if (avail.krakenSpotAvailable === "YES") return "spot";
  if (avail.krakenSpotAvailable === "UNKNOWN") return "watch";
  return "watch";
}

export function evaluatePaperLeverage(input: PaperLeverageInput): PaperLeverageResult {
  const {
    availability,
    confidence,
    opportunityScore,
    liquidityScore,
    volatilityPct = 3,
    stopDistancePct,
    riskTier,
    hasClearStopLoss,
  } = input;

  const leverageAvailable = triFromMargin(availability);
  const usLeverageAvailable = availability.usLeverageAvailable;
  const marketType = resolveMarketType(availability);
  const maxAllowed = PAPER_RISK_CONFIG.maxLeverageAllowed;

  const unknownBlocks =
    leverageAvailable === "UNKNOWN" || usLeverageAvailable === "UNKNOWN";

  const gates: string[] = [];
  const blocks: string[] = [];

  if (opportunityScore >= 75) gates.push("strong_opportunity");
  else blocks.push("opportunity_not_strong_enough");

  if (confidence >= 0.75) gates.push("high_confidence");
  else blocks.push("confidence_too_low");

  if (liquidityScore >= 60) gates.push("strong_liquidity");
  else blocks.push("liquidity_weak");

  if (hasClearStopLoss && stopDistancePct > 0) gates.push("clear_stop");
  else blocks.push("no_clear_stop");

  if (volatilityPct <= 6) gates.push("acceptable_volatility");
  else blocks.push("volatility_too_high");

  if (leverageAvailable === "YES") gates.push("exchange_margin_confirmed");
  else if (leverageAvailable === "UNKNOWN") blocks.push("leverage_availability_unknown");
  else blocks.push("no_margin_on_exchange");

  if (usLeverageAvailable === "YES") gates.push("us_leverage_confirmed");
  else if (usLeverageAvailable === "UNKNOWN") blocks.push("us_leverage_unknown");
  else blocks.push("us_leverage_restricted");

  if (riskTier === "EXTREME_RISK") blocks.push("extreme_risk_tier");

  const canRecommend =
    !unknownBlocks &&
    leverageAvailable === "YES" &&
    usLeverageAvailable === "YES" &&
    blocks.length <= 1 &&
    gates.length >= 4;

  let recommendedLeverage = 1;
  let leverageReason = "Spot only — leverage not confirmed or not safe (SIMULATED)";

  if (unknownBlocks) {
    const usUnknown = usLeverageAvailable === "UNKNOWN";
    leverageReason = usUnknown
      ? "LEVERAGE_ELIGIBLE_UNVERIFIED — U.S. leverage availability unknown; spot only (SIMULATED)"
      : "Leverage availability UNKNOWN — no leverage recommendation (SIMULATED)";
  } else if (canRecommend) {
    if (gates.length >= 6 && opportunityScore >= 85 && confidence >= 0.85) {
      recommendedLeverage = Math.min(3, maxAllowed);
      leverageReason = "High-confidence setup with confirmed margin — conservative 3x (SIMULATED)";
    } else if (opportunityScore >= 75 && confidence >= 0.75) {
      recommendedLeverage = Math.min(2, maxAllowed);
      leverageReason = "Strong setup with confirmed U.S. margin — 2x (SIMULATED)";
    } else {
      recommendedLeverage = 1;
      leverageReason = "Setup quality insufficient for leveraged paper trade (SIMULATED)";
    }
  } else if (leverageAvailable === "NO" || usLeverageAvailable === "NO") {
    leverageReason = "Leverage not available for this pair/exchange (SIMULATED)";
  }

  const useLeverage = recommendedLeverage > 1 && canRecommend;

  let riskWithLeverage: PaperLeverageResult["riskWithLeverage"] = "LOW";
  if (useLeverage) {
    if (volatilityPct > 5 || riskTier === "HIGH_VOLATILITY") riskWithLeverage = "HIGH";
    else if (recommendedLeverage >= 3) riskWithLeverage = "MEDIUM";
    else riskWithLeverage = "MEDIUM";
  }

  let liquidationRisk: string | null = null;
  if (useLeverage && stopDistancePct > 0) {
    const liqBuffer = stopDistancePct * recommendedLeverage;
    liquidationRisk =
      liqBuffer < 3
        ? `Elevated — stop ${stopDistancePct.toFixed(2)}% at ${recommendedLeverage}x (SIMULATED)`
        : `Controlled — ${liqBuffer.toFixed(1)}% buffer at ${recommendedLeverage}x (SIMULATED)`;
  }

  return {
    leverageAvailable,
    usLeverageAvailable,
    recommendedLeverage: useLeverage ? recommendedLeverage : 1,
    leverageUsed: useLeverage ? recommendedLeverage : 1,
    leverageReason,
    riskWithLeverage,
    liquidationRisk,
    marketType,
    useLeverage,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
