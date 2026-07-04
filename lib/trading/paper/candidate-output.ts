import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import type { DexScreenerPairSummary } from "@/lib/trading/data/providers/dexscreener";
import type { DefiLlamaSummary } from "@/lib/trading/data/providers/defillama";
import type { LunarCrushSummary } from "@/lib/trading/data/providers/lunarcrush";
import type { ScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ProviderContribution } from "@/lib/trading/paper/provider-contribution";
import { evaluatePaperLeverage } from "@/lib/trading/paper/paper-leverage";
import { calculatePaperPositionSize } from "@/lib/trading/paper/capital-allocation";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import type { RiskTier } from "@/lib/trading/paper/scanner-config";

export type FinalRecommendation = "BUY" | "WATCH" | "AVOID" | "LEVERAGE_POSSIBLE";
export type RecommendedTradeTypeLabel = "spot" | "margin" | "perp" | "avoid" | "watch";

export interface EnrichedCoinData {
  dex?: DexScreenerPairSummary;
  defi?: DefiLlamaSummary;
  social?: LunarCrushSummary;
  providerStatus: Record<string, "ok" | "unavailable" | "disabled" | "skipped" | "not_found" | "no_key">;
}

export interface FinalCandidateOutput {
  name: string;
  symbol: string;
  baseAsset: string;
  currentPrice: number;
  volume24hUsd: number;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  change24hPct: number;
  change7dPct: number | null;
  scores: {
    momentum: number;
    volume: number;
    liquidity: number;
    socialHype: number;
    exchange: number;
    risk: number;
    finalTotal: number;
    confidenceLevel: string;
    riskLevel: string;
  };
  availability: ExchangeAvailabilityResult;
  enriched: EnrichedCoinData;
  providerContribution: ProviderContribution;
  recommendedTradeType: RecommendedTradeTypeLabel;
  availabilitySummary: {
    krakenSpotAvailable: string;
    krakenLeverageAvailable: string;
    perpFuturesAvailable: string;
    usAvailability: string;
    bestExchange: string;
  };
  recommendedLeverage: string;
  leverageDetail: {
    leverageAvailable: string;
    usLeverageAvailable: string;
    recommendedLeverage: number;
    leverageReason: string;
    riskWithLeverage: string;
    liquidationRisk: string | null;
    marketType: string;
    useLeverage: boolean;
  };
  recommendedCapitalAllocationPct: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitTarget: number | null;
  exitConditions: string[];
  finalRecommendation: FinalRecommendation;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function deriveFinalRecommendation(input: {
  availability: ExchangeAvailabilityResult;
  action: string;
  finalScore: number;
  confidenceLevel: string;
}): FinalRecommendation {
  if (input.availability.recommendedAction === "AVOID") return "AVOID";
  if (input.action === "WATCHLIST_ONLY" || input.availability.krakenSpotAvailable === "UNKNOWN") {
    return "WATCH";
  }
  if (
    input.availability.recommendedAction === "LEVERAGE_POSSIBLE" &&
    input.availability.usLeverageAvailable !== "NO" &&
    input.availability.krakenMarginAvailable === "YES"
  ) {
    return "LEVERAGE_POSSIBLE";
  }
  if (input.action === "OPEN_TRADE" && input.availability.krakenSpotAvailable === "YES") {
    return "BUY";
  }
  if (input.finalScore >= PAPER_CONFIG.minOpportunityScore && input.confidenceLevel !== "LOW") {
    return "WATCH";
  }
  return input.action === "OPEN_TRADE" ? "BUY" : "WATCH";
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

function deriveRecommendedTradeType(input: {
  availability: ExchangeAvailabilityResult;
  leverage: ReturnType<typeof evaluatePaperLeverage>;
  action: string;
}): RecommendedTradeTypeLabel {
  if (input.availability.recommendedAction === "AVOID") return "avoid";
  if (input.availability.krakenSpotAvailable === "NO") return "avoid";
  if (input.leverage.marketType === "futures" && input.leverage.leverageAvailable === "YES") return "perp";
  if (input.leverage.marketType === "margin" && input.leverage.useLeverage) return "margin";
  if (input.availability.krakenSpotAvailable === "YES") return "spot";
  return "watch";
}

export function buildFinalCandidateOutput(input: {
  name: string;
  symbol: string;
  baseAsset: string;
  currentPrice: number;
  volume24hUsd: number;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  change24hPct: number;
  change7dPct?: number | null;
  availability: ExchangeAvailabilityResult;
  enriched: EnrichedCoinData;
  action: string;
  scoreBreakdown: ScoreBreakdown;
  riskTier: RiskTier;
  providerContribution?: ProviderContribution;
}): FinalCandidateOutput {
  const stopPct = tierStopLossBps(input.riskTier) / 10_000;
  const tpPct = tierTakeProfitBps(input.riskTier) / 10_000;
  const entryPrice = input.action === "OPEN_TRADE" ? input.currentPrice : null;
  const stopLossPrice = entryPrice ? entryPrice * (1 - stopPct) : null;
  const takeProfitTarget = entryPrice ? entryPrice * (1 + tpPct) : null;

  const confidence =
    input.scoreBreakdown.confidenceLevel === "HIGH"
      ? 0.9
      : input.scoreBreakdown.confidenceLevel === "MEDIUM"
        ? 0.75
        : input.scoreBreakdown.finalScore / 100;

  const leverage = evaluatePaperLeverage({
    availability: input.availability,
    confidence,
    opportunityScore: input.scoreBreakdown.finalScore,
    liquidityScore: input.scoreBreakdown.liquidityScore,
    volatilityPct: input.scoreBreakdown.volatilityScore / 10,
    stopDistancePct: stopPct * 100,
    riskTier: input.riskTier,
    hasClearStopLoss: entryPrice !== null,
  });

  const sizing = entryPrice
    ? calculatePaperPositionSize({
        entryPrice,
        stopDistancePct: stopPct * 100,
        confidence,
        opportunityScore: input.scoreBreakdown.finalScore,
        riskTier: input.riskTier,
        volatilityPct: input.scoreBreakdown.volatilityScore / 10,
        liquidityScore: input.scoreBreakdown.liquidityScore,
        leverage: leverage.leverageUsed,
        downsideRiskScore: input.scoreBreakdown.pumpRiskPenalty,
      })
    : null;

  const finalRecommendation = deriveFinalRecommendation({
    availability: input.availability,
    action: input.action,
    finalScore: input.scoreBreakdown.finalScore,
    confidenceLevel: input.scoreBreakdown.confidenceLevel,
  });

  const recommendedTradeType = deriveRecommendedTradeType({
    availability: input.availability,
    leverage,
    action: input.action,
  });

  const recommendedLeverage = leverage.leverageReason;

  return {
    name: input.name,
    symbol: input.symbol,
    baseAsset: input.baseAsset,
    currentPrice: input.currentPrice,
    volume24hUsd: input.volume24hUsd,
    marketCapUsd: input.marketCapUsd,
    liquidityUsd: input.liquidityUsd,
    change24hPct: input.change24hPct,
    change7dPct: input.change7dPct ?? null,
    scores: {
      momentum: input.scoreBreakdown.momentumScore,
      volume: input.scoreBreakdown.volumeScore,
      liquidity: input.scoreBreakdown.liquidityScore,
      socialHype: input.scoreBreakdown.socialHypeScore,
      exchange: input.scoreBreakdown.exchangeAvailabilityScore,
      risk: input.scoreBreakdown.riskScore,
      finalTotal: input.scoreBreakdown.finalScore,
      confidenceLevel: input.scoreBreakdown.confidenceLevel,
      riskLevel: input.scoreBreakdown.riskLevel,
    },
    availability: input.availability,
    enriched: input.enriched,
    providerContribution:
      input.providerContribution ??
      ({
        dataSourcesUsed: [],
        coingeckoUsed: false,
        krakenUsed: false,
        dexscreenerUsed: false,
        defillamaUsed: false,
        lunarcrushUsed: false,
        dexscreenerLiquidity: null,
        dexscreenerVolume24h: null,
        dexscreenerBuyPressure: null,
        defillamaTvl: null,
        defillamaChainActivity: null,
        providerWarnings: [],
      } satisfies ProviderContribution),
    recommendedTradeType,
    availabilitySummary: {
      krakenSpotAvailable: input.availability.krakenSpotAvailable,
      krakenLeverageAvailable: input.availability.krakenMarginAvailable,
      perpFuturesAvailable: input.availability.krakenFuturesAvailable,
      usAvailability: input.availability.usLeverageAvailable,
      bestExchange: input.availability.bestExchange,
    },
    recommendedLeverage,
    leverageDetail: {
      leverageAvailable: leverage.leverageAvailable,
      usLeverageAvailable: leverage.usLeverageAvailable,
      recommendedLeverage: leverage.recommendedLeverage,
      leverageReason: leverage.leverageReason,
      riskWithLeverage: leverage.riskWithLeverage,
      liquidationRisk: leverage.liquidationRisk,
      marketType: leverage.marketType,
      useLeverage: leverage.useLeverage,
    },
    recommendedCapitalAllocationPct: sizing?.capitalAllocationPct ?? 0,
    entryPrice,
    stopLossPrice,
    takeProfitTarget,
    exitConditions: [
      `Stop-loss at ${stopLossPrice?.toFixed(6) ?? "—"} (SIMULATED)`,
      `Take-profit at ${takeProfitTarget?.toFixed(6) ?? "—"} (SIMULATED)`,
      "Exit early on thesis invalidation: volume collapse, momentum reversal, liquidity weakening",
      "EARLY_LOSS_CUT when downside risk increases (SIMULATED)",
      "Paper-only — no live orders",
    ],
    finalRecommendation,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
