import { createHash } from "crypto";

export interface StrategyRuleSet {
  entry: string[];
  stop: string;
  exit: string[];
  takeProfit: string[];
  invalidation: string[];
  cooldown: string;
  failure: string[];
  minRewardToCostRatio: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  category: string;
  enabled: boolean;
  liveTestCandidate: boolean;
  description: string;
  rules: StrategyRuleSet;
  parameters: Record<string, number | string | boolean>;
  correlationGroup: string;
}

function hashLogic(def: Omit<StrategyDefinition, "id">): string {
  return createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 16);
}

export const VWAP_RECLAIM_MOMENTUM: StrategyDefinition = {
  id: "vwap-reclaim-momentum",
  name: "VWAP Reclaim Momentum",
  version: "1.0.0",
  category: "momentum",
  enabled: true,
  liveTestCandidate: true,
  description: "Long/short reclaim of session VWAP with volume and regime confirmation.",
  correlationGroup: "vwap_momentum",
  parameters: {
    minRelativeVolume: 1.2,
    maxSpreadBps: 15,
    minRewardToCost: 3,
    partialR: 1.0,
    secondTargetR: 2.0,
    maxVwapExtensionPct: 0.5,
  },
  rules: {
    entry: [
      "Price was below VWAP (long) or above VWAP (short)",
      "Price reclaims VWAP",
      "1m candle closes above VWAP (long) or below (short)",
      "5m confirms or is forming strong reclaim",
      "Relative volume >= minRelativeVolume threshold",
      "Spread below optimized maxSpreadBps",
      "Bid support improving (order book imbalance > 0 for long)",
      "BTC/ETH not crashing (regime crashRisk below threshold)",
      "Entry not overextended from VWAP (< maxVwapExtensionPct)",
      "Expected net reward >= 3x total trading cost (fees + slippage + spread)",
      "Stop can be placed at true invalidation level",
      "Stop far enough from liquidation if leverage used",
    ],
    stop: "Below reclaim candle low (long) or above reclaim candle high (short) at true invalidation",
    exit: [
      "Partial at optimized R (partialR)",
      "Breakeven after partial if thesis still valid",
      "Second target at optimized R (secondTargetR)",
      "Trail only if momentum remains strong (volume + trend)",
    ],
    takeProfit: ["partialR", "secondTargetR", "trailing_if_momentum"],
    invalidation: [
      "Loses VWAP",
      "Reclaim fails (close back wrong side)",
      "Volume fades (relative volume < 0.8)",
      "Order book weakens (bid support disappears)",
      "BTC/ETH turns against trade",
      "Spread widens beyond maxSpreadBps",
      "Liquidity drops below minimum",
    ],
    cooldown: "No re-entry for 15 minutes after invalidation on same symbol",
    failure: [
      "Three consecutive failed reclaims → strategy cooldown 1 hour",
      "Slippage on entry > 2x estimate → block until execution quality recovers",
    ],
    minRewardToCostRatio: 3,
  },
};

export const VOLATILITY_COMPRESSION_BREAKOUT: StrategyDefinition = {
  id: "volatility-compression-breakout",
  name: "Volatility Compression Breakout",
  version: "1.0.0",
  category: "breakout",
  enabled: true,
  liveTestCandidate: true,
  description: "Trade expansion after Bollinger/ATR compression with volume confirmation.",
  correlationGroup: "breakout",
  parameters: {
    minRelativeVolume: 1.5,
    maxSpreadBps: 12,
    minRewardToCost: 3,
    partialR: 1.2,
    secondTargetR: 2.5,
    maxFalseBreakoutRisk: 0.35,
  },
  rules: {
    entry: [
      "Volatility compression detected (Bollinger width contracting)",
      "Price breaks compression range with strong candle body",
      "Breakout candle body strength > 0.6",
      "Relative volume >= minRelativeVolume",
      "Order book confirms direction (imbalance aligned)",
      "Spread tight (< maxSpreadBps)",
      "Room before next resistance/support",
      "Not late (breakout within 3 candles of range break)",
      "Not overextended (< 1 ATR from breakout level)",
      "Expected net reward >= 3x total cost",
      "False breakout risk score below maxFalseBreakoutRisk",
    ],
    stop: "Opposite side of compression range or breakout candle invalidation",
    exit: [
      "Partial at optimized R (partialR)",
      "Second target near measured move or liquidity zone",
      "Trail if expansion continues (Bollinger expanding)",
    ],
    takeProfit: ["partialR", "secondTargetR", "measured_move"],
    invalidation: [
      "Price falls back into compression range",
      "Retest fails",
      "Volume fades",
      "Order book flips against direction",
      "Spread widens",
      "Candle becomes exhaustion (long wick rejection > 0.6)",
    ],
    cooldown: "30 minutes after false breakout on same symbol",
    failure: [
      "Two false breakouts in session → block symbol for day",
    ],
    minRewardToCostRatio: 3,
  },
};

export const TREND_PULLBACK_CONTINUATION: StrategyDefinition = {
  id: "trend-pullback-continuation",
  name: "Trend Pullback Continuation",
  version: "1.0.0",
  category: "trend",
  enabled: true,
  liveTestCandidate: true,
  description: "Enter with intraday trend after normal-depth pullback to VWAP/EMA support.",
  correlationGroup: "trend_continuation",
  parameters: {
    minRelativeVolume: 1.0,
    maxSpreadBps: 15,
    minRewardToCost: 3,
    partialR: 1.0,
    secondTargetR: 2.0,
    maxLateEntryRisk: 0.3,
  },
  rules: {
    entry: [
      "Higher timeframe trend aligned (5m/15m EMA stack)",
      "Intraday trend valid (EMA 9 > EMA 20 for long)",
      "Pullback depth normal (< 1.5 ATR from swing high/low)",
      "Price holds VWAP/EMA/support on pullback",
      "Volume fades on pullback and returns on continuation candle",
      "Order book support appears near pullback level",
      "Reward after costs >= 3x total cost",
      "Stop at true invalidation (below pullback low)",
      "Late-entry risk score below maxLateEntryRisk",
    ],
    stop: "Below pullback low (long) or above pullback high (short)",
    exit: [
      "Partial at optimized R (partialR)",
      "Second target at prior high or liquidity zone",
      "Trail only if trend remains valid (EMA structure intact)",
    ],
    takeProfit: ["partialR", "secondTargetR", "prior_high"],
    invalidation: [
      "Trend structure breaks (EMA cross against position)",
      "Pullback becomes reversal (close beyond invalidation)",
      "VWAP/EMA support fails",
      "Order book support disappears",
      "BTC/ETH turns against trade",
    ],
    cooldown: "20 minutes after invalidation",
    failure: [
      "Pullback becomes reversal twice → strategy cooldown",
    ],
    minRewardToCostRatio: 3,
  },
};

export const LIVE_TEST_STRATEGIES: StrategyDefinition[] = [
  VWAP_RECLAIM_MOMENTUM,
  VOLATILITY_COMPRESSION_BREAKOUT,
  TREND_PULLBACK_CONTINUATION,
];

export const DISABLED_STRATEGIES: StrategyDefinition[] = [];

export function getStrategyById(id: string): StrategyDefinition | undefined {
  return LIVE_TEST_STRATEGIES.find((s) => s.id === id);
}

export function getEnabledLiveTestCandidates(): StrategyDefinition[] {
  return LIVE_TEST_STRATEGIES.filter((s) => s.enabled && s.liveTestCandidate);
}

export function computeStrategyLogicHash(strategy: StrategyDefinition): string {
  return hashLogic({
    name: strategy.name,
    version: strategy.version,
    category: strategy.category,
    enabled: strategy.enabled,
    liveTestCandidate: strategy.liveTestCandidate,
    description: strategy.description,
    rules: strategy.rules,
    parameters: strategy.parameters,
    correlationGroup: strategy.correlationGroup,
  });
}
