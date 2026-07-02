import type { NormalizedCandle } from "@/lib/trading/data/types";

export interface SignalContext {
  candles: NormalizedCandle[];
  index: number;
  parameters: Record<string, number>;
}

export interface TradeSignal {
  direction: "long" | "short";
  entryIndex: number;
  stopPrice: number;
  targetPrice: number;
  reason: string;
  regime: string;
}

function vwap(candles: NormalizedCandle[], endIndex: number, lookback: number): number {
  const slice = candles.slice(Math.max(0, endIndex - lookback), endIndex + 1);
  let pv = 0;
  let vol = 0;
  for (const c of slice) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : candles[endIndex].close;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    if (i === period - 1) {
      out.push(prev);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function avgVolume(candles: NormalizedCandle[], endIndex: number, lookback: number): number {
  const slice = candles.slice(Math.max(0, endIndex - lookback), endIndex);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

function bollingerWidth(closes: number[], endIndex: number, period: number): number {
  const slice = closes.slice(Math.max(0, endIndex - period + 1), endIndex + 1);
  if (slice.length < period) return Infinity;
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return mean > 0 ? (2 * std) / mean : Infinity;
}

export function generateVwapReclaimSignal(ctx: SignalContext): TradeSignal | null {
  const { candles, index, parameters } = ctx;
  if (index < 30) return null;

  const minRelVol = parameters.minRelativeVolume ?? 1.2;
  const maxExt = parameters.maxVwapExtensionPct ?? 0.5;

  const vw = vwap(candles, index, 60);
  const prev = candles[index - 1];
  const curr = candles[index];
  const avgVol = avgVolume(candles, index, 20);
  const relVol = avgVol > 0 ? curr.volume / avgVol : 0;

  const wasBelow = prev.close < vwap(candles, index - 1, 60);
  const reclaims = curr.close > vw;
  const extension = Math.abs((curr.close - vw) / vw) * 100;

  if (!wasBelow || !reclaims || relVol < minRelVol || extension > maxExt) return null;

  const stop = curr.low;
  const risk = curr.close - stop;
  if (risk <= 0) return null;

  return {
    direction: "long",
    entryIndex: index + 1,
    stopPrice: stop,
    targetPrice: curr.close + risk * (parameters.secondTargetR ?? 2),
    reason: "vwap_reclaim",
    regime: relVol > 1.5 ? "high_volume" : "normal",
  };
}

export function generateVolCompressionSignal(ctx: SignalContext): TradeSignal | null {
  const { candles, index, parameters } = ctx;
  if (index < 40) return null;

  const closes = candles.map((c) => c.close);
  const width = bollingerWidth(closes, index, 20);
  const priorWidth = bollingerWidth(closes, index - 5, 20);
  const compressed = width < priorWidth * 0.85;
  const curr = candles[index];
  const prev = candles[index - 1];

  const rangeHigh = Math.max(...candles.slice(index - 20, index).map((c) => c.high));
  const breaksOut = curr.close > rangeHigh && curr.close > curr.open;
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  const bodyStrong = range > 0 && body / range > 0.6;

  const avgVol = avgVolume(candles, index, 20);
  const relVol = avgVol > 0 ? curr.volume / avgVol : 0;
  const minRelVol = parameters.minRelativeVolume ?? 1.5;

  if (!compressed || !breaksOut || !bodyStrong || relVol < minRelVol) return null;

  const stop = Math.min(prev.low, rangeHigh * 0.998);
  const risk = curr.close - stop;
  if (risk <= 0) return null;

  return {
    direction: "long",
    entryIndex: index + 1,
    stopPrice: stop,
    targetPrice: curr.close + risk * (parameters.secondTargetR ?? 2.5),
    reason: "vol_compression_breakout",
    regime: "expansion",
  };
}

export function generateTrendPullbackSignal(ctx: SignalContext): TradeSignal | null {
  const { candles, index, parameters } = ctx;
  if (index < 50) return null;

  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  if (Number.isNaN(e9[index]) || Number.isNaN(e20[index])) return null;

  const uptrend = e9[index] > e20[index] && e9[index - 5] > e20[index - 5];
  if (!uptrend) return null;

  const curr = candles[index];
  const vw = vwap(candles, index, 40);
  const nearSupport = curr.low <= vw * 1.002 && curr.close >= vw;
  const avgVol = avgVolume(candles, index, 20);
  const pullbackVol = candles[index - 1].volume;
  const relVol = avgVol > 0 ? curr.volume / avgVol : 0;
  const volReturn = curr.volume > pullbackVol;

  if (!nearSupport || !volReturn || relVol < (parameters.minRelativeVolume ?? 1.0)) return null;

  const stop = curr.low;
  const risk = curr.close - stop;
  if (risk <= 0) return null;

  return {
    direction: "long",
    entryIndex: index + 1,
    stopPrice: stop,
    targetPrice: curr.close + risk * (parameters.secondTargetR ?? 2),
    reason: "trend_pullback",
    regime: "trend_up",
  };
}

export type SignalGenerator = (ctx: SignalContext) => TradeSignal | null;

export const SIGNAL_GENERATORS: Record<string, SignalGenerator> = {
  "vwap-reclaim-momentum": generateVwapReclaimSignal,
  "volatility-compression-breakout": generateVolCompressionSignal,
  "trend-pullback-continuation": generateTrendPullbackSignal,
};
