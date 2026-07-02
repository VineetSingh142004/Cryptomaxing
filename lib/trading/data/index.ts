import {
  assessDataQuality,
  detectPriceDisagreement,
} from "@/lib/trading/data/quality-gates";
import {
  fetchCoinGeckoPrice,
  fetchNormalizedMarketSnapshot,
} from "@/lib/trading/data/providers/kraken";
import type {
  DataQualityAssessment,
  NormalizedMarketSnapshot,
} from "@/lib/trading/data/types";

export const DATA_ENGINE_STATUS = "ACTIVE" as const;

export async function getMarketSnapshot(symbol: string): Promise<NormalizedMarketSnapshot> {
  return fetchNormalizedMarketSnapshot(symbol);
}

export async function evaluateMarketDataQuality(
  symbol: string,
  options?: {
    requiresOrderBook?: boolean;
    usesLeverage?: boolean;
    backtestCandles1m?: import("@/lib/trading/data/types").NormalizedCandle[];
  },
): Promise<{ snapshot: NormalizedMarketSnapshot; quality: DataQualityAssessment }> {
  const snapshot = await fetchNormalizedMarketSnapshot(symbol);
  const cgTicker = await fetchCoinGeckoPrice(symbol);
  const disagreement = cgTicker
    ? detectPriceDisagreement([snapshot.ticker, cgTicker], symbol)
    : undefined;

  const quality = assessDataQuality({
    snapshot,
    priceDisagreement: disagreement,
    requiresOrderBook: options?.requiresOrderBook,
    usesLeverage: options?.usesLeverage,
    backtestCandles1m: options?.backtestCandles1m ?? snapshot.candles1m,
  });

  return { snapshot, quality };
}

export { fetchNormalizedMarketSnapshot, fetchKrakenTicker, fetchKrakenOrderBook, fetchKrakenOHLC } from "@/lib/trading/data/providers/kraken";
export * from "@/lib/trading/data/types";
export * from "@/lib/trading/data/quality-gates";
