import type { ExchangeAvailabilityResult, AvailabilityTriState } from "@/lib/trading/exchange/availability-types";
import { isConfirmedTradable } from "@/lib/trading/exchange/availability-types";
import { SCANNER_CONFIG, type RiskTier } from "@/lib/trading/paper/scanner-config";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type ScoreRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export interface ScoreBreakdown {
  volumeScore: number;
  momentumScore: number;
  liquidityScore: number;
  exchangeAvailabilityScore: number;
  krakenAvailabilityScore: number;
  leverageAvailabilityScore: number;
  perpFuturesAvailabilityScore: number;
  socialHypeScore: number;
  buySellPressureScore: number;
  marketCapRiskScore: number;
  volatilityScore: number;
  trendStrengthScore: number;
  spreadScore: number;
  dataQualityScore: number;
  downsideRiskScore: number;
  pumpRiskPenalty: number;
  riskScore: number;
  positiveTotal: number;
  riskTotal: number;
  finalScore: number;
  confidenceLevel: ConfidenceLevel;
  riskLevel: ScoreRiskLevel;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function triStateScore(v: AvailabilityTriState, yesPoints: number): number {
  if (v === "YES") return yesPoints;
  if (v === "UNKNOWN") return yesPoints * 0.35;
  return 0;
}

/** Leverage unknown must not boost score — only YES earns leverage points. */
function leverageScore(v: AvailabilityTriState): number {
  if (v === "YES") return 70;
  return 0;
}

function perpScore(v: AvailabilityTriState): number {
  if (v === "YES") return 60;
  return 0;
}

function marketCapRiskComponent(marketCapUsd: number | null, tier: RiskTier): number {
  if (!marketCapUsd || marketCapUsd <= 0) return tier === "MAJOR" ? 70 : 45;
  if (marketCapUsd >= 10_000_000_000) return 95;
  if (marketCapUsd >= 1_000_000_000) return 85;
  if (marketCapUsd >= 100_000_000) return 70;
  if (marketCapUsd >= 10_000_000) return 50;
  if (marketCapUsd >= 1_000_000) return 30;
  return 15;
}

function downsideRisk(input: {
  pumpRiskPenalty: number;
  riskTier: RiskTier;
  spreadBps: number;
  volume24hUsd: number;
  marketCapUsd: number | null;
}): number {
  let risk = input.pumpRiskPenalty;
  if (input.riskTier === "EXTREME_RISK") risk += 30;
  else if (input.riskTier === "HIGH_VOLATILITY") risk += 18;
  if (input.spreadBps > 100) risk += 15;
  if (input.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) risk += 20;
  if ((input.marketCapUsd ?? 0) > 0 && (input.marketCapUsd ?? 0) < 5_000_000) risk += 15;
  return clamp(risk);
}

export function deriveRiskLevel(tier: RiskTier, riskScore: number): ScoreRiskLevel {
  if (tier === "EXTREME_RISK" || riskScore >= 55) return "EXTREME";
  if (tier === "HIGH_VOLATILITY" || riskScore >= 40) return "HIGH";
  if (riskScore >= 25) return "MEDIUM";
  return "LOW";
}

export function deriveConfidenceLevel(
  finalScore: number,
  availability: ExchangeAvailabilityResult,
  dataQualityScore: number,
): ConfidenceLevel {
  if (!isConfirmedTradable(availability)) return "LOW";
  if (finalScore >= 78 && dataQualityScore >= 70 && availability.confidence === "high") return "HIGH";
  if (finalScore >= 62 && dataQualityScore >= 50) return "MEDIUM";
  return "LOW";
}

export function emptyScoreBreakdown(overrides?: Partial<ScoreBreakdown>): ScoreBreakdown {
  const base: ScoreBreakdown = {
    volumeScore: 0,
    momentumScore: 0,
    liquidityScore: 0,
    exchangeAvailabilityScore: 0,
    krakenAvailabilityScore: 0,
    leverageAvailabilityScore: 0,
    perpFuturesAvailabilityScore: 0,
    socialHypeScore: 50,
    buySellPressureScore: 50,
    marketCapRiskScore: 50,
    volatilityScore: 0,
    trendStrengthScore: 0,
    spreadScore: 0,
    dataQualityScore: 0,
    downsideRiskScore: 0,
    pumpRiskPenalty: 0,
    riskScore: 0,
    positiveTotal: 0,
    riskTotal: 0,
    finalScore: 0,
    confidenceLevel: "LOW",
    riskLevel: "HIGH",
  };
  return { ...base, ...overrides };
}

export interface WeightedScoreInput {
  volume24hUsd: number;
  change24hPct: number;
  change1hPct: number | null;
  marketCapUsd: number | null;
  spreadBps: number;
  momentumPct: number;
  volatilityPct: number;
  shortTermReturnPct: number;
  breakoutScore: number;
  volumeSpikeScore: number;
  dataQualityScore: number;
  riskTier: RiskTier;
  availability: ExchangeAvailabilityResult;
  socialHypeScore?: number | null;
  buySellPressureScore?: number | null;
  pumpRiskPenalty: number;
  riskTierPenalty?: number;
}

export function computeWeightedScore(input: WeightedScoreInput): ScoreBreakdown {
  const volumeScore = clamp(Math.log10(Math.max(input.volume24hUsd, 1)) * 12);
  const momentumScore = clamp(
    Math.abs(input.momentumPct) * 22 + Math.abs(input.change24hPct) * 1.6 + Math.abs(input.change1hPct ?? 0) * 2,
  );
  const liquidityScore = volumeScore;
  const exchangeAvailabilityScore = triStateScore(
    input.availability.krakenSpotAvailable,
    100,
  );
  const krakenAvailabilityScore = triStateScore(input.availability.listedOnKraken, 90);
  const leverageAvailabilityScore = leverageScore(input.availability.krakenMarginAvailable);
  const perpFuturesAvailabilityScore = perpScore(input.availability.krakenFuturesAvailable);
  const socialHypeScore = clamp(input.socialHypeScore ?? 50);
  const buySellPressureScore = clamp(input.buySellPressureScore ?? 50);
  const marketCapRiskScore = marketCapRiskComponent(input.marketCapUsd, input.riskTier);
  const volatilityScore =
    input.riskTier === "EXTREME_RISK" || input.riskTier === "HIGH_VOLATILITY"
      ? clamp(Math.abs(input.change24hPct) * 2 + input.volatilityPct * 8)
      : input.volatilityPct >= 0.3 && input.volatilityPct <= 8
        ? clamp(100 - Math.abs(input.volatilityPct - 2) * 15)
        : clamp(input.volatilityPct * 10);
  const trendStrengthScore = clamp(
    Math.abs(input.shortTermReturnPct) * 22 + input.breakoutScore * 0.4 + Math.abs(input.change1hPct ?? 0) * 3,
  );
  const spreadScore = clamp(100 - input.spreadBps * (input.riskTier === "MAJOR" ? 2.5 : 1.5));
  const dataQualityScore = clamp(input.dataQualityScore);
  const pumpRiskPenalty = clamp(input.pumpRiskPenalty);
  const downsideRiskScore = downsideRisk({
    pumpRiskPenalty,
    riskTier: input.riskTier,
    spreadBps: input.spreadBps,
    volume24hUsd: input.volume24hUsd,
    marketCapUsd: input.marketCapUsd,
  });
  const tierPenalty = input.riskTierPenalty ?? 0;

  const positiveTotal =
    volumeScore * 0.14 +
    momentumScore * 0.16 +
    liquidityScore * 0.12 +
    exchangeAvailabilityScore * 0.1 +
    krakenAvailabilityScore * 0.06 +
    leverageAvailabilityScore * 0.03 +
    perpFuturesAvailabilityScore * 0.02 +
    socialHypeScore * 0.05 +
    buySellPressureScore * 0.05 +
    marketCapRiskScore * 0.08 +
    volatilityScore * 0.07 +
    trendStrengthScore * 0.08 +
    spreadScore * 0.04;

  const riskTotal =
    (downsideRiskScore * 0.45 + pumpRiskPenalty * 0.35 + tierPenalty * 0.2) / 100 * 100;

  const finalScore = clamp(positiveTotal - riskTotal * 0.35);
  const riskScore = clamp(downsideRiskScore + pumpRiskPenalty * 0.5 + tierPenalty);

  return {
    volumeScore,
    momentumScore,
    liquidityScore,
    exchangeAvailabilityScore,
    krakenAvailabilityScore,
    leverageAvailabilityScore,
    perpFuturesAvailabilityScore,
    socialHypeScore,
    buySellPressureScore,
    marketCapRiskScore,
    volatilityScore,
    trendStrengthScore,
    spreadScore,
    dataQualityScore,
    downsideRiskScore,
    pumpRiskPenalty,
    riskScore,
    positiveTotal: clamp(positiveTotal),
    riskTotal: clamp(riskTotal),
    finalScore,
    confidenceLevel: deriveConfidenceLevel(finalScore, input.availability, dataQualityScore),
    riskLevel: deriveRiskLevel(input.riskTier, riskScore),
  };
}
