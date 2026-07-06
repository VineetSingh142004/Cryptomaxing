import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { calculatePaperPositionSize } from "@/lib/trading/paper/capital-allocation";
import { evaluatePaperLeverage } from "@/lib/trading/paper/paper-leverage";
import {
  SCANNER_CONFIG,
  riskPercentForTier,
  type RiskTier,
} from "@/lib/trading/paper/scanner-config";
import { PAPER_CONFIG, type PaperReasonCode } from "@/lib/trading/paper/paper-config";
import {
  evaluateExtremeRiskEntry,
  evaluateRiskReward,
  tierStopLossBps,
  tierTakeProfitBps,
} from "@/lib/trading/paper/profit-protection";

export type StrategyDecision = "LONG" | "SHORT" | "NO_TRADE";

export interface ControlledActiveStrategyResult {
  decision: StrategyDecision;
  confidence: number;
  reason: string;
  reasonCode: PaperReasonCode | string;
  entryPrice: number | null;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  simulatedSize: number | null;
  riskAmount: number | null;
  riskPercent: number;
  riskTier: RiskTier;
  warning?: string;
  simulatedLeverage?: number;
  leverageReason?: string;
  capitalAllocationPct?: number;
  leverageAvailable?: string;
  usLeverageAvailable?: string;
  marketType?: string;
  simulatedLabel?: "SIMULATED_PAPER_ONLY";
}

function tierExpiryHours(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
    case "ALT_LIQUID":
      return PAPER_CONFIG.tradeExpiryHours;
    case "HIGH_VOLATILITY":
      return Math.min(PAPER_CONFIG.tradeExpiryHours, 12);
    case "EXTREME_RISK":
      return Math.min(PAPER_CONFIG.tradeExpiryHours, 6);
  }
}

export function getTradeExpiryHoursForTier(tier: RiskTier): number {
  return tierExpiryHours(tier);
}

export function evaluateControlledActiveStrategy(
  candidate: ScanCandidate,
  momentumPct: number,
  options?: {
    allocationMultiplier?: number;
    paperExecutionMode?: "OPEN_PAPER_TRADE" | "TINY_B_SETUP_PAPER_ONLY";
  },
): ControlledActiveStrategyResult {
  const riskTier = candidate.riskTier;
  const riskPercent = riskPercentForTier(riskTier);
  const isTinyB = options?.paperExecutionMode === "TINY_B_SETUP_PAPER_ONLY";
  const isPaperOpen =
    options?.paperExecutionMode === "OPEN_PAPER_TRADE" || isTinyB;

  const base = {
    entryPrice: null as number | null,
    plannedStopLoss: null as number | null,
    plannedTakeProfit: null as number | null,
    simulatedSize: null as number | null,
    riskAmount: null as number | null,
    riskPercent,
    riskTier,
    warning: riskTier === "EXTREME_RISK" ? "EXTREME_RISK_PAPER_ONLY" : undefined,
  };

  if (!isPaperOpen && candidate.action === "WATCHLIST_ONLY") {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: candidate.reasonText,
      reasonCode: candidate.reasonCode,
      ...base,
    };
  }

  if (!isPaperOpen && candidate.action !== "OPEN_TRADE") {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: candidate.reasonText,
      reasonCode: candidate.reasonCode,
      ...base,
    };
  }

  let decision: StrategyDecision = "NO_TRADE";
  const momentumThreshold = isTinyB
    ? 0.005
    : riskTier === "EXTREME_RISK" || riskTier === "HIGH_VOLATILITY"
      ? 0.02
      : 0.05;

  const hasMomentum =
    momentumPct > momentumThreshold ||
    (isTinyB && (candidate.momentumScore ?? 0) >= 35) ||
    candidate.change24hPct > SCANNER_CONFIG.min24hChangePct;
  if (hasMomentum) {
    decision = "LONG";
  } else if (momentumPct < -momentumThreshold && PAPER_CONFIG.allowShort) {
    decision = "SHORT";
  } else {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: `Momentum ${momentumPct.toFixed(3)}% insufficient for ${riskTier} entry`,
      reasonCode: "LOW_MOMENTUM",
      ...base,
    };
  }

  if (!PAPER_CONFIG.allowShort && decision === "SHORT") {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: "Short trades disabled in paper mode",
      reasonCode: "SHORT_NOT_ALLOWED",
      ...base,
    };
  }

  const mid = candidate.price;
  const stopPct = tierStopLossBps(riskTier) / 10_000;
  const tpPct = tierTakeProfitBps(riskTier) / 10_000;

  const plannedStopLoss = decision === "LONG" ? mid * (1 - stopPct) : mid * (1 + stopPct);
  const plannedTakeProfit = decision === "LONG" ? mid * (1 + tpPct) : mid * (1 - tpPct);

  const confidence =
    candidate.scoreBreakdown?.confidenceLevel === "HIGH"
      ? 0.9
      : candidate.scoreBreakdown?.confidenceLevel === "MEDIUM"
        ? 0.75
        : candidate.opportunityScore / 100;

  const leverage = evaluatePaperLeverage({
    availability: candidate.availability,
    confidence,
    opportunityScore: candidate.opportunityScore,
    liquidityScore: candidate.liquidityScore,
    volatilityPct: candidate.volatilityScore / 10,
    stopDistancePct: stopPct * 100,
    riskTier,
    hasClearStopLoss: true,
  });

  const sizing = calculatePaperPositionSize({
    entryPrice: mid,
    stopDistancePct: stopPct * 100,
    confidence,
    opportunityScore: candidate.opportunityScore,
    riskTier,
    volatilityPct: candidate.volatilityScore / 10,
    liquidityScore: candidate.liquidityScore,
    leverage: leverage.leverageUsed,
    downsideRiskScore: candidate.pumpRiskPenalty + candidate.riskPenalty,
    allocationMultiplier: options?.allocationMultiplier,
  });

  const riskAmount = sizing.riskAmountUsd;
  const simulatedSize = sizing.simulatedSize > 0 ? sizing.simulatedSize : null;

  const rrCheck = evaluateRiskReward({
    riskTier,
    side: decision,
    entryPrice: mid,
    plannedStopLoss,
    plannedTakeProfit,
    riskAmountUsd: riskAmount,
    opportunityScore: candidate.opportunityScore,
    winProbability: confidence,
  });

  if (!rrCheck.passed) {
    return {
      decision: "NO_TRADE",
      confidence,
      reason: `${rrCheck.reasonText} | ${rrCheck.decisionReasoning.join("; ")}`,
      reasonCode: rrCheck.reasonCode,
      ...base,
      entryPrice: mid,
      plannedStopLoss,
      plannedTakeProfit,
    };
  }

  const extremeCheck = evaluateExtremeRiskEntry({
    riskTier,
    opportunityScore: candidate.opportunityScore,
    confidence,
    liquidityScore: candidate.liquidityScore,
    rewardRiskRatio: rrCheck.rewardRiskRatio,
  });

  if (!extremeCheck.allowed) {
    return {
      decision: "NO_TRADE",
      confidence,
      reason: extremeCheck.reasonText,
      reasonCode: extremeCheck.reasonCode,
      ...base,
      entryPrice: mid,
      plannedStopLoss,
      plannedTakeProfit,
    };
  }

  const warning =
    riskTier === "EXTREME_RISK"
      ? "EXTREME_RISK_PAPER_ONLY"
      : riskTier === "HIGH_VOLATILITY"
        ? "HIGH_VOLATILITY_PAPER_ONLY"
        : undefined;

  const tinyBPrefix = isTinyB
    ? "TINY B PAPER-ONLY TEST — reduced size, strict stop, no live, no Auto. | "
    : "";

  return {
    decision,
    confidence: Math.min(0.95, confidence),
    reason: `${tinyBPrefix}${decision} — ${riskTier}, score ${candidate.opportunityScore.toFixed(0)}, 24h ${candidate.change24hPct.toFixed(1)}% | R:R ${rrCheck.rewardRiskRatio.toFixed(2)} EV ${rrCheck.expectedValueUsd >= 0 ? "+" : ""}${rrCheck.expectedValueUsd.toFixed(2)} SIM | ${sizing.sizingReason}`,
    reasonCode: isTinyB ? "TINY_B_SETUP_PAPER_ONLY" : "TRADE_READY",
    entryPrice: mid,
    plannedStopLoss,
    plannedTakeProfit,
    simulatedSize,
    riskAmount,
    riskPercent: sizing.riskPercent,
    riskTier,
    warning,
    simulatedLeverage: leverage.leverageUsed,
    leverageReason: leverage.leverageReason,
    capitalAllocationPct: sizing.capitalAllocationPct,
    leverageAvailable: leverage.leverageAvailable,
    usLeverageAvailable: leverage.usLeverageAvailable,
    marketType: leverage.marketType,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export const PAPER_TRADE_EXPIRY_HOURS = PAPER_CONFIG.tradeExpiryHours;
