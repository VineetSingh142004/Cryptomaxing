import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  evaluateAllBlueprintStrategies,
  type BlueprintStrategyMatchDebug,
} from "@/lib/trading/paper/strategy-mapping";

export type FormulaStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
export type ScoreSource = "REAL_CANDLES" | "TICKER_PROXY" | "DEFAULT_ZERO";

export interface StrategyFormulaCheck {
  strategyId: string;
  strategyName: string;
  formulaStatus: FormulaStatus;
  scoreSource: ScoreSource;
  dataAvailable: boolean;
  requiredFeatures: Array<{ name: string; threshold: string }>;
  actualValues: Record<string, number | string | boolean>;
  pass: boolean;
  failReason: string | null;
  zeroScoreReason: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface StrategyFormulaHealth {
  strategies: StrategyFormulaCheck[];
  bestCandidateSymbol: string | null;
  blueprintDebug: BlueprintStrategyMatchDebug | null;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function resolveScoreSource(candidate: ScanCandidate): ScoreSource {
  if (candidate.candlesLoaded) return "REAL_CANDLES";
  if ((candidate.momentumScore ?? 0) > 0 || (candidate.volatilityScore ?? 0) > 0) return "TICKER_PROXY";
  return "DEFAULT_ZERO";
}

function zeroReason(field: string, value: number, candidate: ScanCandidate): string | null {
  if (value !== 0) return null;
  if (field === "breakoutScore") {
    if (!candidate.candlesLoaded) return "breakoutScore=0 — fewer than 10 candles loaded (default)";
    return "breakoutScore=0 — no price breakout above prior 10-candle high (real formula, weak market)";
  }
  if (field === "trendScore") {
    if (!candidate.candlesLoaded) return "trendScore=0 — candle-derived trend inputs missing (default)";
    return "trendScore=0 — shortTermReturn, breakout, and 1h change all near zero (real formula)";
  }
  if (field === "momentumScore") {
    return "momentumScore=0 — momentumPct and 24h/1h change inputs near zero";
  }
  return null;
}

function buildStrategyCheck(
  candidate: ScanCandidate,
  strategy: {
    id: string;
    name: string;
    required: Array<{ name: string; threshold: string; test: () => boolean; actual: () => number | string | boolean }>;
    pass: boolean;
    failReason: string | null;
  },
): StrategyFormulaCheck {
  const actualValues: Record<string, number | string | boolean> = {};
  for (const req of strategy.required) {
    actualValues[req.name] = req.actual();
  }
  const primaryZero =
    zeroReason("breakoutScore", candidate.breakoutScore ?? 0, candidate) ??
    zeroReason("trendScore", candidate.trendScore ?? 0, candidate) ??
    zeroReason("momentumScore", candidate.momentumScore ?? 0, candidate);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    formulaStatus: "IMPLEMENTED",
    scoreSource: resolveScoreSource(candidate),
    dataAvailable: candidate.candlesLoaded === true || (candidate.dataQualityScore ?? 0) >= 40,
    requiredFeatures: strategy.required.map((r) => ({ name: r.name, threshold: r.threshold })),
    actualValues,
    pass: strategy.pass,
    failReason: strategy.failReason,
    zeroScoreReason: strategy.pass ? null : primaryZero,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildStrategyFormulaHealth(input: {
  ranked: ScanCandidate[];
  bestCandidate?: ScanCandidate | null;
}): StrategyFormulaHealth {
  const best =
    input.bestCandidate ??
    [...input.ranked].sort((a, b) => b.opportunityScore - a.opportunityScore)[0] ??
    null;

  if (!best) {
    return {
      strategies: [],
      bestCandidateSymbol: null,
      blueprintDebug: null,
      summary: "No candidates — strategy formula health unavailable.",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  const debug = evaluateAllBlueprintStrategies(best);
  const mom = best.momentumScore ?? 0;
  const trend = best.trendScore ?? 0;
  const breakout = best.breakoutScore ?? 0;
  const vol = best.volatilityScore ?? 0;
  const score = best.opportunityScore;
  const shortRet = best.shortTermReturnPct ?? 0;
  const change24 = Math.abs(best.change24hPct ?? 0);

  const strategies: StrategyFormulaCheck[] = [
    buildStrategyCheck(best, {
      id: "vwap-reclaim-momentum",
      name: "VWAP Reclaim Momentum",
      required: [
        { name: "momentumScore", threshold: ">= 60", test: () => mom >= 60, actual: () => mom },
        { name: "shortTermReturnPct", threshold: "> 0.2%", test: () => shortRet > 0.2, actual: () => shortRet },
        { name: "opportunityScore", threshold: ">= 65", test: () => score >= 65, actual: () => score },
        {
          name: "tradableOnConfiguredExchange",
          threshold: "true",
          test: () => best.tradableOnConfiguredExchange,
          actual: () => best.tradableOnConfiguredExchange,
        },
      ],
      pass: debug.vwapReclaimMomentum.passed,
      failReason: debug.vwapReclaimMomentum.passed
        ? null
        : (debug.vwapReclaimMomentum.missingConditions[0] ?? "conditions not met"),
    }),
    buildStrategyCheck(best, {
      id: "volatility-compression-breakout",
      name: "Volatility Compression Breakout",
      required: [
        { name: "breakoutScore", threshold: ">= 65", test: () => breakout >= 65, actual: () => breakout },
        { name: "volatilityScore", threshold: ">= 55", test: () => vol >= 55, actual: () => vol },
        { name: "change24hPct", threshold: "|change| >= 3%", test: () => change24 >= 3, actual: () => change24 },
        { name: "opportunityScore", threshold: ">= 68", test: () => score >= 68, actual: () => score },
        {
          name: "tradableOnConfiguredExchange",
          threshold: "true",
          test: () => best.tradableOnConfiguredExchange,
          actual: () => best.tradableOnConfiguredExchange,
        },
      ],
      pass: debug.volatilityCompressionBreakout.passed,
      failReason: debug.volatilityCompressionBreakout.passed
        ? null
        : (debug.volatilityCompressionBreakout.missingConditions[0] ?? "conditions not met"),
    }),
    buildStrategyCheck(best, {
      id: "trend-pullback-continuation",
      name: "Trend Pullback Continuation",
      required: [
        { name: "trendScore", threshold: ">= 55", test: () => trend >= 55, actual: () => trend },
        { name: "momentumScore", threshold: ">= 45", test: () => mom >= 45, actual: () => mom },
        {
          name: "opportunityScore",
          threshold: ">= 62 (or >= 70 fallback)",
          test: () => (trend >= 55 && mom >= 45) || score >= 70,
          actual: () => score,
        },
        {
          name: "tradableOnConfiguredExchange",
          threshold: "true",
          test: () => best.tradableOnConfiguredExchange,
          actual: () => best.tradableOnConfiguredExchange,
        },
      ],
      pass: debug.trendPullbackContinuation.passed,
      failReason: debug.trendPullbackContinuation.passed
        ? null
        : (debug.trendPullbackContinuation.missingConditions[0] ?? "conditions not met"),
    }),
  ];

  return {
    strategies,
    bestCandidateSymbol: best.symbol,
    blueprintDebug: debug,
    summary: `Best candidate ${best.symbol} — ${debug.finalReason}`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
