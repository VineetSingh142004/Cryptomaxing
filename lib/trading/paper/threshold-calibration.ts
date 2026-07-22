import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { computeScoreDistribution } from "@/lib/trading/paper/feature-score-health";
import { scoreForCalibration } from "@/lib/trading/paper/strategy-score-state";

export interface StrategyCalibrationRow {
  strategyName: string;
  feature: string;
  currentThreshold: number;
  topCandidateValue: number;
  maxValue: number;
  p90Value: number;
  medianValue: number;
  autoAdjustRecommended: false;
  conclusion: string;
}

export interface ThresholdCalibrationReport {
  strategies: StrategyCalibrationRow[];
  recommendation: string;
  thresholdsChanged: false;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * 0.9);
  return sorted[idx] ?? 0;
}

function row(
  strategyName: string,
  feature: string,
  threshold: number,
  ranked: ScanCandidate[],
  pick: (c: ScanCandidate) => number | null,
): StrategyCalibrationRow {
  const values = ranked.map(pick).filter((v): v is number => v !== null);
  const dist = computeScoreDistribution(values);
  const top = [...ranked].sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
  const topRaw = top ? pick(top) : null;
  const topVal = topRaw ?? 0;
  const p90Val = p90(values);
  let conclusion = "threshold aligned with current distribution";
  if (values.length === 0) {
    conclusion = "NOT_COMPUTED for all candidates — excluded from calibration; verify candles before lowering threshold";
  } else if (dist.max === 0) {
    conclusion = "max always 0 — likely formula/data issue OR no market breakout/trend; verify candles before lowering threshold";
  } else if (topVal < threshold && p90Val < threshold) {
    conclusion = `threshold ${threshold} above top (${topVal.toFixed(0)}) and p90 (${p90Val.toFixed(0)}) — market weak OR threshold too high OR score bug`;
  } else if (topVal < threshold) {
    conclusion = `threshold ${threshold} above top candidate ${topVal.toFixed(0)} but p90 is ${p90Val.toFixed(0)} — review near-misses before changing threshold`;
  }

  return {
    strategyName,
    feature,
    currentThreshold: threshold,
    topCandidateValue: topVal,
    maxValue: dist.max,
    p90Value: p90Val,
    medianValue: dist.median,
    autoAdjustRecommended: false,
    conclusion,
  };
}

export function buildThresholdCalibrationReport(ranked: ScanCandidate[]): ThresholdCalibrationReport {
  const strategies: StrategyCalibrationRow[] = [
    row("VWAP Reclaim Momentum", "momentumScore", 60, ranked, (c) => c.momentumScore ?? 0),
    row("VWAP Reclaim Momentum", "shortTermReturnPct", 0.2, ranked, (c) => c.shortTermReturnPct ?? 0),
    row("VWAP Reclaim Momentum", "opportunityScore", 65, ranked, (c) => c.opportunityScore ?? 0),
    row(
      "Volatility Compression Breakout",
      "breakoutScore",
      65,
      ranked,
      (c) => scoreForCalibration(c.breakoutScore ?? null, c.breakoutScoreStatus ?? "COMPUTED"),
    ),
    row("Volatility Compression Breakout", "volatilityScore", 55, ranked, (c) => c.volatilityScore ?? 0),
    row("Volatility Compression Breakout", "change24hPct", 3, ranked, (c) => Math.abs(c.change24hPct ?? 0)),
    row(
      "Trend Pullback Continuation",
      "trendScore",
      55,
      ranked,
      (c) => scoreForCalibration(c.trendScore ?? null, c.trendScoreStatus ?? "COMPUTED"),
    ),
    row("Trend Pullback Continuation", "momentumScore", 45, ranked, (c) => c.momentumScore ?? 0),
  ];

  return {
    strategies,
    recommendation:
      "Thresholds are NOT auto-adjusted. Change only after confirming feature health and shadow replay show blocks are too strict.",
    thresholdsChanged: false,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
