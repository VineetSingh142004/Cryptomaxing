import type { NormalizedCandle, NormalizedMarketSnapshot, NormalizedOrderBook } from "@/lib/trading/data/types";
import { computeDepthAtBps } from "@/lib/trading/data/quality-gates";

export interface PriceFeatures {
  return15s: number | null;
  return30s: number | null;
  return1m: number;
  return3m: number | null;
  return5m: number;
  return15m: number | null;
  return1h: number | null;
  vwapDistance: number | null;
  ema9Distance: number | null;
  ema20Distance: number | null;
  ema50Distance: number | null;
  ema200Distance: number | null;
  candleBodyStrength: number;
  wickRejection: number;
  candleCloseLocation: number;
  breakoutDistance: number | null;
  pullbackDepth: number | null;
  retestQuality: number | null;
}

export interface VolumeFeatures {
  relativeVolume: number | null;
  volumeAcceleration: number | null;
  buyerSellerImbalance: number | null;
  volumeFade: boolean;
  abnormalSpike: boolean;
  aggressiveBuyerPressure: number | null;
  aggressiveSellerPressure: number | null;
}

export interface VolatilityFeatures {
  atr: number;
  realizedVolatility: number;
  bollingerWidth: number;
  compression: boolean;
  expansion: boolean;
  wickRisk: number;
  liquidationWickRisk: number | null;
}

export interface OrderBookFeatures {
  spreadBps: number;
  depth10Bps: number;
  depth25Bps: number;
  depth50Bps: number;
  bidAskImbalance: number;
  liquidityWalls: boolean;
  spoofingSuspicion: number;
  bookThinning: boolean;
  sellWallStrength: number;
  bidWallStrength: number;
}

export interface ExecutionFeatures {
  expectedSlippageBps: number;
  fillProbability: number;
  makerFeeImpactBps: number;
  takerFeeImpactBps: number;
  fundingImpactBps: number | null;
  queueRisk: number;
  exitLiquidity: number;
  latencySensitivity: number;
}

export interface RegimeFeatures {
  btcTrend: "up" | "down" | "flat" | "NOT_IMPLEMENTED";
  ethTrend: "up" | "down" | "flat" | "NOT_IMPLEMENTED";
  solTrend: "up" | "down" | "flat" | "NOT_IMPLEMENTED";
  marketBreadth: number | null;
  correlation: number | null;
  riskOnOff: "risk_on" | "risk_off" | "neutral" | "NOT_IMPLEMENTED";
  crashRisk: number;
  liquidityRegime: "high" | "normal" | "low";
  sessionQuality: number;
  chopScore: number;
  trendStrength: number;
}

export interface MarketQualityScore {
  score: number;
  decision: "TRADEABLE" | "MARGINAL" | "BLOCK";
  reasonCodes: string[];
}

export interface ComputedFeatures {
  symbol: string;
  price: PriceFeatures;
  volume: VolumeFeatures;
  volatility: VolatilityFeatures;
  orderBook: OrderBookFeatures | null;
  execution: ExecutionFeatures;
  regime: RegimeFeatures;
  marketQuality: MarketQualityScore;
  computedAt: string;
  dataSource: string;
  version: string;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function computeReturn(candles: NormalizedCandle[], periods: number): number | null {
  if (candles.length <= periods) return null;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 1 - periods].close;
  if (prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

function computeVwap(candles: NormalizedCandle[]): number | null {
  if (candles.length === 0) return null;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : null;
}

function computeAtr(candles: NormalizedCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function computeBollingerWidth(closes: number[], period = 20): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return mean > 0 ? ((2 * std) / mean) * 100 : 0;
}

function trendFromCandles(candles: NormalizedCandle[]): "up" | "down" | "flat" {
  if (candles.length < 10) return "flat";
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  if (e9 === null || e20 === null) return "flat";
  const diff = ((e9 - e20) / e20) * 100;
  if (diff > 0.15) return "up";
  if (diff < -0.15) return "down";
  return "flat";
}

export function computePriceFeatures(candles1m: NormalizedCandle[], price: number): PriceFeatures {
  const closes = candles1m.map((c) => c.close);
  const last = candles1m.at(-1);
  const vwap = computeVwap(candles1m.slice(-60));

  let candleBodyStrength = 0;
  let wickRejection = 0;
  let candleCloseLocation = 0.5;

  if (last) {
    const range = last.high - last.low;
    const body = Math.abs(last.close - last.open);
    candleBodyStrength = range > 0 ? body / range : 0;
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    wickRejection = range > 0 ? Math.max(upperWick, lowerWick) / range : 0;
    candleCloseLocation = range > 0 ? (last.close - last.low) / range : 0.5;
  }

  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);

  return {
    return15s: null,
    return30s: null,
    return1m: computeReturn(candles1m, 1) ?? 0,
    return3m: computeReturn(candles1m, 3),
    return5m: computeReturn(candles1m, 5) ?? 0,
    return15m: computeReturn(candles1m, 15),
    return1h: computeReturn(candles1m, 60),
    vwapDistance: vwap ? ((price - vwap) / vwap) * 100 : null,
    ema9Distance: e9 ? ((price - e9) / e9) * 100 : null,
    ema20Distance: e20 ? ((price - e20) / e20) * 100 : null,
    ema50Distance: e50 ? ((price - e50) / e50) * 100 : null,
    ema200Distance: e200 ? ((price - e200) / e200) * 100 : null,
    candleBodyStrength,
    wickRejection,
    candleCloseLocation,
    breakoutDistance: null,
    pullbackDepth: null,
    retestQuality: null,
  };
}

export function computeVolumeFeatures(snapshot: NormalizedMarketSnapshot): VolumeFeatures {
  const candles = snapshot.candles1m;
  const avg =
    candles.length > 0
      ? candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length)
      : 0;
  const last = candles.at(-1)?.volume ?? 0;
  const prev = candles.at(-2)?.volume ?? 0;
  const rel = snapshot.relativeVolume;

  return {
    relativeVolume: rel,
    volumeAcceleration: prev > 0 ? last / prev : null,
    buyerSellerImbalance: null,
    volumeFade: rel !== null && rel < 0.7,
    abnormalSpike: rel !== null && rel > 2.5,
    aggressiveBuyerPressure: null,
    aggressiveSellerPressure: null,
  };
}

export function computeVolatilityFeatures(candles1m: NormalizedCandle[]): VolatilityFeatures {
  const closes = candles1m.map((c) => c.close);
  const atr = computeAtr(candles1m);
  const bbWidth = computeBollingerWidth(closes);
  const recent = closes.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  const realizedVol =
    recent.length > 1
      ? (Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length) / mean) * 100
      : 0;

  const priorBb = computeBollingerWidth(closes.slice(0, -5));

  return {
    atr,
    realizedVolatility: realizedVol,
    bollingerWidth: bbWidth,
    compression: bbWidth < priorBb * 0.85,
    expansion: bbWidth > priorBb * 1.15,
    wickRisk: candles1m.at(-1)
      ? (candles1m.at(-1)!.high - candles1m.at(-1)!.low) / (candles1m.at(-1)!.close || 1)
      : 0,
    liquidationWickRisk: null,
  };
}

export function computeOrderBookFeatures(
  orderBook: NormalizedOrderBook | null,
  spreadBps: number,
): OrderBookFeatures | null {
  if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) return null;

  const bestBid = orderBook.bids[0].price;
  const bestAsk = orderBook.asks[0].price;
  const mid = (bestBid + bestAsk) / 2;

  const bidDepth = orderBook.bids.reduce((s, l) => s + l.price * l.size, 0);
  const askDepth = orderBook.asks.reduce((s, l) => s + l.price * l.size, 0);
  const total = bidDepth + askDepth;

  const maxBid = Math.max(...orderBook.bids.map((l) => l.price * l.size));
  const maxAsk = Math.max(...orderBook.asks.map((l) => l.price * l.size));

  return {
    spreadBps,
    depth10Bps: computeDepthAtBps(orderBook, "bid", 10, mid) + computeDepthAtBps(orderBook, "ask", 10, mid),
    depth25Bps: computeDepthAtBps(orderBook, "bid", 25, mid) + computeDepthAtBps(orderBook, "ask", 25, mid),
    depth50Bps: computeDepthAtBps(orderBook, "bid", 50, mid) + computeDepthAtBps(orderBook, "ask", 50, mid),
    bidAskImbalance: total > 0 ? (bidDepth - askDepth) / total : 0,
    liquidityWalls: maxBid > bidDepth * 0.3 || maxAsk > askDepth * 0.3,
    spoofingSuspicion: 0,
    bookThinning: total < 100_000,
    sellWallStrength: askDepth > 0 ? maxAsk / askDepth : 0,
    bidWallStrength: bidDepth > 0 ? maxBid / bidDepth : 0,
  };
}

export function computeExecutionFeatures(snapshot: NormalizedMarketSnapshot): ExecutionFeatures {
  const depth = snapshot.orderBook
    ? snapshot.orderBook.bids.reduce((s, l) => s + l.price * l.size, 0) +
      snapshot.orderBook.asks.reduce((s, l) => s + l.price * l.size, 0)
    : snapshot.liquidityUsd ?? 0;

  return {
    expectedSlippageBps: snapshot.slippageEstimate.bps,
    fillProbability: depth > 1_000_000 ? 0.95 : depth > 500_000 ? 0.85 : 0.6,
    makerFeeImpactBps: snapshot.feeModel.makerBps,
    takerFeeImpactBps: snapshot.feeModel.takerBps,
    fundingImpactBps: snapshot.metadata.fundingRate
      ? snapshot.metadata.fundingRate * 10_000
      : null,
    queueRisk: snapshot.slippageEstimate.confidence === "low" ? 0.7 : 0.3,
    exitLiquidity: depth,
    latencySensitivity: snapshot.ticker.latencyMs > 1000 ? 0.8 : 0.3,
  };
}

export function computeRegimeFeatures(
  snapshot: NormalizedMarketSnapshot,
  btcCandles?: NormalizedCandle[],
  ethCandles?: NormalizedCandle[],
): RegimeFeatures {
  const candles5m = snapshot.candles5m;
  const trendStrength = Math.abs(computeReturn(candles5m, 12) ?? 0);
  const chopScore = 100 - Math.min(trendStrength * 10, 100);

  return {
    btcTrend: btcCandles ? trendFromCandles(btcCandles) : "NOT_IMPLEMENTED",
    ethTrend: ethCandles ? trendFromCandles(ethCandles) : "NOT_IMPLEMENTED",
    solTrend: snapshot.symbol.startsWith("SOL") ? trendFromCandles(candles5m) : "NOT_IMPLEMENTED",
    marketBreadth: null,
    correlation: null,
    riskOnOff: "NOT_IMPLEMENTED",
    crashRisk: Math.min(Math.abs(snapshot.candles1m.at(-1)?.close ?? 0) > 0 ? (computeReturn(snapshot.candles1m, 5) ?? 0) * -1 : 0, 100),
    liquidityRegime:
      (snapshot.liquidityUsd ?? 0) > 5_000_000 ? "high" : (snapshot.liquidityUsd ?? 0) > 1_000_000 ? "normal" : "low",
    sessionQuality: snapshot.ticker.latencyMs < 500 ? 80 : 50,
    chopScore,
    trendStrength,
  };
}

export function computeMarketQuality(
  snapshot: NormalizedMarketSnapshot,
  vol: VolatilityFeatures,
  ob: OrderBookFeatures | null,
): MarketQualityScore {
  const reasons: string[] = [];
  let score = 100;

  if (snapshot.ticker.spreadBps > 15) {
    score -= 20;
    reasons.push("SPREAD_WIDE");
  }
  if ((snapshot.liquidityUsd ?? 0) < 1_000_000) {
    score -= 25;
    reasons.push("LIQUIDITY_LOW");
  }
  if (vol.compression) score += 5;
  if (ob?.bookThinning) {
    score -= 15;
    reasons.push("BOOK_THIN");
  }
  if (snapshot.slippageEstimate.bps > 10) {
    score -= 15;
    reasons.push("SLIPPAGE_HIGH");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    decision: score >= 70 ? "TRADEABLE" : score >= 45 ? "MARGINAL" : "BLOCK",
    reasonCodes: reasons,
  };
}

export function computeAllFeatures(
  snapshot: NormalizedMarketSnapshot,
  context?: { btcCandles?: NormalizedCandle[]; ethCandles?: NormalizedCandle[] },
): ComputedFeatures {
  const price = computePriceFeatures(snapshot.candles1m, snapshot.ticker.price);
  const volume = computeVolumeFeatures(snapshot);
  const volatility = computeVolatilityFeatures(snapshot.candles1m);
  const orderBook = computeOrderBookFeatures(snapshot.orderBook, snapshot.ticker.spreadBps);
  const execution = computeExecutionFeatures(snapshot);
  const regime = computeRegimeFeatures(snapshot, context?.btcCandles, context?.ethCandles);
  const marketQuality = computeMarketQuality(snapshot, volatility, orderBook);

  return {
    symbol: snapshot.symbol,
    price,
    volume,
    volatility,
    orderBook,
    execution,
    regime,
    marketQuality,
    computedAt: new Date().toISOString(),
    dataSource: snapshot.ticker.source,
    version: "1.0.0",
  };
}
