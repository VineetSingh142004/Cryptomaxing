import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";

export type FeatureScoreWarningFlag =
  | "FEATURE_SCORES_ALL_ZERO"
  | "BREAKOUT_SCORE_ALWAYS_ZERO"
  | "TREND_SCORE_ALWAYS_ZERO"
  | "MOMENTUM_TOO_LOW_FOR_ALL_CANDIDATES"
  | "CANDLES_MISSING_FOR_STRATEGY"
  | "STRATEGY_FEATURES_NOT_COMPUTED"
  | "STRATEGY_SCORING_BLOCKED_NO_CANDLES"
  | "MARKET_WEAK_NOT_BUG";

export interface ScoreDistribution {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  count: number;
}

export interface FeatureScoreHealth {
  distributions: {
    momentumScore: ScoreDistribution;
    trendScore: ScoreDistribution;
    breakoutScore: ScoreDistribution;
    volatilityScore: ScoreDistribution;
    liquidityScore: ScoreDistribution;
    volumeScore: ScoreDistribution;
    opportunityScore: ScoreDistribution;
    shortTermReturnPct: ScoreDistribution;
  };
  candleCount: {
    min: number;
    p25: number;
    median: number;
    p75: number;
    max: number;
    count: number;
  };
  candlesLoaded: boolean;
  candlesLoadedPct: number;
  providerSource: string;
  missingFeatureCount: number;
  warningFlags: FeatureScoreWarningFlag[];
  zeroScoreExplanations: {
    trendScore: string;
    breakoutScore: string;
  };
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (idx - lo);
}

export function computeScoreDistribution(values: number[]): ScoreDistribution {
  if (values.length === 0) {
    return { min: 0, p25: 0, median: 0, p75: 0, max: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? 0,
    count: sorted.length,
  };
}

function dominantProvider(candidates: ScanCandidate[]): string {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  }
  let best = "unknown";
  let bestCount = 0;
  for (const [source, count] of counts) {
    if (count > bestCount) {
      best = source;
      bestCount = count;
    }
  }
  return best;
}

function explainTrendZero(input: {
  candlesLoadedPct: number;
  maxTrend: number;
  maxShortReturn: number;
  missingCandles: boolean;
}): string {
  if (input.missingCandles) {
    return "trendScore is 0 because candle data is missing or insufficient — formula uses shortTermReturnPct, breakoutScore, and 1h change from candles.";
  }
  if (input.maxTrend === 0 && input.maxShortReturn === 0) {
    return "trendScore is 0 because market shows no short-term directional move — formula is implemented and candles are present, but inputs are near zero.";
  }
  if (input.maxTrend === 0) {
    return "trendScore max is 0 despite some return data — check breakoutScore and 1h change inputs; may be weak market not a default bug.";
  }
  return "trendScore computed from real candle/ticker inputs.";
}

function explainBreakoutZero(input: {
  candlesLoadedPct: number;
  maxBreakout: number;
  missingCandles: boolean;
}): string {
  if (input.missingCandles) {
    return "breakoutScore is 0 because fewer than 10 candles loaded — formula requires 10+ 5m candles to detect range breakout.";
  }
  if (input.maxBreakout === 0) {
    return "breakoutScore is 0 with candles present — price has not broken above the prior 10-candle high (market has no breakout, not a missing formula).";
  }
  return "breakoutScore computed from real 5m candle highs/closes.";
}

export function buildFeatureScoreHealth(input: {
  ranked: ScanCandidate[];
  providerSource?: string;
}): FeatureScoreHealth {
  const ranked = input.ranked;
  const candleCounts = ranked.map((c) => c.candleCount ?? (c.candlesLoaded ? 10 : 0));
  const candlesLoadedCount = ranked.filter((c) => c.candlesLoaded === true).length;
  const candlesLoadedPct = ranked.length > 0 ? candlesLoadedCount / ranked.length : 0;
  const missingCandles = candlesLoadedPct < 0.5;

  const distributions = {
    momentumScore: computeScoreDistribution(ranked.map((c) => c.momentumScore ?? 0)),
    trendScore: computeScoreDistribution(
      ranked
        .filter((c) => c.trendScoreStatus !== "NOT_COMPUTED")
        .map((c) => c.trendScore ?? 0),
    ),
    breakoutScore: computeScoreDistribution(
      ranked
        .filter((c) => c.breakoutScoreStatus !== "NOT_COMPUTED")
        .map((c) => c.breakoutScore ?? 0),
    ),
    volatilityScore: computeScoreDistribution(ranked.map((c) => c.volatilityScore ?? 0)),
    liquidityScore: computeScoreDistribution(ranked.map((c) => c.liquidityScore ?? 0)),
    volumeScore: computeScoreDistribution(ranked.map((c) => c.scoreBreakdown?.volumeScore ?? 0)),
    opportunityScore: computeScoreDistribution(ranked.map((c) => c.opportunityScore ?? 0)),
    shortTermReturnPct: computeScoreDistribution(ranked.map((c) => c.shortTermReturnPct ?? 0)),
  };

  const warningFlags: FeatureScoreWarningFlag[] = [];
  const allFeatureMaxZero =
    distributions.momentumScore.max === 0 &&
    distributions.trendScore.max === 0 &&
    distributions.breakoutScore.max === 0 &&
    distributions.volatilityScore.max === 0;

  if (ranked.length > 0 && allFeatureMaxZero) warningFlags.push("FEATURE_SCORES_ALL_ZERO");
  if (ranked.length > 0 && distributions.breakoutScore.max === 0) {
    warningFlags.push("BREAKOUT_SCORE_ALWAYS_ZERO");
  }
  if (ranked.length > 0 && distributions.trendScore.max === 0) {
    warningFlags.push("TREND_SCORE_ALWAYS_ZERO");
  }
  if (ranked.length > 0 && distributions.momentumScore.max < 30) {
    warningFlags.push("MOMENTUM_TOO_LOW_FOR_ALL_CANDIDATES");
  }
  const notComputedBreakout = ranked.filter((c) => c.breakoutScoreStatus === "NOT_COMPUTED").length;
  const notComputedTrend = ranked.filter((c) => c.trendScoreStatus === "NOT_COMPUTED").length;

  if (missingCandles || (notComputedBreakout > ranked.length * 0.5 && ranked.length > 0)) {
    warningFlags.push("STRATEGY_SCORING_BLOCKED_NO_CANDLES");
  }
  if (missingCandles) warningFlags.push("CANDLES_MISSING_FOR_STRATEGY");
  if (
    missingCandles &&
    distributions.breakoutScore.max === 0 &&
    distributions.trendScore.max === 0
  ) {
    warningFlags.push("STRATEGY_FEATURES_NOT_COMPUTED");
  }
  if (
    !missingCandles &&
    !allFeatureMaxZero &&
    distributions.opportunityScore.max < minScoreForAnyTier(ranked)
  ) {
    warningFlags.push("MARKET_WEAK_NOT_BUG");
  }

  let missingFeatureCount = 0;
  for (const c of ranked) {
    if ((c.candlesLoaded ?? false) === false) missingFeatureCount++;
    if ((c.breakoutScore ?? 0) === 0 && (c.candlesLoaded ?? false) === false) missingFeatureCount++;
  }

  const zeroScoreExplanations = {
    trendScore: explainTrendZero({
      candlesLoadedPct,
      maxTrend: distributions.trendScore.max,
      maxShortReturn: distributions.shortTermReturnPct.max,
      missingCandles,
    }),
    breakoutScore: explainBreakoutZero({
      candlesLoadedPct,
      maxBreakout: distributions.breakoutScore.max,
      missingCandles,
    }),
  };

  const summary =
    ranked.length === 0
      ? "No ranked candidates — feature health unavailable."
      : warningFlags.includes("STRATEGY_FEATURES_NOT_COMPUTED") ||
          warningFlags.includes("CANDLES_MISSING_FOR_STRATEGY")
        ? "Feature engine may be incomplete — candle-dependent scores defaulting to zero."
        : warningFlags.includes("MARKET_WEAK_NOT_BUG")
          ? "Features computed correctly — market scores are weak, not necessarily a bug."
          : `Feature distributions computed across ${ranked.length} ranked candidates.`;

  return {
    distributions,
    candleCount: computeScoreDistribution(candleCounts),
    candlesLoaded: candlesLoadedCount > 0,
    candlesLoadedPct,
    providerSource: input.providerSource ?? dominantProvider(ranked),
    missingFeatureCount,
    warningFlags,
    zeroScoreExplanations,
    summary,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function minScoreForAnyTier(ranked: ScanCandidate[]): number {
  return Math.min(...ranked.map((c) => (c.riskTier === "MAJOR" ? 62 : 65)));
}
