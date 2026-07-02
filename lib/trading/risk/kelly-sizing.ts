import type { KellySizingInput, KellySizingResult } from "@/lib/trading/risk/types";

const RISK_BANDS = {
  conservative: { min: 0.1, max: 0.25 },
  normal: { min: 0.25, max: 0.5 },
  aggressive: { min: 0.5, max: 1.0 },
} as const;

const DEFAULT_KELLY_CAP = 0.2;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function losingStreakProb(winRate: number, streak: number): number {
  return Math.pow(1 - winRate, streak);
}

export function computeKellySizing(input: KellySizingInput): KellySizingResult {
  const {
    winRate,
    avgWin,
    avgLoss,
    accountEquity,
    sampleSize,
    correlatedExposure = 0,
    dailyRiskUsedPct = 0,
    weeklyRiskUsedPct = 0,
    riskBand = "normal",
    kellyCapFraction = DEFAULT_KELLY_CAP,
  } = input;

  const blockReasons: string[] = [];
  const band = RISK_BANDS[riskBand];

  const expectancy =
    avgLoss > 0 ? winRate * avgWin - (1 - winRate) * avgLoss : null;

  let kellyFraction: number | null = null;
  if (avgLoss > 0 && avgWin > 0) {
    const b = avgWin / avgLoss;
    kellyFraction = (winRate * b - (1 - winRate)) / b;
    if (kellyFraction < 0) kellyFraction = 0;
  }

  const cap = clamp(kellyCapFraction, 0.1, 0.25);
  const cappedKellyFraction =
    kellyFraction !== null ? kellyFraction * cap : null;

  let riskPerTradePct = band.min;
  if (cappedKellyFraction !== null) {
    riskPerTradePct = clamp(cappedKellyFraction * 100, band.min, band.max);
  }

  if (sampleSize < 30) {
    riskPerTradePct *= 0.5;
    blockReasons.push("LOW_SAMPLE_SIZE_REDUCED");
  }
  if (sampleSize < 10) {
    riskPerTradePct = band.min * 0.5;
    blockReasons.push("VERY_LOW_SAMPLE");
  }

  const correlationExposurePenalty = clamp(correlatedExposure * 30, 0, 50);
  riskPerTradePct *= 1 - correlationExposurePenalty / 100;

  const losingStreakProbability = losingStreakProb(winRate, 5);
  const maxExpectedDrawdownPct =
    expectancy !== null && expectancy > 0
      ? clamp(riskPerTradePct * 10 * (1 - winRate) * 5, 1, 25)
      : null;

  const ruinProb =
    losingStreakProbability * (riskPerTradePct / 100) * 10;
  const accountRiskOfRuin = clamp(ruinProb, 0, 1);

  const dailyRiskRemainingPct = clamp(2 - dailyRiskUsedPct, 0, 2);
  const weeklyRiskRemainingPct = clamp(5 - weeklyRiskUsedPct, 0, 5);

  if (riskPerTradePct > 1) blockReasons.push("RISK_ABOVE_1PCT_BLOCKED");
  if (accountRiskOfRuin > 0.15) blockReasons.push("RISK_OF_RUIN_TOO_HIGH");
  if (losingStreakProbability > 0.4 && riskPerTradePct > band.max * 0.5) {
    blockReasons.push("ACCOUNT_CANNOT_SURVIVE_STREAK");
  }
  if (correlatedExposure > 0.6) blockReasons.push("CORRELATED_EXPOSURE_HIGH");

  riskPerTradePct = clamp(riskPerTradePct, band.min, Math.min(band.max, 1));

  return {
    winRate,
    avgWin,
    avgLoss,
    expectancy,
    kellyFraction,
    cappedKellyFraction,
    riskPerTradePct,
    losingStreakProbability,
    maxExpectedDrawdownPct,
    accountRiskOfRuin,
    correlationExposurePenalty,
    dailyRiskRemainingPct,
    weeklyRiskRemainingPct,
    decision: blockReasons.some((r) =>
      ["RISK_OF_RUIN_TOO_HIGH", "RISK_ABOVE_1PCT_BLOCKED", "ACCOUNT_CANNOT_SURVIVE_STREAK"].includes(r),
    )
      ? "BLOCK"
      : "ALLOW",
    blockReasons,
    computedAt: new Date().toISOString(),
  };
}
