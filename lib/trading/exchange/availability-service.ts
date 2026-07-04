import {
  fetchKrakenSpotPairs,
  type KrakenPairInfo,
} from "@/lib/trading/paper/kraken-universe";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import type {
  AvailabilityTriState,
  BestExchangeLabel,
  ExchangeAvailabilityResult,
  RecommendedAvailabilityAction,
} from "@/lib/trading/exchange/availability-types";

export interface KrakenPairIndexEntry extends KrakenPairInfo {
  hasMarginLeverage: boolean;
  status: string;
}

export class KrakenPairIndex {
  readonly loaded: boolean;
  readonly loadError: string | null;
  readonly checkedAt: string;
  private readonly byBase = new Map<string, KrakenPairIndexEntry[]>();

  private constructor(
    pairs: KrakenPairIndexEntry[],
    loaded: boolean,
    loadError: string | null,
    checkedAt: string,
  ) {
    this.loaded = loaded;
    this.loadError = loadError;
    this.checkedAt = checkedAt;
    for (const pair of pairs) {
      const list = this.byBase.get(pair.baseAsset) ?? [];
      list.push(pair);
      this.byBase.set(pair.baseAsset, list);
    }
  }

  static empty(error?: string): KrakenPairIndex {
    return new KrakenPairIndex([], false, error ?? "Kraken pairs not loaded", new Date().toISOString());
  }

  static fromPairs(pairs: KrakenPairIndexEntry[]): KrakenPairIndex {
    return new KrakenPairIndex(pairs, true, null, new Date().toISOString());
  }

  findByBase(baseAsset: string): KrakenPairIndexEntry[] {
    return this.byBase.get(baseAsset.toUpperCase()) ?? [];
  }

  hasAnyPair(baseAsset: string): boolean {
    return this.findByBase(baseAsset).length > 0;
  }

  getBestSymbol(baseAsset: string): string | undefined {
    const pairs = this.findByBase(baseAsset);
    const quotePriority = ["USD", "USDT", "EUR", "BTC"];
    for (const quote of quotePriority) {
      const match = pairs.find((p) => p.quoteAsset === quote && p.status === "online");
      if (match) return match.symbol;
    }
    return pairs.find((p) => p.status === "online")?.symbol;
  }

  getAvailableQuotes(baseAsset: string): string[] {
    const quotes = new Set(
      this.findByBase(baseAsset)
        .filter((p) => p.status === "online")
        .map((p) => p.quoteAsset),
    );
    return Array.from(quotes);
  }

  allSpotSymbols(): Set<string> {
    const symbols = new Set<string>();
    for (const entries of this.byBase.values()) {
      for (const e of entries) {
        if (e.status === "online") symbols.add(e.symbol);
      }
    }
    return symbols;
  }
}

let cachedIndex: { index: KrakenPairIndex; fetchedAt: number } | null = null;

export async function loadKrakenPairIndex(options?: { bypassCache?: boolean }): Promise<KrakenPairIndex> {
  const now = Date.now();
  if (
    !options?.bypassCache &&
    cachedIndex &&
    now - cachedIndex.fetchedAt < SCANNER_CONFIG.universeCacheTtlMs
  ) {
    return cachedIndex.index;
  }

  try {
    const rawPairs = await fetchKrakenSpotPairs();
    const entries: KrakenPairIndexEntry[] = rawPairs.map((p) => ({
      ...p,
      hasMarginLeverage: Boolean(p.hasMarginLeverage),
      status: p.status ?? "online",
    }));
    const index = KrakenPairIndex.fromPairs(entries);
    cachedIndex = { index, fetchedAt: now };
    return index;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Kraken pair load failed";
    return KrakenPairIndex.empty(msg);
  }
}

export function clearKrakenPairIndexCache(): void {
  cachedIndex = null;
}

function deriveRecommendedAction(input: {
  spot: AvailabilityTriState;
  margin: AvailabilityTriState;
  usLeverage: AvailabilityTriState;
  listed: AvailabilityTriState;
}): RecommendedAvailabilityAction {
  if (input.listed === "NO" && input.spot === "NO") return "AVOID";
  if (input.spot === "UNKNOWN" || input.listed === "UNKNOWN") return "UNKNOWN";
  if (input.spot === "YES" && input.margin === "YES" && input.usLeverage !== "NO") {
    return "LEVERAGE_POSSIBLE";
  }
  if (input.spot === "YES") return "SPOT_ONLY";
  if (input.listed === "YES" && input.spot !== "YES") return "WATCH";
  return "WATCH";
}

function deriveBestExchange(
  spot: AvailabilityTriState,
  listed: AvailabilityTriState,
): BestExchangeLabel {
  if (spot === "YES") return "kraken";
  if (listed === "NO" && spot === "NO") return "unsupported";
  if (spot === "UNKNOWN" || listed === "UNKNOWN") return "unknown";
  return "watch_only";
}

export function checkKrakenAvailability(input: {
  baseAsset: string;
  coinGeckoId?: string;
  pairIndex: KrakenPairIndex;
  jurisdiction?: "US" | "UNKNOWN";
}): ExchangeAvailabilityResult {
  const base = input.baseAsset.toUpperCase();
  const checkedAt = input.pairIndex.checkedAt;
  const jurisdiction = input.jurisdiction ?? "UNKNOWN";

  if (!input.pairIndex.loaded) {
    return {
      listedOnKraken: "UNKNOWN",
      krakenSpotAvailable: "UNKNOWN",
      krakenMarginAvailable: "UNKNOWN",
      krakenFuturesAvailable: "UNKNOWN",
      usLeverageAvailable: "UNKNOWN",
      availablePairs: [],
      bestExchange: "unknown",
      recommendedAction: "UNKNOWN",
      evidenceSource: "kraken_asset_pairs_unavailable",
      checkedAt,
      confidence: "low",
      availabilityNote:
        "Kraken pair data unavailable — cannot confirm tradability. Detected by external provider, but not confirmed tradable on connected exchange.",
    };
  }

  const pairs = input.pairIndex.findByBase(base);
  const onlinePairs = pairs.filter((p) => p.status === "online" && !p.krakenPair.includes(".d"));
  const availablePairs = onlinePairs.map((p) => p.symbol);
  const hasMargin = onlinePairs.some((p) => p.hasMarginLeverage);

  const listedOnKraken: AvailabilityTriState = pairs.length > 0 ? "YES" : "NO";
  const krakenSpotAvailable: AvailabilityTriState = onlinePairs.length > 0 ? "YES" : pairs.length > 0 ? "NO" : "NO";
  const krakenMarginAvailable: AvailabilityTriState = hasMargin ? "YES" : onlinePairs.length > 0 ? "NO" : "NO";
  const krakenFuturesAvailable: AvailabilityTriState = "UNKNOWN";
  const usLeverageAvailable: AvailabilityTriState =
    jurisdiction === "US"
      ? hasMargin
        ? "UNKNOWN"
        : "NO"
      : hasMargin
        ? "UNKNOWN"
        : "UNKNOWN";

  const recommendedAction = deriveRecommendedAction({
    spot: krakenSpotAvailable,
    margin: krakenMarginAvailable,
    usLeverage: usLeverageAvailable,
    listed: listedOnKraken,
  });

  const bestExchange = deriveBestExchange(krakenSpotAvailable, listedOnKraken);

  let availabilityNote: string | null = null;
  if (krakenSpotAvailable === "UNKNOWN" || (krakenSpotAvailable === "NO" && listedOnKraken !== "NO")) {
    availabilityNote =
      "Detected by CoinGecko/DexScreener, but not confirmed tradable on connected exchange.";
  } else if (krakenSpotAvailable === "NO") {
    availabilityNote = "Not listed on Kraken spot (confirmed from live pair data).";
  }

  return {
    listedOnKraken,
    krakenSpotAvailable,
    krakenMarginAvailable,
    krakenFuturesAvailable,
    usLeverageAvailable,
    availablePairs,
    bestExchange,
    recommendedAction,
    evidenceSource: "kraken_asset_pairs",
    checkedAt,
    confidence: pairs.length > 0 ? "high" : "high",
    availabilityNote,
  };
}

export function checkExchangeAvailability(input: {
  baseAsset: string;
  coinGeckoId?: string;
  pairIndex: KrakenPairIndex;
  jurisdiction?: "US" | "UNKNOWN";
}): ExchangeAvailabilityResult {
  return checkKrakenAvailability(input);
}

export function clearExchangeAvailabilityCache(): void {
  clearKrakenPairIndexCache();
}
