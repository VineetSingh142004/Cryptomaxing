export type PaperReasonCode =
  | "TRADE_READY"
  | "TRADE_OPENED"
  | "SCORE_TOO_LOW"
  | "SPREAD_TOO_WIDE"
  | "LIQUIDITY_TOO_LOW"
  | "DATA_STALE"
  | "OHLC_MISSING"
  | "VOLUME_TOO_LOW"
  | "VOLATILITY_TOO_HIGH"
  | "VOLATILITY_TOO_LOW"
  | "MAX_OPEN_TRADES_REACHED"
  | "EXISTING_TRADE_OPEN"
  | "RISK_REWARD_TOO_WEAK"
  | "MARKET_DATA_FAILED"
  | "UNIVERSE_EMPTY"
  | "CANDIDATE_SELECTION_FAILED"
  | "LOW_MOMENTUM"
  | "SHORT_NOT_ALLOWED"
  | "NOT_TRADABLE_ON_EXCHANGE"
  | "PUMP_RISK_TOO_HIGH"
  | "WATCHLIST_ONLY"
  | "THESIS_INVALIDATED"
  | "EARLY_LOSS_CUT"
  | "MAX_TOTAL_EXPOSURE_REACHED"
  | "DYNAMIC_CAPACITY_FULL"
  | "CORRELATED_EXPOSURE_LIMIT"
  | "REJECTED_BAD_RISK_REWARD"
  | "REJECTED_FAKE_PUMP_RISK"
  | "WATCH_ONLY_FAKE_PUMP_RISK"
  | "NO_TRADE_BEST_DECISION"
  | "THESIS_INVALIDATED_EXIT";

function envInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (!v) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

function envList(key: string, fallback: string[]): string[] {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export const PAPER_CONFIG = {
  symbolUniverse: process.env.PAPER_SYMBOL_UNIVERSE?.trim() || "kraken_usd_top",
  maxSymbols: envInt("PAPER_MAX_SYMBOLS", 50),
  includeQuotes: envList("PAPER_INCLUDE_QUOTES", ["USD", "USDT"]),
  min24hVolumeUsd: envFloat("PAPER_MIN_24H_VOLUME_USD", 1_000_000),
  excludeStablecoins: envBool("PAPER_EXCLUDE_STABLECOINS", true),
  minOpportunityScore: envFloat("PAPER_MIN_OPPORTUNITY_SCORE", 60),
  minLiquidityScore: envFloat("PAPER_MIN_LIQUIDITY_SCORE", 50),
  maxSpreadBps: envFloat("PAPER_MAX_SPREAD_BPS", 40),
  maxOpenTrades: envInt("PAPER_MAX_OPEN_TRADES", 3),
  maxNewTradesPerRun: envInt("PAPER_MAX_NEW_TRADES_PER_RUN", 2),
  riskPercent: envFloat("PAPER_RISK_PERCENT", 0.5),
  stopLossBps: envFloat("PAPER_STOP_LOSS_BPS", 80),
  takeProfitBps: envFloat("PAPER_TAKE_PROFIT_BPS", 120),
  tradeExpiryHours: envFloat("PAPER_TRADE_EXPIRY_HOURS", 24),
  allowShort: envBool("PAPER_ALLOW_SHORT", false),
  topCandidatesToEvaluate: envInt("PAPER_TOP_CANDIDATES", 10),
  universeCacheTtlMs: envInt("PAPER_UNIVERSE_CACHE_TTL_MS", 300_000),
  strategyName: "controlled-active-paper-v1" as const,
  simulatedAccountUsd: 10_000,
} as const;

export { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";

export const STABLECOIN_BASES = new Set([
  "USDT",
  "USDC",
  "DAI",
  "PYUSD",
  "USDG",
  "EUR",
  "EURT",
  "USDD",
  "TUSD",
  "USDP",
  "ZUSD",
]);
