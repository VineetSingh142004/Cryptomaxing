/** Normalized market data types — provider-agnostic */

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface NormalizedOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
  source: string;
  latencyMs: number;
}

export interface NormalizedCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: "1m" | "5m" | "15m" | "1h";
}

export interface NormalizedTicker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  spreadBps: number;
  volume24h: number;
  timestamp: string;
  source: string;
  latencyMs: number;
}

export interface FeeModel {
  makerBps: number;
  takerBps: number;
  source: string;
  known: boolean;
}

export interface SlippageEstimate {
  bps: number;
  method: string;
  confidence: "low" | "medium" | "high";
}

export interface TokenMetadata {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pairAgeDays: number | null;
  minOrderSize: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  source: string;
}

export interface TokenSecurity {
  symbol: string;
  isHoneypot: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  isVerified: boolean | null;
  riskScore: number | null;
  source: string;
  checkedAt: string;
}

export interface NormalizedMarketSnapshot {
  symbol: string;
  ticker: NormalizedTicker;
  orderBook: NormalizedOrderBook | null;
  candles1m: NormalizedCandle[];
  candles5m: NormalizedCandle[];
  relativeVolume: number | null;
  liquidityUsd: number | null;
  feeModel: FeeModel;
  slippageEstimate: SlippageEstimate;
  metadata: TokenMetadata;
  security: TokenSecurity | null;
  providerHealth: "ok" | "degraded" | "error";
  fetchedAt: string;
}

export interface PriceDisagreement {
  symbol: string;
  sources: { source: string; price: number }[];
  maxDeviationPct: number;
  detected: boolean;
}

export type DataBlockReason =
  | "DATA_STALE"
  | "ORDER_BOOK_STALE"
  | "SPREAD_TOO_WIDE"
  | "LIQUIDITY_TOO_LOW"
  | "PRICE_DISAGREEMENT"
  | "LATENCY_TOO_HIGH"
  | "HISTORY_INSUFFICIENT"
  | "SAMPLE_SIZE_INSUFFICIENT"
  | "FEE_MODEL_MISSING"
  | "SLIPPAGE_MODEL_MISSING"
  | "LIQUIDATION_ESTIMATE_MISSING"
  | "CANDLE_GAPS_DETECTED"
  | "PROVIDER_UNHEALTHY"
  | "NOT_IMPLEMENTED";

export interface DataQualityAssessment {
  tradable: boolean;
  decision: "ALLOW" | "BLOCK" | "WAIT";
  reasonCodes: DataBlockReason[];
  liveRequirementsMet: boolean;
  backtestRequirementsMet: boolean;
  details: Record<string, unknown>;
  assessedAt: string;
}

export const DATA_QUALITY_THRESHOLDS = {
  maxDataAgeMs1m: 120_000,
  maxDataAgeMs5m: 600_000,
  maxOrderBookAgeMs: 30_000,
  maxSpreadBps: 25,
  minLiquidityUsd: 500_000,
  maxLatencyMs: 2_000,
  maxPriceDisagreementPct: 0.5,
  minBacktestDays1m: 90,
  preferredBacktestDays1m: 180,
  minBacktestSampleSize: 1000,
  maxCandleGapToleranceMs: 120_000,
} as const;
