import type { ComputedFeatures } from "@/lib/trading/features/compute";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { ScanDirection } from "@/lib/trading/scanning/types";

export interface StopCandidate {
  type: string;
  price: number;
  distancePct: number;
  reason: string;
}

export interface TrueInvalidationStopResult {
  symbol: string;
  direction: ScanDirection;
  entryPrice: number;
  recommendedStop: number;
  stopDistancePct: number;
  candidates: StopCandidate[];
  liquidationPrice: number | null;
  stopToLiquidationGapPct: number | null;
  maxPlannedLossPct: number;
  rewardToRisk: number | null;
  targetPrice: number | null;
  decision: "VALID" | "BLOCK";
  blockReasons: string[];
  adjustments: string[];
  computedAt: string;
}

export interface StopEngineInput {
  snapshot: NormalizedMarketSnapshot;
  features: ComputedFeatures;
  direction: "long" | "short";
  entryPrice?: number;
  targetPrice?: number;
  leverage?: number;
  accountRiskPct?: number;
  maxLossPct?: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function swingLow(candles: NormalizedMarketSnapshot["candles1m"], lookback = 10): number {
  const slice = candles.slice(-lookback);
  return Math.min(...slice.map((c) => c.low));
}

function swingHigh(candles: NormalizedMarketSnapshot["candles1m"], lookback = 10): number {
  const slice = candles.slice(-lookback);
  return Math.max(...slice.map((c) => c.high));
}

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i]! * k + prev * (1 - k);
  }
  return prev;
}

function computeVwap(candles: NormalizedMarketSnapshot["candles1m"]): number | null {
  let pv = 0;
  let vol = 0;
  for (const c of candles.slice(-60)) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : null;
}

export function computeTrueInvalidationStop(input: StopEngineInput): TrueInvalidationStopResult {
  const {
    snapshot,
    features,
    direction,
    leverage = 1,
    maxLossPct = 1,
    accountRiskPct = 0.5,
  } = input;
  const entry = input.entryPrice ?? snapshot.ticker.price;
  const closes = snapshot.candles1m.map((c) => c.close);
  const atr = features.volatility.atr;
  const blockReasons: string[] = [];
  const adjustments: string[] = [];
  const candidates: StopCandidate[] = [];

  const structure =
    direction === "long" ? swingLow(snapshot.candles1m) : swingHigh(snapshot.candles1m);
  candidates.push({
    type: "structure",
    price: structure,
    distancePct: Math.abs((entry - structure) / entry) * 100,
    reason: "Recent swing invalidation",
  });

  const atrMult = 1.5;
  const atrStop = direction === "long" ? entry - atr * atrMult : entry + atr * atrMult;
  candidates.push({
    type: "atr",
    price: atrStop,
    distancePct: Math.abs((entry - atrStop) / entry) * 100,
    reason: `${atrMult}x ATR buffer`,
  });

  const vwap = computeVwap(snapshot.candles1m);
  if (vwap !== null) {
    const vwapStop = direction === "long" ? vwap * 0.998 : vwap * 1.002;
    candidates.push({
      type: "vwap",
      price: vwapStop,
      distancePct: Math.abs((entry - vwapStop) / entry) * 100,
      reason: "VWAP invalidation",
    });
  }

  const e20 = ema(closes, 20);
  if (e20 !== null) {
    const emaStop = direction === "long" ? e20 * 0.997 : e20 * 1.003;
    candidates.push({
      type: "ema",
      price: emaStop,
      distancePct: Math.abs((entry - emaStop) / entry) * 100,
      reason: "EMA20 invalidation",
    });
  }

  const last = snapshot.candles1m.at(-1);
  if (last) {
    const sweepStop = direction === "long" ? last.low * 0.999 : last.high * 1.001;
    candidates.push({
      type: "liquidity_sweep",
      price: sweepStop,
      distancePct: Math.abs((entry - sweepStop) / entry) * 100,
      reason: "Reclaim candle wick invalidation",
    });
  }

  if (features.orderBook) {
    const bookStop =
      direction === "long"
        ? entry * (1 - features.orderBook.spreadBps / 10_000 * 3)
        : entry * (1 + features.orderBook.spreadBps / 10_000 * 3);
    candidates.push({
      type: "book_breakdown",
      price: bookStop,
      distancePct: Math.abs((entry - bookStop) / entry) * 100,
      reason: "Order book breakdown buffer",
    });
  }

  const momentumStop =
    direction === "long"
      ? entry - atr * (features.price.return1m < 0 ? 1.2 : 1.8)
      : entry + atr * (features.price.return1m > 0 ? 1.2 : 1.8);
  candidates.push({
    type: "momentum_failure",
    price: momentumStop,
    distancePct: Math.abs((entry - momentumStop) / entry) * 100,
    reason: "Momentum failure threshold",
  });

  if (last) {
    const closeStop = direction === "long" ? last.close * 0.998 : last.close * 1.002;
    candidates.push({
      type: "candle_close",
      price: closeStop,
      distancePct: Math.abs((entry - closeStop) / entry) * 100,
      reason: "Candle close invalidation",
    });
  }

  const validCandidates = candidates.filter((c) => {
    const dist = c.distancePct;
    const minNoise = (atr / entry) * 100 * 0.8;
    return dist >= minNoise && dist <= maxLossPct * 3;
  });

  let recommended =
    direction === "long"
      ? Math.min(...validCandidates.map((c) => c.price))
      : Math.max(...validCandidates.map((c) => c.price));

  const wickAdj = features.price.wickRejection * atr * 0.3;
  recommended = direction === "long" ? recommended - wickAdj : recommended + wickAdj;
  if (wickAdj > 0) adjustments.push("WICK_BUFFER");

  const spreadAdj = snapshot.ticker.spreadBps / 10_000 * entry;
  recommended = direction === "long" ? recommended - spreadAdj : recommended + spreadAdj;
  adjustments.push("SPREAD_BUFFER");

  const slipAdj = (features.execution.expectedSlippageBps / 10_000) * entry;
  recommended = direction === "long" ? recommended - slipAdj : recommended + slipAdj;
  adjustments.push("SLIPPAGE_BUFFER");

  let stopDistancePct = Math.abs((entry - recommended) / entry) * 100;

  const maxPlannedLossPct = Math.min(maxLossPct, accountRiskPct * 2);
  if (stopDistancePct > maxPlannedLossPct * 2) {
    blockReasons.push("STOP_TOO_WIDE_RR_FAILS");
  }
  if (stopDistancePct < (atr / entry) * 100 * 0.5) {
    blockReasons.push("STOP_INSIDE_NOISE");
  }

  const liquidationPrice =
    leverage > 1
      ? direction === "long"
        ? entry * (1 - 0.9 / leverage)
        : entry * (1 + 0.9 / leverage)
      : null;

  let stopToLiquidationGapPct: number | null = null;
  if (liquidationPrice !== null) {
    stopToLiquidationGapPct =
      Math.abs((recommended - liquidationPrice) / entry) * 100;
    if (stopToLiquidationGapPct < stopDistancePct * 0.5) {
      blockReasons.push("STOP_TOO_CLOSE_TO_LIQUIDATION");
    }
  }

  const target = input.targetPrice ?? null;
  let rewardToRisk: number | null = null;
  if (target !== null && stopDistancePct > 0) {
    const rewardPct = Math.abs((target - entry) / entry) * 100;
    rewardToRisk = rewardPct / stopDistancePct;
    if (rewardToRisk < 2) blockReasons.push("REWARD_RISK_FAILS");
  }

  const positionSizeRuined = stopDistancePct > 0 && accountRiskPct / stopDistancePct > 0.25;
  if (positionSizeRuined) blockReasons.push("STOP_RUINS_POSITION_SIZE");

  return {
    symbol: snapshot.symbol,
    direction,
    entryPrice: entry,
    recommendedStop: recommended,
    stopDistancePct,
    candidates: validCandidates,
    liquidationPrice,
    stopToLiquidationGapPct,
    maxPlannedLossPct,
    rewardToRisk,
    targetPrice: target,
    decision: blockReasons.length > 0 ? "BLOCK" : "VALID",
    blockReasons,
    adjustments,
    computedAt: new Date().toISOString(),
  };
}

export const STOPS_ENGINE_STATUS = "ACTIVE" as const;
