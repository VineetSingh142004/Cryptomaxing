import {
  buildPaperSymbolUniverse,
  fetchKrakenSpotPairs,
  formatKrakenFetchError,
  type KrakenPairInfo,
  type UniverseTickerRow,
} from "@/lib/trading/paper/kraken-universe";
import {
  discoverCoinsFromCoinGecko,
  type DiscoveryCoin,
} from "@/lib/trading/data/providers/coingecko";
import { fetchDefiLlamaSummary } from "@/lib/trading/data/providers/defillama";
import { fetchDexScreenerSummary } from "@/lib/trading/data/providers/dexscreener";
import type { DefiLlamaSummary } from "@/lib/trading/data/providers/defillama";
import { loadKrakenPairIndex } from "@/lib/trading/exchange/availability-service";
import { isConfirmedTradable, isUnconfirmedTradable } from "@/lib/trading/exchange/availability-types";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import {
  saveKrakenLastGoodCache,
  resolveKrakenCacheStatus,
  restorePairMapFromCache,
  restoreTradableSymbolSetFromCache,
  type KrakenCacheStatus,
} from "@/lib/trading/paper/kraken-last-good-cache";
import {
  finalizePipelineStats,
  computeCoinsFilteredOut,
  type ScanPipelineStats,
} from "@/lib/trading/paper/scan-pipeline";
import {
  SCANNER_CONFIG,
  classifyRiskTier,
  type DiscoverySource,
  type RiskTier,
  scannerModeLabel,
  type ScannerMode,
} from "@/lib/trading/paper/scanner-config";

export interface TieredCandidate {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  volume24hUsd: number;
  change24hPct: number;
  change1hPct: number | null;
  change7dPct?: number | null;
  marketCapUsd: number | null;
  spreadBps: number | null;
  riskTier: RiskTier;
  source: DiscoverySource;
  tradableOnConfiguredExchange: boolean;
  availability: ExchangeAvailabilityResult;
  krakenPair?: string;
  coinGeckoId?: string;
  name?: string;
  tickerRow?: UniverseTickerRow;
}

export interface WideUniverseResult {
  scannerMode: ScannerMode;
  scannerModeLabel: string;
  dataSources: DiscoverySource[];
  activeDataSources: DiscoverySource[];
  coingeckoStatus: "ok" | "unavailable" | "skipped";
  coingeckoError?: string;
  krakenStatus: "ok" | "unavailable";
  krakenError?: string;
  krakenFallbackUsed?: boolean;
  krakenCacheStatus?: KrakenCacheStatus;
  dexscreenerStatus: ProviderStatus;
  defillamaStatus: ProviderStatus;
  lunarcrushStatus: ProviderStatus;
  defiGlobalSummary: DefiLlamaSummary | null;
  coinsDiscovered: number;
  krakenUniverseSize: number;
  topGainers: TieredCandidate[];
  topVolumeMovers: TieredCandidate[];
  highVolatilityCandidates: TieredCandidate[];
  tradablePaperCandidates: TieredCandidate[];
  watchlistOnlyCandidates: TieredCandidate[];
  pairMap: Map<string, KrakenPairInfo>;
  allKrakenSymbols: Set<string>;
  pipeline: ScanPipelineStats;
}

let cachedWide: { result: WideUniverseResult; fetchedAt: number } | null = null;

export type ProviderStatus = "ok" | "unavailable" | "skipped" | "disabled";

function krakenNativeAvailability(symbol: string): ExchangeAvailabilityResult {
  return {
    listedOnKraken: "YES",
    krakenSpotAvailable: "YES",
    krakenMarginAvailable: "UNKNOWN",
    krakenFuturesAvailable: "UNKNOWN",
    usLeverageAvailable: "UNKNOWN",
    availablePairs: [symbol],
    bestExchange: "kraken",
    recommendedAction: "SPOT_ONLY",
    evidenceSource: "kraken_ticker_universe",
    checkedAt: new Date().toISOString(),
    confidence: "high",
    availabilityNote: null,
  };
}

function toTieredFromKraken(row: UniverseTickerRow, change24hPct = 0): TieredCandidate {
  const riskTier = classifyRiskTier({
    baseAsset: row.baseAsset,
    change24hPct,
    volume24hUsd: row.volume24hUsd,
  });
  return {
    symbol: row.symbol,
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    price: row.price,
    volume24hUsd: row.volume24hUsd,
    change24hPct,
    change1hPct: null,
    marketCapUsd: null,
    spreadBps: row.spreadBps,
    riskTier,
    source: "kraken",
    tradableOnConfiguredExchange: true,
    availability: krakenNativeAvailability(row.symbol),
    krakenPair: row.krakenPair,
    tickerRow: row,
  };
}

function toTieredFromDiscovery(coin: DiscoveryCoin, krakenPairMap: Map<string, KrakenPairInfo>): TieredCandidate {
  const riskTier = classifyRiskTier({
    baseAsset: coin.baseAsset,
    change24hPct: coin.change24hPct,
    volume24hUsd: coin.volume24hUsd,
    marketCapUsd: coin.marketCapUsd,
  });
  const krakenInfo = krakenPairMap.get(coin.symbol);
  return {
    symbol: coin.symbol,
    baseAsset: coin.baseAsset,
    quoteAsset: coin.quoteAsset,
    price: coin.price,
    volume24hUsd: coin.volume24hUsd,
    change24hPct: coin.change24hPct,
    change1hPct: coin.change1hPct,
    marketCapUsd: coin.marketCapUsd,
    spreadBps: krakenInfo ? null : null,
    riskTier,
    source: "coingecko",
    tradableOnConfiguredExchange: isConfirmedTradable(coin.availability),
    availability: coin.availability,
    krakenPair: krakenInfo?.krakenPair ?? coin.krakenSymbol,
    coinGeckoId: coin.coinGeckoId,
    name: coin.name,
  };
}

function dedupeByBase(candidates: TieredCandidate[]): TieredCandidate[] {
  const byBase = new Map<string, TieredCandidate>();
  for (const c of candidates) {
    const existing = byBase.get(c.baseAsset);
    if (!existing) {
      byBase.set(c.baseAsset, c);
      continue;
    }
    const bestScore =
      Math.abs(c.change24hPct) * 2 + Math.log10(Math.max(c.volume24hUsd, 1)) * 10;
    const existingScore =
      Math.abs(existing.change24hPct) * 2 + Math.log10(Math.max(existing.volume24hUsd, 1)) * 10;
    const winner = bestScore >= existingScore ? c : existing;
    const loser = winner === c ? existing : c;
    byBase.set(c.baseAsset, {
      ...winner,
      tradableOnConfiguredExchange:
        winner.tradableOnConfiguredExchange || loser.tradableOnConfiguredExchange,
      krakenPair: winner.krakenPair ?? loser.krakenPair,
      tickerRow: winner.tickerRow ?? loser.tickerRow,
      spreadBps: winner.spreadBps ?? loser.spreadBps,
    });
  }
  return Array.from(byBase.values());
}

function dedupeBySymbol(candidates: TieredCandidate[]): TieredCandidate[] {
  const bySymbol = new Map<string, TieredCandidate>();
  for (const c of candidates) {
    if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, c);
  }
  return Array.from(bySymbol.values());
}

function filterByMode(candidates: TieredCandidate[], mode: ScannerMode): TieredCandidate[] {
  if (mode === "safe_liquid") {
    return candidates.filter((c) => c.riskTier === "MAJOR" || c.riskTier === "ALT_LIQUID");
  }
  if (mode === "high_volatility") {
    return candidates.filter(
      (c) =>
        c.riskTier === "HIGH_VOLATILITY" ||
        c.riskTier === "EXTREME_RISK" ||
        Math.abs(c.change24hPct) >= SCANNER_CONFIG.min24hChangePct,
    );
  }
  return candidates.filter((c) => Math.abs(c.change24hPct) >= SCANNER_CONFIG.min24hChangePct || c.tradableOnConfiguredExchange);
}

export async function buildWideUniverse(options?: { bypassCache?: boolean }): Promise<WideUniverseResult> {
  const now = Date.now();
  if (
    !options?.bypassCache &&
    cachedWide &&
    now - cachedWide.fetchedAt < SCANNER_CONFIG.universeCacheTtlMs
  ) {
    return cachedWide.result;
  }

  const mode = SCANNER_CONFIG.mode;
  const dataSources = SCANNER_CONFIG.dataSources;

  let krakenUniverse: Awaited<ReturnType<typeof buildPaperSymbolUniverse>> | null = null;
  let krakenStatus: WideUniverseResult["krakenStatus"] = "ok";
  let krakenError: string | undefined;
  let krakenFallbackUsed = false;
  let pairMap = new Map<string, KrakenPairInfo>();
  let allKrakenSymbols = new Set<string>();
  let krakenCandidates: TieredCandidate[] = [];
  let krakenUniverseSize = 0;

  try {
    krakenUniverse = await buildPaperSymbolUniverse({
      maxSymbols: SCANNER_CONFIG.maxDiscoveryCoins,
      bypassCache: options?.bypassCache,
    });
    pairMap = krakenUniverse.pairMap;
    allKrakenSymbols = await loadKrakenPairIndex({ bypassCache: options?.bypassCache }).then((idx) =>
      idx.allSpotSymbols(),
    );
    krakenCandidates = krakenUniverse.topByVolume.map((r) => toTieredFromKraken(r));
    krakenUniverseSize = krakenUniverse.universeSize;
    saveKrakenLastGoodCache({
      pairMap: krakenUniverse.pairMap,
      tradableSymbols: krakenUniverse.symbols,
    });
  } catch (err) {
    krakenStatus = "unavailable";
    krakenError = formatKrakenFetchError(err);
    krakenFallbackUsed = dataSources.includes("coingecko");
    const cachedPairMap = restorePairMapFromCache();
    const cachedSymbols = restoreTradableSymbolSetFromCache();
    if (cachedPairMap) pairMap = cachedPairMap;
    if (cachedSymbols) allKrakenSymbols = cachedSymbols;
  }

  const krakenCacheStatus = resolveKrakenCacheStatus();

  const pairIndex = await loadKrakenPairIndex({ bypassCache: options?.bypassCache });
  if (krakenStatus === "unavailable" && pairMap.size === 0) {
    allKrakenSymbols = pairIndex.allSpotSymbols();
  }

  let dexscreenerStatus: ProviderStatus =
    process.env.DEXSCREENER_ENABLED === "false" ? "disabled" : "skipped";
  let defillamaStatus: ProviderStatus = "skipped";
  let lunarcrushStatus: ProviderStatus =
    process.env.LUNARCRUSH_ENABLED === "true" ? "skipped" : "disabled";

  const defiSummary = await fetchDefiLlamaSummary().catch(() => null);
  if (defiSummary?.status === "ok") defillamaStatus = "ok";
  else if (defiSummary?.status === "disabled") defillamaStatus = "disabled";
  else if (process.env.DEFILLAMA_ENABLED !== "false") defillamaStatus = "unavailable";

  if (process.env.DEXSCREENER_ENABLED === "false") {
    dexscreenerStatus = "disabled";
  } else {
    const dexProbe = await fetchDexScreenerSummary("ETH").catch(() => null);
    if (dexProbe && dexProbe.status !== "unavailable") dexscreenerStatus = "ok";
    else dexscreenerStatus = "unavailable";
  }

  let cgGainers: TieredCandidate[] = [];
  let cgVolume: TieredCandidate[] = [];
  let cgAll: TieredCandidate[] = [];
  let coingeckoStatus: WideUniverseResult["coingeckoStatus"] = dataSources.includes("coingecko")
    ? "unavailable"
    : "skipped";
  let coingeckoError: string | undefined;
  const activeDataSources: DiscoverySource[] =
    krakenStatus === "ok" ? ["kraken"] : krakenFallbackUsed ? [] : [];

  if (dataSources.includes("coingecko")) {
    try {
      const discovered = await discoverCoinsFromCoinGecko(pairIndex);
      cgGainers = discovered.topGainers.map((c) => toTieredFromDiscovery(c, pairMap));
      cgVolume = discovered.topVolume.map((c) => toTieredFromDiscovery(c, pairMap));
      cgAll = discovered.allDiscovered.map((c) => toTieredFromDiscovery(c, pairMap));
      coingeckoStatus = "ok";
      activeDataSources.push("coingecko");
    } catch (err) {
      coingeckoStatus = "unavailable";
      coingeckoError = err instanceof Error ? err.message : "CoinGecko fetch failed";
    }
  }

  const merged = dedupeByBase([...cgAll, ...krakenCandidates]);

  if (merged.length === 0) {
    if (krakenStatus === "unavailable" && coingeckoStatus === "unavailable") {
      throw new Error(
        `MARKET_DATA_FAILED: Kraken unavailable (${krakenError ?? "unknown"}); CoinGecko unavailable (${coingeckoError ?? "unknown"})`,
      );
    }
    if (krakenStatus === "unavailable" && coingeckoStatus === "skipped") {
      throw new Error(`KRAKEN_UNAVAILABLE: ${krakenError ?? "Kraken universe fetch failed"}`);
    }
    throw new Error("UNIVERSE_EMPTY: No candidates discovered from available providers");
  }
  const preFilterCount = merged.length;
  const filtered = filterByMode(merged, mode);
  const removedByBasicMode = preFilterCount - filtered.length;

  const removedByExchangeAvailability = filtered.filter(
    (c) => c.availability.krakenSpotAvailable === "NO",
  ).length;
  const removedByUsAvailability = filtered.filter(
    (c) => c.availability.usLeverageAvailable === "NO",
  ).length;
  const removedByVolume = filtered.filter(
    (c) => c.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd,
  ).length;
  const removedByLiquidity = filtered.filter(
    (c) => c.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd * 2 && c.riskTier === "MAJOR",
  ).length;
  const removedByMarketCapRisk = filtered.filter(
    (c) => (c.marketCapUsd ?? 0) > 0 && (c.marketCapUsd ?? 0) < 1_000_000 && c.riskTier === "EXTREME_RISK",
  ).length;

  const passedBasicFilters = filtered.filter(
    (c) =>
      c.volume24hUsd >= SCANNER_CONFIG.min24hVolumeUsd &&
      (c.tradableOnConfiguredExchange || isUnconfirmedTradable(c.availability)),
  ).length;

  const topGainers = [...filtered]
    .sort((a, b) => b.change24hPct - a.change24hPct)
    .slice(0, 50);

  const topVolumeMovers = [...filtered]
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 50);

  const highVolatilityCandidates = filtered
    .filter(
      (c) =>
        c.riskTier === "HIGH_VOLATILITY" ||
        c.riskTier === "EXTREME_RISK" ||
        Math.abs(c.change24hPct) >= SCANNER_CONFIG.highVol24hChangePct,
    )
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
    .slice(0, SCANNER_CONFIG.topCandidates);

  const tradablePaperCandidates = dedupeBySymbol(
    filtered.filter((c) => c.tradableOnConfiguredExchange && c.source === "kraken"),
  ).slice(0, SCANNER_CONFIG.maxEvaluatedCoins);

  const watchlistOnlyCandidates = dedupeBySymbol(
    filtered.filter(
      (c) =>
        c.source === "coingecko" ||
        !c.tradableOnConfiguredExchange ||
        isUnconfirmedTradable(c.availability),
    ),
  )
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
    .slice(0, SCANNER_CONFIG.topCandidates);

  const pipeline = finalizePipelineStats({
    coinsDiscovered: merged.length,
    coinsScanned: merged.length,
    coinsFilteredOut: computeCoinsFilteredOut({
      coinsDiscovered: merged.length,
      passedBasicFilters,
      removedByLiquidity,
      removedByVolume,
      removedByMarketCapRisk,
      removedByExchangeAvailability,
      removedByUsAvailability: removedByUsAvailability + removedByBasicMode,
    }),
    removedByLiquidity,
    removedByVolume,
    removedByMarketCapRisk,
    removedByExchangeAvailability,
    removedByUsAvailability: removedByUsAvailability + removedByBasicMode,
    passedBasicFilters,
    deepEvaluated: 0,
    deepEvaluationLimit: SCANNER_CONFIG.maxEvaluatedCoins,
    deepEvaluationLimitReason: `All ${merged.length} discovered coins scanned and ranked; top ${Math.min(tradablePaperCandidates.length + watchlistOnlyCandidates.length, SCANNER_CONFIG.maxEvaluatedCoins)} sent to deep evaluation (Kraken snapshot + scoring). Limit from SCANNER_MAX_EVALUATED_COINS=${SCANNER_CONFIG.maxEvaluatedCoins}. Remaining coins stay on watchlist/quick-score only — not randomly skipped.`,
    finalCandidates: 0,
    finalPaperTradeCandidates: tradablePaperCandidates.length,
    watchOnlyCandidates: watchlistOnlyCandidates.length,
    selectionExplanation: `All ${merged.length} coins scanned from providers; ${passedBasicFilters} passed basic filters; top ${Math.min(tradablePaperCandidates.length, SCANNER_CONFIG.maxEvaluatedCoins)} tradable coins deep-evaluated by score`,
    providerStatus: {
      kraken: krakenStatus,
      coingecko: coingeckoStatus,
      dexscreener: dexscreenerStatus,
      defillama: defillamaStatus,
      lunarcrush: lunarcrushStatus,
    },
  });

  const result: WideUniverseResult = {
    scannerMode: mode,
    scannerModeLabel: scannerModeLabel(mode),
    dataSources: dataSources.filter((s) => s === "kraken" || s === "coingecko") as DiscoverySource[],
    activeDataSources,
    coingeckoStatus,
    coingeckoError,
    krakenStatus,
    krakenError,
    krakenFallbackUsed,
    krakenCacheStatus,
    dexscreenerStatus,
    defillamaStatus,
    lunarcrushStatus,
    defiGlobalSummary: defiSummary,
    coinsDiscovered: merged.length,
    krakenUniverseSize,
    topGainers: cgGainers.length > 0 ? cgGainers.slice(0, 20) : topGainers.slice(0, 20),
    topVolumeMovers: cgVolume.length > 0 ? cgVolume.slice(0, 20) : topVolumeMovers.slice(0, 20),
    highVolatilityCandidates,
    tradablePaperCandidates,
    watchlistOnlyCandidates,
    pairMap,
    allKrakenSymbols,
    pipeline,
  };

  cachedWide = { result, fetchedAt: now };
  return result;
}

export async function fetchAllKrakenSymbolSet(): Promise<Set<string>> {
  const pairs = await fetchKrakenSpotPairs();
  return new Set(pairs.map((p) => p.symbol));
}

export function clearWideUniverseCache(): void {
  cachedWide = null;
}
