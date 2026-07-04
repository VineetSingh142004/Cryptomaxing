import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { PaperTradeSide } from "@prisma/client";

export type PaperExitReason =
  | "THESIS_INVALIDATED"
  | "MOMENTUM_REVERSAL"
  | "VOLUME_COLLAPSE"
  | "LIQUIDITY_WEAKENING"
  | "SELL_PRESSURE_INCREASED"
  | "MARKET_RISK_INCREASED"
  | "EARLY_LOSS_CUT"
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "EXPIRY_EXIT";

export interface ThesisInvalidationInput {
  side: PaperTradeSide;
  entryPrice: number;
  markPrice: number;
  snapshot: NormalizedMarketSnapshot;
  /** Relative volume at entry (if known). */
  entryRelativeVolume?: number | null;
  /** Spread bps at entry (if known). */
  entrySpreadBps?: number | null;
  /** Momentum % at entry (if known). */
  entryMomentumPct?: number | null;
  earlyLossCutBps?: number;
  invalidationThreshold?: number;
}

export interface ThesisInvalidationResult {
  shouldExit: boolean;
  exitReason: PaperExitReason | null;
  invalidationScore: number;
  signals: string[];
  primaryFactor: string | null;
}

function momentumFromCandles(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 6) return 0;
  const recent = candles.slice(-6);
  const first = recent.slice(0, 3).reduce((s, c) => s + c.close, 0) / 3;
  const second = recent.slice(3).reduce((s, c) => s + c.close, 0) / 3;
  if (first <= 0) return 0;
  return ((second - first) / first) * 100;
}

function unrealizedPnlBps(side: PaperTradeSide, entry: number, mark: number): number {
  const raw =
    side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry;
  return raw * 10_000;
}

function recentVolumeTrend(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 6) return 1;
  const recent = candles.slice(-6);
  const firstHalf = recent.slice(0, 3).reduce((s, c) => s + c.volume, 0) / 3;
  const secondHalf = recent.slice(3).reduce((s, c) => s + c.volume, 0) / 3;
  if (firstHalf <= 0) return secondHalf > 0 ? 1.5 : 1;
  return secondHalf / firstHalf;
}

export function evaluateThesisInvalidation(input: ThesisInvalidationInput): ThesisInvalidationResult {
  const {
    side,
    entryPrice,
    markPrice,
    snapshot,
    entryRelativeVolume,
    entrySpreadBps,
    entryMomentumPct,
    earlyLossCutBps = 40,
    invalidationThreshold = 55,
  } = input;

  const signals: string[] = [];
  let score = 0;
  let primaryFactor: string | null = null;
  let exitReason: PaperExitReason | null = null;

  const pnlBps = unrealizedPnlBps(side, entryPrice, markPrice);
  const isLosing = pnlBps < -5;
  const momentum = momentumFromCandles(snapshot.candles5m);
  const relVol = snapshot.relativeVolume ?? 1;
  const spreadBps = snapshot.ticker.spreadBps ?? 0;
  const volTrend = recentVolumeTrend(snapshot.candles5m);

  if (isLosing && entryMomentumPct !== null && entryMomentumPct !== undefined) {
    const momentumReversed =
      side === "LONG"
        ? entryMomentumPct > 0.3 && momentum < -0.15
        : entryMomentumPct < -0.3 && momentum > 0.15;
    if (momentumReversed) {
      score += 25;
      signals.push("Momentum reversed against position");
      exitReason = "MOMENTUM_REVERSAL";
      primaryFactor = "Momentum reversed";
    }
  }

  if (relVol < 0.65 || volTrend < 0.55) {
    score += 20;
    signals.push("Volume collapsing — buy pressure fading");
    if (!exitReason) exitReason = "VOLUME_COLLAPSE";
    primaryFactor ??= "Volume dropped";
  } else if (entryRelativeVolume !== null && entryRelativeVolume !== undefined && relVol < entryRelativeVolume * 0.6) {
    score += 15;
    signals.push("Relative volume dropped significantly since entry");
    if (!exitReason) exitReason = "VOLUME_COLLAPSE";
    primaryFactor ??= "Volume dropped";
  }

  if (entrySpreadBps !== null && entrySpreadBps !== undefined && spreadBps > entrySpreadBps * 1.5 && spreadBps > 30) {
    score += 18;
    signals.push("Spread widened — liquidity weakening");
    if (!exitReason) exitReason = "LIQUIDITY_WEAKENING";
    primaryFactor ??= "Liquidity dried up";
  } else if (spreadBps > 80) {
    score += 12;
    signals.push("Spread too wide for safe hold");
    if (!exitReason) exitReason = "LIQUIDITY_WEAKENING";
    primaryFactor ??= "Liquidity dried up";
  }

  if (side === "LONG" && momentum < -0.25 && isLosing) {
    score += 15;
    signals.push("Sell pressure increasing — downside momentum");
    if (!exitReason) exitReason = "SELL_PRESSURE_INCREASED";
    primaryFactor ??= "Sell pressure increased";
  }

  const volPct =
    snapshot.candles5m.length >= 5
      ? (() => {
          const recent = snapshot.candles5m.slice(-5);
          const maxH = Math.max(...recent.map((c) => c.high));
          const minL = Math.min(...recent.map((c) => c.low));
          const mid = (maxH + minL) / 2;
          return mid > 0 ? ((maxH - minL) / mid) * 100 : 0;
        })()
      : 0;

  if (volPct > 6 && isLosing) {
    score += 12;
    signals.push("Volatility spike increases downside risk");
    if (!exitReason) exitReason = "MARKET_RISK_INCREASED";
    primaryFactor ??= "High volatility";
  }

  if (isLosing && pnlBps <= -earlyLossCutBps && score >= 30) {
    score += 15;
    signals.push(`Early loss cut — down ${pnlBps.toFixed(0)} bps with weakening thesis`);
    exitReason = "EARLY_LOSS_CUT";
    primaryFactor ??= "Cut loss early";
  }

  if (score >= 40 && isLosing) {
    signals.push("Trade thesis no longer valid — exit to avoid larger loss");
    exitReason = exitReason ?? "THESIS_INVALIDATED";
    primaryFactor ??= "Thesis invalidated";
  }

  const shouldExit = isLosing && score >= invalidationThreshold && exitReason !== null;

  return {
    shouldExit,
    exitReason: shouldExit ? exitReason : null,
    invalidationScore: score,
    signals,
    primaryFactor: shouldExit ? primaryFactor : null,
  };
}

export function mapLegacyCloseReason(reason: string): PaperExitReason {
  switch (reason) {
    case "STOP_LOSS":
      return "STOP_LOSS_HIT";
    case "TAKE_PROFIT":
      return "TAKE_PROFIT_HIT";
    case "EXPIRED":
      return "EXPIRY_EXIT";
    default:
      return reason as PaperExitReason;
  }
}
