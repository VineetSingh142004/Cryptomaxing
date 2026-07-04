import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { PaperTradeSide } from "@prisma/client";
import type { ThesisInvalidationResult } from "@/lib/trading/paper/thesis-invalidation";

export type LosingTradeFactor =
  | "VOLUME_DROPPED"
  | "LIQUIDITY_DRIED_UP"
  | "MARKET_REVERSED"
  | "SOCIAL_HYPE_FADED"
  | "EXCHANGE_ISSUE"
  | "BAD_ENTRY"
  | "BAD_TIMING"
  | "HIGH_VOLATILITY"
  | "WEAK_TREND_CONFIRMATION";

export interface RiskExplanationInput {
  side: PaperTradeSide;
  entryPrice: number;
  markPrice: number;
  snapshot: NormalizedMarketSnapshot;
  thesisResult?: ThesisInvalidationResult;
  socialHypeScore?: number | null;
  exchangeTradable?: boolean;
}

export interface RiskExplanationResult {
  factors: LosingTradeFactor[];
  factorLabels: string[];
  summary: string;
  shouldExitEarly: boolean;
  isTradeStillValid: boolean;
  riskIncreasing: boolean;
  coinStillStrong: boolean;
  marketSupporting: boolean;
  leverageStillSafe: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function unrealizedPnlBps(side: PaperTradeSide, entry: number, mark: number): number {
  const raw = side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry;
  return raw * 10_000;
}

export function explainLosingTrade(input: RiskExplanationInput): RiskExplanationResult {
  const { side, entryPrice, markPrice, snapshot, thesisResult, socialHypeScore, exchangeTradable } =
    input;

  const pnlBps = unrealizedPnlBps(side, entryPrice, markPrice);
  const isLosing = pnlBps < -5;
  const factors: LosingTradeFactor[] = [];
  const factorLabels: string[] = [];

  const relVol = snapshot.relativeVolume ?? 1;
  const spreadBps = snapshot.ticker.spreadBps ?? 0;

  if (relVol < 0.7) {
    factors.push("VOLUME_DROPPED");
    factorLabels.push("Volume dropped");
  }

  if (spreadBps > 60 || (snapshot.liquidityUsd ?? 0) < 100_000) {
    factors.push("LIQUIDITY_DRIED_UP");
    factorLabels.push("Liquidity dried up");
  }

  if (thesisResult?.exitReason === "MOMENTUM_REVERSAL" || thesisResult?.exitReason === "SELL_PRESSURE_INCREASED") {
    factors.push("MARKET_REVERSED");
    factorLabels.push("Market reversed");
  }

  if (socialHypeScore !== null && socialHypeScore !== undefined && socialHypeScore < 40) {
    factors.push("SOCIAL_HYPE_FADED");
    factorLabels.push("Social hype faded");
  }

  if (exchangeTradable === false) {
    factors.push("EXCHANGE_ISSUE");
    factorLabels.push("Exchange support weakened");
  }

  if (pnlBps < -20 && relVol >= 1) {
    factors.push("BAD_ENTRY");
    factorLabels.push("Bad entry timing");
  }

  if (thesisResult?.exitReason === "MARKET_RISK_INCREASED") {
    factors.push("HIGH_VOLATILITY");
    factorLabels.push("High volatility");
  }

  if (thesisResult?.invalidationScore >= 20 && thesisResult.invalidationScore < 40) {
    factors.push("WEAK_TREND_CONFIRMATION");
    factorLabels.push("Weak trend confirmation");
  }

  const shouldExitEarly = thesisResult?.shouldExit ?? false;
  const isTradeStillValid = !shouldExitEarly && factors.length < 3;
  const riskIncreasing = (thesisResult?.invalidationScore ?? 0) >= 35;
  const coinStillStrong = relVol >= 1 && pnlBps > -30;
  const marketSupporting = !factors.includes("MARKET_REVERSED");
  const leverageStillSafe = spreadBps < 50 && !factors.includes("HIGH_VOLATILITY");

  let summary: string;
  if (!isLosing) {
    summary = "Trade is not in loss — monitoring thesis validity.";
  } else if (shouldExitEarly) {
    summary = `Exit now to avoid bigger loss — down ${pnlBps.toFixed(0)} bps (SIMULATED). ${
      thesisResult?.primaryFactor ?? "Thesis weakening"
    }.`;
  } else if (isTradeStillValid) {
    summary = `Hold — original thesis still valid despite ${pnlBps.toFixed(0)} bps drawdown (SIMULATED).`;
  } else {
    summary = `Trade no longer strong — ${factorLabels.slice(0, 2).join(", ") || "risk increasing"} (SIMULATED).`;
  }

  return {
    factors,
    factorLabels,
    summary,
    shouldExitEarly,
    isTradeStillValid,
    riskIncreasing,
    coinStillStrong,
    marketSupporting,
    leverageStillSafe,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
