import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  SCANNER_CONFIG,
  riskPercentForTier,
  type RiskTier,
} from "@/lib/trading/paper/scanner-config";
import { PAPER_CONFIG, type PaperReasonCode } from "@/lib/trading/paper/paper-config";

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
}

function tierStopLossBps(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return PAPER_CONFIG.stopLossBps;
    case "ALT_LIQUID":
      return PAPER_CONFIG.stopLossBps * 1.1;
    case "HIGH_VOLATILITY":
      return PAPER_CONFIG.stopLossBps * 1.5;
    case "EXTREME_RISK":
      return PAPER_CONFIG.stopLossBps * 2;
  }
}

function tierTakeProfitBps(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return PAPER_CONFIG.takeProfitBps;
    case "ALT_LIQUID":
      return PAPER_CONFIG.takeProfitBps * 0.9;
    case "HIGH_VOLATILITY":
      return PAPER_CONFIG.takeProfitBps * 1.2;
    case "EXTREME_RISK":
      return PAPER_CONFIG.takeProfitBps * 1.5;
  }
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
): ControlledActiveStrategyResult {
  const riskTier = candidate.riskTier;
  const riskPercent = riskPercentForTier(riskTier);

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

  if (candidate.action === "WATCHLIST_ONLY") {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: candidate.reasonText,
      reasonCode: candidate.reasonCode,
      ...base,
    };
  }

  if (candidate.action !== "OPEN_TRADE") {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: candidate.reasonText,
      reasonCode: candidate.reasonCode,
      ...base,
    };
  }

  let decision: StrategyDecision = "NO_TRADE";
  const momentumThreshold = riskTier === "EXTREME_RISK" || riskTier === "HIGH_VOLATILITY" ? 0.02 : 0.05;

  if (momentumPct > momentumThreshold || candidate.change24hPct > SCANNER_CONFIG.min24hChangePct) {
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

  if (tpPct / stopPct < 1.05) {
    return {
      decision: "NO_TRADE",
      confidence: candidate.opportunityScore / 100,
      reason: "Risk/reward ratio too weak for tier",
      reasonCode: "RISK_REWARD_TOO_WEAK",
      ...base,
    };
  }

  const riskAmount = SCANNER_CONFIG.simulatedAccountUsd * (riskPercent / 100);
  const stopDistance = mid * stopPct;
  const simulatedSize = stopDistance > 0 ? riskAmount / stopDistance : null;

  const plannedStopLoss = decision === "LONG" ? mid * (1 - stopPct) : mid * (1 + stopPct);
  const plannedTakeProfit = decision === "LONG" ? mid * (1 + tpPct) : mid * (1 - tpPct);

  const warning =
    riskTier === "EXTREME_RISK"
      ? "EXTREME_RISK_PAPER_ONLY"
      : riskTier === "HIGH_VOLATILITY"
        ? "HIGH_VOLATILITY_PAPER_ONLY"
        : undefined;

  return {
    decision,
    confidence: Math.min(0.95, candidate.opportunityScore / 100),
    reason: `${decision} — ${riskTier}, score ${candidate.opportunityScore.toFixed(0)}, 24h ${candidate.change24hPct.toFixed(1)}%`,
    reasonCode: "TRADE_OPENED",
    entryPrice: mid,
    plannedStopLoss,
    plannedTakeProfit,
    simulatedSize,
    riskAmount,
    riskPercent,
    riskTier,
    warning,
  };
}

export const PAPER_TRADE_EXPIRY_HOURS = PAPER_CONFIG.tradeExpiryHours;
