import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";

export type StrategyScoreStatus = "COMPUTED" | "NOT_COMPUTED" | "ZERO";

export const MIN_CANDLES_BREAKOUT = 10;
export const MIN_CANDLES_FULL_STRATEGY = 50;

export interface StrategyFeatureScores {
  breakoutScore: number | null;
  breakoutScoreStatus: StrategyScoreStatus;
  trendScore: number | null;
  trendScoreStatus: StrategyScoreStatus;
  shortTermReturnPct: number | null;
  shortTermReturnStatus: StrategyScoreStatus;
  candleCount: number;
  candlesLoaded: boolean;
  fullStrategyReady: boolean;
  blockReason: string | null;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function breakoutFromCandles(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < MIN_CANDLES_BREAKOUT) return 0;
  const recent = candles.slice(-MIN_CANDLES_BREAKOUT);
  const highs = recent.map((c) => c.high);
  const lastClose = recent.at(-1)?.close ?? 0;
  const priorHigh = Math.max(...highs.slice(0, -1));
  if (priorHigh <= 0) return 0;
  return clamp(((lastClose - priorHigh) / priorHigh) * 1000);
}

function shortTermReturn(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 3) return 0;
  const last = candles.at(-1)?.close ?? 0;
  const prev = candles.at(-4)?.close ?? last;
  if (prev <= 0) return 0;
  return ((last - prev) / prev) * 100;
}

function trendFromInputs(shortRet: number, breakout: number, change1h: number | null): number {
  const mix = shortRet * 0.45 + (breakout / 10) * 0.35 + (change1h ?? 0) * 0.2;
  return clamp(mix * 2);
}

export function computeStrategyFeatureScores(input: {
  candles: NormalizedMarketSnapshot["candles5m"];
  change1hPct?: number | null;
  trendStrengthFromFormula?: number;
}): StrategyFeatureScores {
  const count = input.candles.length;
  const candlesLoaded = count >= MIN_CANDLES_BREAKOUT;
  const fullStrategyReady = count >= MIN_CANDLES_FULL_STRATEGY;

  if (!candlesLoaded) {
    return {
      breakoutScore: null,
      breakoutScoreStatus: "NOT_COMPUTED",
      trendScore: null,
      trendScoreStatus: "NOT_COMPUTED",
      shortTermReturnPct: null,
      shortTermReturnStatus: "NOT_COMPUTED",
      candleCount: count,
      candlesLoaded: false,
      fullStrategyReady: false,
      blockReason: "STRATEGY_SCORING_BLOCKED_NO_CANDLES",
    };
  }

  const breakoutVal = breakoutFromCandles(input.candles);
  const shortRet = shortTermReturn(input.candles);
  const trendVal =
    input.trendStrengthFromFormula ?? trendFromInputs(shortRet, breakoutVal, input.change1hPct ?? null);

  return {
    breakoutScore: breakoutVal,
    breakoutScoreStatus: breakoutVal === 0 ? "ZERO" : "COMPUTED",
    trendScore: trendVal,
    trendScoreStatus: trendVal === 0 ? "ZERO" : "COMPUTED",
    shortTermReturnPct: shortRet,
    shortTermReturnStatus: shortRet === 0 ? "ZERO" : "COMPUTED",
    candleCount: count,
    candlesLoaded: true,
    fullStrategyReady,
    blockReason: fullStrategyReady ? null : "INSUFFICIENT_CANDLES_FOR_FULL_STRATEGY",
  };
}

export function scoreForCalibration(value: number | null, status: StrategyScoreStatus): number | null {
  if (status === "NOT_COMPUTED" || value === null) return null;
  return value;
}

export function displayScore(value: number | null, status: StrategyScoreStatus): string {
  if (status === "NOT_COMPUTED" || value === null) return "NOT_COMPUTED";
  return value.toFixed(1);
}
