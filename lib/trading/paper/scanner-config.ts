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
  return v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export type ScannerMode = "safe_liquid" | "wide" | "high_volatility";
export type RiskTier = "MAJOR" | "ALT_LIQUID" | "HIGH_VOLATILITY" | "EXTREME_RISK";
export type DiscoverySource = "kraken" | "coingecko";
export type CandidateActionType =
  | "OPEN_PAPER_TRADE"
  | "WATCHLIST_ONLY"
  | "REJECTED"
  | "SKIPPED";

export const MAJOR_BASES = new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "LINK",
  "DOT",
  "AVAX",
  "MATIC",
  "LTC",
  "BCH",
  "UNI",
  "ATOM",
]);

export const WRAPPED_PREFIXES = ["W", "ST", "CB"];

export const SCANNER_CONFIG = {
  mode: (process.env.SCANNER_MODE?.trim().toLowerCase() || "wide") as ScannerMode,
  dataSources: envList("SCANNER_DATA_SOURCES", ["kraken", "coingecko"]) as DiscoverySource[],
  maxDiscoveryCoins: envInt("SCANNER_MAX_DISCOVERY_COINS", 500),
  maxEvaluatedCoins: envInt("SCANNER_MAX_EVALUATED_COINS", 100),
  topCandidates: envInt("SCANNER_TOP_CANDIDATES", 20),
  min24hVolumeUsd: envFloat("SCANNER_MIN_24H_VOLUME_USD", 500_000),
  minPriceUsd: envFloat("SCANNER_MIN_PRICE_USD", 0.000001),
  excludeStablecoins: envBool("SCANNER_EXCLUDE_STABLECOINS", true),
  excludeWrapped: envBool("SCANNER_EXCLUDE_WRAPPED", true),
  min24hChangePct: envFloat("SCANNER_MIN_24H_CHANGE_PCT", 3),
  highVol24hChangePct: envFloat("SCANNER_HIGH_VOL_24H_CHANGE_PCT", 10),
  extreme24hChangePct: envFloat("SCANNER_EXTREME_24H_CHANGE_PCT", 30),
  maxSpreadBpsMajor: envFloat("SCANNER_MAX_SPREAD_BPS_MAJOR", 40),
  maxSpreadBpsAlt: envFloat("SCANNER_MAX_SPREAD_BPS_ALT", 80),
  maxSpreadBpsHighVol: envFloat("SCANNER_MAX_SPREAD_BPS_HIGH_VOL", 150),
  maxSpreadBpsExtreme: envFloat("SCANNER_MAX_SPREAD_BPS_EXTREME", 300),
  maxOpenTrades: envInt("PAPER_MAX_OPEN_TRADES", 5),
  maxNewTradesPerRun: envInt("PAPER_MAX_NEW_TRADES_PER_RUN", 3),
  riskPercentMajor: envFloat("PAPER_RISK_PERCENT_MAJOR", 0.5),
  riskPercentAlt: envFloat("PAPER_RISK_PERCENT_ALT", 0.35),
  riskPercentHighVol: envFloat("PAPER_RISK_PERCENT_HIGH_VOL", 0.15),
  riskPercentExtreme: envFloat("PAPER_RISK_PERCENT_EXTREME", 0.05),
  universeCacheTtlMs: envInt("PAPER_UNIVERSE_CACHE_TTL_MS", 300_000),
  evalConcurrency: envInt("SCANNER_EVAL_CONCURRENCY", 5),
  evalTimeoutMs: envInt("SCANNER_EVAL_TIMEOUT_MS", 120_000),
  simulatedAccountUsd: 10_000,
} as const;

const VALID_MODES: ScannerMode[] = ["safe_liquid", "wide", "high_volatility"];
const VALID_SOURCES: DiscoverySource[] = ["kraken", "coingecko"];

export interface ScannerConfigValidation {
  valid: boolean;
  reasonCode: "SCANNER_CONFIG_VALID" | "SCANNER_CONFIG_INVALID";
  errors: string[];
}

export function validateScannerConfig(): ScannerConfigValidation {
  const errors: string[] = [];
  const c = SCANNER_CONFIG;

  if (!VALID_MODES.includes(c.mode)) {
    errors.push(`SCANNER_MODE must be safe_liquid, wide, or high_volatility (got "${c.mode}")`);
  }
  if (c.dataSources.length === 0) {
    errors.push("SCANNER_DATA_SOURCES must include at least one source");
  }
  for (const src of c.dataSources) {
    if (!VALID_SOURCES.includes(src)) {
      errors.push(`Invalid SCANNER_DATA_SOURCES entry: "${src}"`);
    }
  }
  if (c.maxDiscoveryCoins < 1 || c.maxDiscoveryCoins > 2000) {
    errors.push(`SCANNER_MAX_DISCOVERY_COINS out of range: ${c.maxDiscoveryCoins}`);
  }
  if (c.maxEvaluatedCoins < 1 || c.maxEvaluatedCoins > 500) {
    errors.push(`SCANNER_MAX_EVALUATED_COINS out of range: ${c.maxEvaluatedCoins}`);
  }
  if (c.topCandidates < 1 || c.topCandidates > 100) {
    errors.push(`SCANNER_TOP_CANDIDATES out of range: ${c.topCandidates}`);
  }
  if (c.min24hVolumeUsd < 0) errors.push("SCANNER_MIN_24H_VOLUME_USD must be >= 0");
  if (c.minPriceUsd < 0) errors.push("SCANNER_MIN_PRICE_USD must be >= 0");
  if (c.min24hChangePct < 0) errors.push("SCANNER_MIN_24H_CHANGE_PCT must be >= 0");
  if (c.maxOpenTrades < 1) errors.push("PAPER_MAX_OPEN_TRADES must be >= 1");
  if (c.maxNewTradesPerRun < 0) errors.push("PAPER_MAX_NEW_TRADES_PER_RUN must be >= 0");

  return {
    valid: errors.length === 0,
    reasonCode: errors.length === 0 ? "SCANNER_CONFIG_VALID" : "SCANNER_CONFIG_INVALID",
    errors,
  };
}

export function maxSpreadForTier(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return SCANNER_CONFIG.maxSpreadBpsMajor;
    case "ALT_LIQUID":
      return SCANNER_CONFIG.maxSpreadBpsAlt;
    case "HIGH_VOLATILITY":
      return SCANNER_CONFIG.maxSpreadBpsHighVol;
    case "EXTREME_RISK":
      return SCANNER_CONFIG.maxSpreadBpsExtreme;
  }
}

export function riskPercentForTier(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return SCANNER_CONFIG.riskPercentMajor;
    case "ALT_LIQUID":
      return SCANNER_CONFIG.riskPercentAlt;
    case "HIGH_VOLATILITY":
      return SCANNER_CONFIG.riskPercentHighVol;
    case "EXTREME_RISK":
      return SCANNER_CONFIG.riskPercentExtreme;
  }
}

export function classifyRiskTier(input: {
  baseAsset: string;
  change24hPct: number;
  volume24hUsd: number;
  marketCapUsd?: number | null;
}): RiskTier {
  const absChange = Math.abs(input.change24hPct);
  if (absChange >= SCANNER_CONFIG.extreme24hChangePct) return "EXTREME_RISK";
  if (absChange >= SCANNER_CONFIG.highVol24hChangePct) return "HIGH_VOLATILITY";
  if (MAJOR_BASES.has(input.baseAsset)) return "MAJOR";
  if (input.volume24hUsd >= 5_000_000 || (input.marketCapUsd ?? 0) >= 500_000_000) {
    return "ALT_LIQUID";
  }
  return "HIGH_VOLATILITY";
}

export function scannerModeLabel(mode: ScannerMode): string {
  switch (mode) {
    case "safe_liquid":
      return "SAFE_LIQUID";
    case "wide":
      return "WIDE";
    case "high_volatility":
      return "HIGH_VOLATILITY";
  }
}
