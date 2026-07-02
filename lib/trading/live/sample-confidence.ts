import type { CanaryStage, LiveTradeRecord, SampleConfidenceResult } from "@/lib/trading/live/types";

const STAGE_ORDER: CanaryStage[] = [
  "NO_LIVE",
  "TINY_CANARY",
  "MICRO_LIVE",
  "SMALL_LIVE",
  "CONTROLLED_LIVE",
  "NORMAL_AUTO",
];

function netPnl(t: LiveTradeRecord): number {
  return t.grossPnl - t.fees - t.spreadCost - t.slippage - t.funding;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function coverageScore(values: string[]): number {
  const unique = new Set(values.filter(Boolean));
  if (unique.size === 0) return 0;
  return Math.min(100, unique.size * 20);
}

/** Normal approx CI for mean net P&L per trade */
function expectancyCi(nets: number[]): { lower: number; upper: number } | null {
  if (nets.length < 3) return null;
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const se = stdDev(nets) / Math.sqrt(nets.length);
  return { lower: mean - 1.96 * se, upper: mean + 1.96 * se };
}

/** P(expectancy > 0) via normal CDF approximation */
function probPositiveExpectancy(nets: number[]): number | null {
  if (nets.length < 5) return null;
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const se = stdDev(nets) / Math.sqrt(nets.length);
  if (se === 0) return mean > 0 ? 1 : 0;
  const z = mean / se;
  return normalCdf(z);
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function analyzeSampleConfidence(input: {
  strategyId: string;
  trades: LiveTradeRecord[];
  profitFactorThreshold?: number;
}): SampleConfidenceResult {
  const reasonCodes: string[] = [];
  const trades = input.trades.filter((t) => t.strategyId === input.strategyId && t.reconciled !== false);
  const nets = trades.map(netPnl);
  const n = trades.length;
  const wins = nets.filter((x) => x > 0).length;
  const losses = n - wins;

  const grossProfit = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : null;
  const pfThreshold = input.profitFactorThreshold ?? 1.2;

  const largestTradeDependency =
    grossProfit > 0 ? Math.max(...nets.filter((x) => x > 0), 0) / grossProfit : null;

  const ci = expectancyCi(nets);
  const probPos = probPositiveExpectancy(nets);

  let probPfAbove: number | null = null;
  if (pf !== null && n >= 10) {
    probPfAbove = pf >= pfThreshold ? 0.7 + Math.min(n / 100, 0.25) : 0.3;
  }

  const winRate = n > 0 ? wins / n : 0;
  const probRandom = n >= 10 ? 2 * Math.min(winRate, 1 - winRate) : null;

  const reliability = Math.min(100, n * 2);
  const regimeCoverageScore = coverageScore(trades.map((t) => t.regime ?? ""));
  const sessionCoverageScore = coverageScore(trades.map((t) => t.session ?? ""));
  const assetCoverageScore = coverageScore(trades.map((t) => t.symbol));

  let maxAllowedStage: CanaryStage = "NO_LIVE";
  let scalingAllowed = false;

  if (n < 20) {
    maxAllowedStage = "TINY_CANARY";
    reasonCodes.push("LT_20_TRADES_NO_SCALING");
  } else if (n < 50) {
    maxAllowedStage = "TINY_CANARY";
    reasonCodes.push("LT_50_TINY_ONLY");
  } else if (n < 100) {
    maxAllowedStage = "SMALL_LIVE";
    reasonCodes.push("LT_100_SMALL_ONLY");
  } else {
    maxAllowedStage = "NORMAL_AUTO";
    scalingAllowed = true;
  }

  if (largestTradeDependency !== null && largestTradeDependency > 0.3) {
    scalingAllowed = false;
    maxAllowedStage = stageMin(maxAllowedStage, "SMALL_LIVE");
    reasonCodes.push("ONE_TRADE_GT_30PCT_PROFIT");
  }

  if (ci && ci.lower < 0) {
    scalingAllowed = false;
    reasonCodes.push("CI_INCLUDES_NEGATIVE_EXPECTANCY");
  }

  return {
    strategyId: input.strategyId,
    liveTradeCount: n,
    winningTradeCount: wins,
    losingTradeCount: losses,
    confidenceIntervalExpectancy: ci,
    probabilityExpectancyPositive: probPos,
    probabilityProfitFactorAboveThreshold: probPfAbove,
    probabilityStrategyIsRandom: probRandom,
    largestTradeDependency,
    liveSampleReliabilityScore: reliability,
    regimeCoverageScore,
    sessionCoverageScore,
    assetCoverageScore,
    maxAllowedStage,
    scalingAllowed,
    reasonCodes,
    auditedAt: new Date().toISOString(),
  };
}

function stageMin(a: CanaryStage, b: CanaryStage): CanaryStage {
  return STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(a), STAGE_ORDER.indexOf(b))]!;
}

export { STAGE_ORDER };
