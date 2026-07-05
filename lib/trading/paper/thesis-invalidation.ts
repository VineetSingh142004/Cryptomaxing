import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { PaperTradeSide } from "@prisma/client";

export type PaperExitReason =
  | "THESIS_INVALIDATED"
  | "THESIS_INVALIDATED_EXIT"
  | "MOMENTUM_REVERSAL"
  | "VOLUME_COLLAPSE"
  | "LIQUIDITY_WEAKENING"
  | "SELL_PRESSURE_INCREASED"
  | "MARKET_RISK_INCREASED"
  | "EARLY_LOSS_CUT"
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "EXPIRY_EXIT"
  | "TRUE_INVALIDATION_EXIT"
  | "WEAK_THESIS_EXIT"
  | "STALE_TRADE_EXIT"
  | "NEAR_STOP_EXIT"
  | "STOP_DANGER_EXIT"
  | "MARKET_TURNED_EXIT"
  | "VOLUME_FADE_EXIT"
  | "SPREAD_WIDEN_EXIT"
  | "LIQUIDITY_DROP_EXIT"
  | "UNKNOWN_THESIS_EXIT"
  | "STALE_DATA_EXIT"
  | "TRADE_PROFIT_GIVEBACK_EXIT"
  | "OPPORTUNITY_COST_EXIT"
  | "BETTER_SETUP_ROTATION_EXIT"
  | "CAPITAL_LOCKUP_EXIT"
  | "LOW_PROFIT_DENSITY_EXIT"
  | "RECORD_PROFIT_GIVEBACK_EXIT";

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

  if (isLosing && pnlBps <= -earlyLossCutBps && score >= 45) {
    score += 15;
    signals.push(`Early loss cut — down ${pnlBps.toFixed(0)} bps with weakening thesis`);
    exitReason = "EARLY_LOSS_CUT";
    primaryFactor ??= "Cut loss early";
  }

  if (isLosing && pnlBps < -25 && momentum < 0 && volTrend < 0.7) {
    score += 20;
    signals.push("Price failed to continue after entry — fake continuation risk");
    if (!exitReason) exitReason = "THESIS_INVALIDATED";
    primaryFactor ??= "Post-entry continuation failed";
  }

  if (score >= 40 && isLosing && signals.length >= 2) {
    signals.push("Trade thesis no longer valid — exit to avoid larger loss");
    exitReason = exitReason ?? "THESIS_INVALIDATED";
    primaryFactor ??= "Thesis invalidated";
  }

  const shouldExit =
    isLosing &&
    score >= invalidationThreshold &&
    exitReason !== null &&
    (exitReason === "STOP_LOSS_HIT" ||
      exitReason === "TAKE_PROFIT_HIT" ||
      exitReason === "EXPIRY_EXIT" ||
      signals.length >= 2 ||
      score >= invalidationThreshold + 5 ||
      (pnlBps <= -earlyLossCutBps && score >= 50));

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
    case "THESIS_INVALIDATED":
      return "THESIS_INVALIDATED_EXIT";
    default:
      return reason as PaperExitReason;
  }
}

export function formatThesisExitLabel(reason: PaperExitReason | null): string {
  if (reason === "THESIS_INVALIDATED") return "THESIS_INVALIDATED_EXIT";
  return reason ?? "UNKNOWN";
}

export type ThesisValidationStatus = "VALID" | "WEAKENING" | "INVALID" | "UNKNOWN_NEEDS_DATA";

export type ThesisHoldRecommendation = "HOLD" | "HOLD_WITH_CAUTION" | "NEEDS_MORE_DATA" | "EXIT";

export interface OpenTradeThesisReview {
  status: ThesisValidationStatus;
  recommendation: ThesisHoldRecommendation;
  reasons: string[];
  candleData?: ThesisCandleDataStatus;
}

export interface ThesisCandleDataStatus {
  available: boolean;
  candleCount: number;
  timeframe: string;
  provider: string | null;
  missingReason: string | null;
}

export function buildThesisCandleDataStatus(input: {
  snapshot?: NormalizedMarketSnapshot | null;
  hasMarketData: boolean;
  dataSource?: string | null;
}): ThesisCandleDataStatus {
  const candles = input.snapshot?.candles5m ?? [];
  const count = candles.length;
  if (input.hasMarketData && count >= 3) {
    return {
      available: true,
      candleCount: count,
      timeframe: "5m",
      provider: input.dataSource ?? null,
      missingReason: null,
    };
  }
  let missingReason = "Insufficient candle data for thesis validation";
  if (!input.hasMarketData) missingReason = "Market snapshot not loaded for thesis review";
  else if (count === 0) missingReason = "No 5m candles returned by provider";
  else if (count < 3) missingReason = `Only ${count} candle(s) available — need at least 3`;
  return {
    available: false,
    candleCount: count,
    timeframe: "5m",
    provider: input.dataSource ?? null,
    missingReason,
  };
}

function mapSignalToReason(signal: string): string | null {
  const lower = signal.toLowerCase();
  if (lower.includes("momentum")) return "momentum still valid";
  if (lower.includes("volume")) return "volume supporting";
  if (lower.includes("spread") && lower.includes("wide")) return "spread acceptable";
  if (lower.includes("liquidity")) return "liquidity okay";
  if (lower.includes("failed to continue") || lower.includes("continuation")) {
    return "price failed to continue";
  }
  if (lower.includes("fake") || lower.includes("pump")) return "fake-pump risk";
  if (lower.includes("volatility") || lower.includes("market risk")) return "broader market risk";
  return null;
}

export function evaluateOpenTradeThesisReview(
  input: ThesisInvalidationInput & { hasMarketData: boolean; dataSource?: string | null },
): OpenTradeThesisReview {
  const candleData = buildThesisCandleDataStatus({
    snapshot: input.snapshot,
    hasMarketData: input.hasMarketData,
    dataSource: input.dataSource,
  });

  if (!input.hasMarketData || input.snapshot.candles5m.length < 3) {
    return {
      status: "UNKNOWN_NEEDS_DATA",
      recommendation: "NEEDS_MORE_DATA",
      reasons: [candleData.missingReason ?? "Insufficient candle data for thesis validation"],
      candleData,
    };
  }

  const inv = evaluateThesisInvalidation(input);
  const pnlBps = unrealizedPnlBps(input.side, input.entryPrice, input.markPrice);
  const momentum = momentumFromCandles(input.snapshot.candles5m);
  const relVol = input.snapshot.relativeVolume ?? 1;
  const spreadBps = input.snapshot.ticker.spreadBps ?? 0;
  const positiveReasons: string[] = [];

  if (Math.abs(momentum) >= 0.1 && pnlBps >= -10) {
    positiveReasons.push("momentum still valid");
  }
  if (relVol >= 0.75) positiveReasons.push("volume supporting");
  if (spreadBps <= 50) positiveReasons.push("spread acceptable");
  if (relVol >= 0.5 && spreadBps <= 80) positiveReasons.push("liquidity okay");

  const negativeReasons = inv.signals
    .map(mapSignalToReason)
    .filter((r): r is string => r !== null && !positiveReasons.includes(r));

  if (inv.shouldExit && inv.invalidationScore >= 70) {
    return {
      status: "INVALID",
      recommendation: "EXIT",
      reasons: [...new Set([...inv.signals.slice(0, 3), ...negativeReasons])],
      candleData,
    };
  }

  if (inv.invalidationScore >= 40 || negativeReasons.length >= 2) {
    return {
      status: "WEAKENING",
      recommendation: "HOLD_WITH_CAUTION",
      reasons: negativeReasons.length > 0 ? negativeReasons : inv.signals.slice(0, 3),
      candleData,
    };
  }

  if (positiveReasons.length >= 2 && inv.invalidationScore < 25) {
    return {
      status: "VALID",
      recommendation: "HOLD",
      reasons: positiveReasons,
      candleData,
    };
  }

  if (inv.invalidationScore >= 25) {
    return {
      status: "UNKNOWN_NEEDS_DATA",
      recommendation: "HOLD_WITH_CAUTION",
      reasons:
        negativeReasons.length > 0
          ? negativeReasons
          : ["Thesis signals mixed — monitor closely"],
      candleData,
    };
  }

  return {
    status: "UNKNOWN_NEEDS_DATA",
    recommendation: "NEEDS_MORE_DATA",
    reasons: ["Not enough confirming or invalidating signals yet"],
    candleData,
  };
}
