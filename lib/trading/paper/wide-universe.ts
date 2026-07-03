import {
  buildPaperSymbolUniverse,
  fetchKrakenSpotPairs,
  type KrakenPairInfo,
  type UniverseTickerRow,
} from "@/lib/trading/paper/kraken-universe";
import {
  discoverCoinsFromCoinGecko,
  type DiscoveryCoin,
} from "@/lib/trading/data/providers/coingecko";
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
  marketCapUsd: number | null;
  spreadBps: number | null;
  riskTier: RiskTier;
  source: DiscoverySource;
  tradableOnConfiguredExchange: boolean;
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
  coinsDiscovered: number;
  krakenUniverseSize: number;
  topGainers: TieredCandidate[];
  topVolumeMovers: TieredCandidate[];
  highVolatilityCandidates: TieredCandidate[];
  tradablePaperCandidates: TieredCandidate[];
  watchlistOnlyCandidates: TieredCandidate[];
  pairMap: Map<string, KrakenPairInfo>;
  allKrakenSymbols: Set<string>;
}

let cachedWide: { result: WideUniverseResult; fetchedAt: number } | null = null;

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
    tradableOnConfiguredExchange: coin.tradableOnKraken,
    krakenPair: krakenInfo?.krakenPair,
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

  let krakenUniverse: Awaited<ReturnType<typeof buildPaperSymbolUniverse>>;
  let krakenStatus: WideUniverseResult["krakenStatus"] = "ok";
  let krakenError: string | undefined;

  try {
    krakenUniverse = await buildPaperSymbolUniverse({
      maxSymbols: SCANNER_CONFIG.maxDiscoveryCoins,
      bypassCache: options?.bypassCache,
    });
  } catch (err) {
    krakenStatus = "unavailable";
    krakenError = err instanceof Error ? err.message : "Kraken universe fetch failed";
    throw new Error(`KRAKEN_UNAVAILABLE: ${krakenError}`);
  }

  const allKrakenSymbols = new Set(krakenUniverse.symbols);
  const pairMap = krakenUniverse.pairMap;
  const krakenCandidates = krakenUniverse.topByVolume.map((r) => toTieredFromKraken(r));

  let cgGainers: TieredCandidate[] = [];
  let cgVolume: TieredCandidate[] = [];
  let cgAll: TieredCandidate[] = [];
  let coingeckoStatus: WideUniverseResult["coingeckoStatus"] = dataSources.includes("coingecko")
    ? "unavailable"
    : "skipped";
  let coingeckoError: string | undefined;
  const activeDataSources: DiscoverySource[] = ["kraken"];

  if (dataSources.includes("coingecko")) {
    try {
      const discovered = await discoverCoinsFromCoinGecko(allKrakenSymbols);
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
  const filtered = filterByMode(merged, mode);

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
    filtered.filter((c) => c.tradableOnConfiguredExchange),
  ).slice(0, SCANNER_CONFIG.maxEvaluatedCoins);

  const watchlistOnlyCandidates = dedupeBySymbol(
    filtered.filter(
      (c) => !c.tradableOnConfiguredExchange && Math.abs(c.change24hPct) >= SCANNER_CONFIG.min24hChangePct,
    ),
  )
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
    .slice(0, SCANNER_CONFIG.topCandidates);

  const result: WideUniverseResult = {
    scannerMode: mode,
    scannerModeLabel: scannerModeLabel(mode),
    dataSources: dataSources.filter((s) => s === "kraken" || s === "coingecko") as DiscoverySource[],
    activeDataSources,
    coingeckoStatus,
    coingeckoError,
    krakenStatus,
    krakenError,
    coinsDiscovered: merged.length,
    krakenUniverseSize: krakenUniverse.universeSize,
    topGainers: cgGainers.length > 0 ? cgGainers.slice(0, 20) : topGainers.slice(0, 20),
    topVolumeMovers: cgVolume.length > 0 ? cgVolume.slice(0, 20) : topVolumeMovers.slice(0, 20),
    highVolatilityCandidates,
    tradablePaperCandidates,
    watchlistOnlyCandidates,
    pairMap,
    allKrakenSymbols,
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
