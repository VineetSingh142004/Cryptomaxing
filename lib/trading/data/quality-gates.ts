import type {
  DataBlockReason,
  DataQualityAssessment,
  NormalizedCandle,
  NormalizedMarketSnapshot,
  NormalizedOrderBook,
  NormalizedTicker,
  PriceDisagreement,
} from "@/lib/trading/data/types";
import { DATA_QUALITY_THRESHOLDS } from "@/lib/trading/data/types";

export function detectCandleGaps(
  candles: NormalizedCandle[],
  expectedIntervalMs: number,
): { hasGaps: boolean; gapCount: number; invalidSegments: number[] } {
  if (candles.length < 2) return { hasGaps: false, gapCount: 0, invalidSegments: [] };

  const sorted = [...candles].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const invalidSegments: number[] = [];
  let gapCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].timestamp).getTime();
    const curr = new Date(sorted[i].timestamp).getTime();
    const delta = curr - prev;
    if (delta > expectedIntervalMs + DATA_QUALITY_THRESHOLDS.maxCandleGapToleranceMs) {
      gapCount++;
      invalidSegments.push(i);
    }
  }

  return { hasGaps: gapCount > 0, gapCount, invalidSegments };
}

export function detectPriceDisagreement(
  tickers: NormalizedTicker[],
  symbol: string,
): PriceDisagreement {
  if (tickers.length < 2) {
    return { symbol, sources: tickers.map((t) => ({ source: t.source, price: t.price })), maxDeviationPct: 0, detected: false };
  }

  const prices = tickers.map((t) => t.price);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const maxDev = Math.max(...prices.map((p) => Math.abs((p - avg) / avg) * 100));

  return {
    symbol,
    sources: tickers.map((t) => ({ source: t.source, price: t.price })),
    maxDeviationPct: maxDev,
    detected: maxDev > DATA_QUALITY_THRESHOLDS.maxPriceDisagreementPct,
  };
}

export function assessDataQuality(input: {
  snapshot: NormalizedMarketSnapshot;
  backtestCandles1m?: NormalizedCandle[];
  priceDisagreement?: PriceDisagreement;
  requiresOrderBook?: boolean;
  usesLeverage?: boolean;
  usesPerpetuals?: boolean;
}): DataQualityAssessment {
  const reasons: DataBlockReason[] = [];
  const now = Date.now();
  const { snapshot } = input;

  const tickerAge = now - new Date(snapshot.ticker.timestamp).getTime();
  if (tickerAge > DATA_QUALITY_THRESHOLDS.maxDataAgeMs1m) {
    reasons.push("DATA_STALE");
  }

  if (snapshot.ticker.latencyMs > DATA_QUALITY_THRESHOLDS.maxLatencyMs) {
    reasons.push("LATENCY_TOO_HIGH");
  }

  if (snapshot.ticker.spreadBps > DATA_QUALITY_THRESHOLDS.maxSpreadBps) {
    reasons.push("SPREAD_TOO_WIDE");
  }

  if (snapshot.liquidityUsd !== null && snapshot.liquidityUsd < DATA_QUALITY_THRESHOLDS.minLiquidityUsd) {
    reasons.push("LIQUIDITY_TOO_LOW");
  }

  if (!snapshot.feeModel.known) {
    reasons.push("FEE_MODEL_MISSING");
  }

  if (snapshot.slippageEstimate.confidence === "low" && snapshot.slippageEstimate.bps <= 0) {
    reasons.push("SLIPPAGE_MODEL_MISSING");
  }

  if (input.requiresOrderBook) {
    if (!snapshot.orderBook) {
      reasons.push("ORDER_BOOK_STALE");
    } else {
      const bookAge = now - new Date(snapshot.orderBook.timestamp).getTime();
      if (bookAge > DATA_QUALITY_THRESHOLDS.maxOrderBookAgeMs) {
        reasons.push("ORDER_BOOK_STALE");
      }
    }
  }

  if (input.priceDisagreement?.detected) {
    reasons.push("PRICE_DISAGREEMENT");
  }

  if (snapshot.providerHealth !== "ok") {
    reasons.push("PROVIDER_UNHEALTHY");
  }

  const gaps1m = detectCandleGaps(snapshot.candles1m, 60_000);
  const gaps5m = detectCandleGaps(snapshot.candles5m, 300_000);
  if (gaps1m.hasGaps || gaps5m.hasGaps) {
    reasons.push("CANDLE_GAPS_DETECTED");
  }

  if (snapshot.candles1m.length < 5) {
    reasons.push("HISTORY_INSUFFICIENT");
  }

  if (input.usesLeverage) {
    reasons.push("LIQUIDATION_ESTIMATE_MISSING");
  }

  const liveRequirementsMet =
    snapshot.candles1m.length > 0 &&
    snapshot.candles5m.length > 0 &&
    snapshot.ticker.bid > 0 &&
    snapshot.ticker.ask > 0 &&
    snapshot.ticker.spreadBps >= 0 &&
    snapshot.ticker.volume24h > 0 &&
    snapshot.feeModel.known &&
    snapshot.slippageEstimate.bps >= 0 &&
    snapshot.providerHealth === "ok" &&
    snapshot.metadata.minOrderSize !== null &&
    !reasons.includes("DATA_STALE") &&
    !reasons.includes("ORDER_BOOK_STALE") &&
    !reasons.includes("SPREAD_TOO_WIDE") &&
    !reasons.includes("LIQUIDITY_TOO_LOW") &&
    !reasons.includes("PRICE_DISAGREEMENT") &&
    !reasons.includes("LATENCY_TOO_HIGH") &&
    !reasons.includes("FEE_MODEL_MISSING") &&
    !reasons.includes("SLIPPAGE_MODEL_MISSING") &&
    !(input.usesLeverage && reasons.includes("LIQUIDATION_ESTIMATE_MISSING"));

  let backtestRequirementsMet = false;
  if (input.backtestCandles1m && input.backtestCandles1m.length > 0) {
    const sorted = [...input.backtestCandles1m].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const first = new Date(sorted[0].timestamp).getTime();
    const last = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const days = (last - first) / (86_400_000);
    const gaps = detectCandleGaps(sorted, 60_000);

    backtestRequirementsMet =
      days >= DATA_QUALITY_THRESHOLDS.minBacktestDays1m &&
      sorted.length >= DATA_QUALITY_THRESHOLDS.minBacktestSampleSize &&
      !gaps.hasGaps &&
      snapshot.feeModel.known;

    if (days < DATA_QUALITY_THRESHOLDS.minBacktestDays1m) {
      reasons.push("HISTORY_INSUFFICIENT");
    }
    if (sorted.length < DATA_QUALITY_THRESHOLDS.minBacktestSampleSize) {
      reasons.push("SAMPLE_SIZE_INSUFFICIENT");
    }
  }

  const tradable = liveRequirementsMet && reasons.length === 0;

  return {
    tradable,
    decision: tradable ? "ALLOW" : reasons.length > 0 ? "BLOCK" : "WAIT",
    reasonCodes: [...new Set(reasons)],
    liveRequirementsMet,
    backtestRequirementsMet,
    details: {
      tickerAgeMs: tickerAge,
      spreadBps: snapshot.ticker.spreadBps,
      liquidityUsd: snapshot.liquidityUsd,
      candles1mCount: snapshot.candles1m.length,
      candles5mCount: snapshot.candles5m.length,
      gaps1m: gaps1m.gapCount,
      gaps5m: gaps5m.gapCount,
    },
    assessedAt: new Date().toISOString(),
  };
}

export function estimateSlippageFromBook(
  orderBook: NormalizedOrderBook | null,
  midPrice: number,
  tradeSizeUsd: number,
): { bps: number; confidence: "low" | "medium" | "high" } {
  if (!orderBook || orderBook.asks.length === 0) {
    return { bps: 0, confidence: "low" };
  }

  let remaining = tradeSizeUsd;
  let cost = 0;
  let filled = 0;

  for (const level of orderBook.asks) {
    const levelUsd = level.price * level.size;
    const take = Math.min(remaining, levelUsd);
    cost += take * (level.price - midPrice) / midPrice;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  if (filled === 0) return { bps: 0, confidence: "low" };

  const bps = (cost / filled) * 10_000;
  return {
    bps: Math.max(0, bps),
    confidence: remaining > 0 ? "low" : filled >= tradeSizeUsd * 0.9 ? "high" : "medium",
  };
}

export function computeSpreadBps(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0) return Infinity;
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 10_000;
}

export function computeDepthAtBps(
  orderBook: NormalizedOrderBook,
  side: "bid" | "ask",
  bps: number,
  midPrice: number,
): number {
  const levels = side === "bid" ? orderBook.bids : orderBook.asks;
  const threshold = side === "bid"
    ? midPrice * (1 - bps / 10_000)
    : midPrice * (1 + bps / 10_000);

  let depth = 0;
  for (const level of levels) {
    if (side === "bid" && level.price < threshold) break;
    if (side === "ask" && level.price > threshold) break;
    depth += level.price * level.size;
  }
  return depth;
}
