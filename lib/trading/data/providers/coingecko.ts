import { STABLECOIN_BASES } from "@/lib/trading/paper/paper-config";
import { SCANNER_CONFIG, WRAPPED_PREFIXES } from "@/lib/trading/paper/scanner-config";

export interface CoinGeckoMarketRow {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  marketCap: number;
  totalVolume: number;
  priceChange24hPct: number;
  priceChange1hPct: number | null;
  high24h: number;
  low24h: number;
  lastUpdated: string;
}

export interface DiscoveryCoin {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  coinGeckoId: string;
  name: string;
  price: number;
  volume24hUsd: number;
  change24hPct: number;
  change1hPct: number | null;
  marketCapUsd: number;
  source: "coingecko";
  tradableOnKraken: boolean;
  krakenSymbol?: string;
}

type RawMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  high_24h: number;
  low_24h: number;
  last_updated: string;
};

async function coingeckoFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function isWrappedAsset(symbol: string, name: string): boolean {
  const upper = symbol.toUpperCase();
  if (SCANNER_CONFIG.excludeWrapped) {
    for (const prefix of WRAPPED_PREFIXES) {
      if (upper.startsWith(prefix) && upper.length > prefix.length + 2) return true;
    }
    if (/^W[A-Z]{2,}/.test(upper)) return true;
    if (name.toLowerCase().includes("wrapped")) return true;
  }
  return false;
}

function shouldExclude(symbol: string, name: string): boolean {
  const base = symbol.toUpperCase();
  if (SCANNER_CONFIG.excludeStablecoins && STABLECOIN_BASES.has(base)) return true;
  if (isWrappedAsset(base, name)) return true;
  return false;
}

export async function fetchCoinGeckoMarkets(options?: {
  order?: "volume_desc" | "percent_change_24h_desc";
  perPage?: number;
  page?: number;
}): Promise<CoinGeckoMarketRow[]> {
  const order = options?.order ?? "volume_desc";
  const perPage = Math.min(options?.perPage ?? 250, 250);
  const page = options?.page ?? 1;
  const url =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&order=${order}&per_page=${perPage}&page=${page}` +
    `&sparkline=false&price_change_percentage=1h,24h`;

  const raw = await coingeckoFetch<RawMarket[]>(url);
  return raw.map((r) => ({
    id: r.id,
    symbol: r.symbol.toUpperCase(),
    name: r.name,
    currentPrice: r.current_price ?? 0,
    marketCap: r.market_cap ?? 0,
    totalVolume: r.total_volume ?? 0,
    priceChange24hPct: r.price_change_percentage_24h ?? 0,
    priceChange1hPct: r.price_change_percentage_1h_in_currency ?? null,
    high24h: r.high_24h ?? 0,
    low24h: r.low_24h ?? 0,
    lastUpdated: r.last_updated,
  }));
}

export async function fetchCoinGeckoTopGainers(limit = 100): Promise<CoinGeckoMarketRow[]> {
  return fetchCoinGeckoMarkets({ order: "percent_change_24h_desc", perPage: limit, page: 1 });
}

export async function fetchCoinGeckoTopVolume(limit = 250): Promise<CoinGeckoMarketRow[]> {
  return fetchCoinGeckoMarkets({ order: "volume_desc", perPage: limit, page: 1 });
}

export function mapToDiscoveryCoin(
  row: CoinGeckoMarketRow,
  krakenSymbols: Set<string>,
): DiscoveryCoin | null {
  if (shouldExclude(row.symbol, row.name)) return null;
  if (row.currentPrice < SCANNER_CONFIG.minPriceUsd) return null;
  if (row.totalVolume < SCANNER_CONFIG.min24hVolumeUsd) return null;

  const krakenSymbol = `${row.symbol}/USD`;
  const tradableOnKraken = krakenSymbols.has(krakenSymbol);

  return {
    symbol: krakenSymbol,
    baseAsset: row.symbol,
    quoteAsset: "USD",
    coinGeckoId: row.id,
    name: row.name,
    price: row.currentPrice,
    volume24hUsd: row.totalVolume,
    change24hPct: row.priceChange24hPct,
    change1hPct: row.priceChange1hPct,
    marketCapUsd: row.marketCap,
    source: "coingecko",
    tradableOnKraken,
    krakenSymbol: tradableOnKraken ? krakenSymbol : undefined,
  };
}

export async function discoverCoinsFromCoinGecko(krakenSymbols: Set<string>): Promise<{
  topGainers: DiscoveryCoin[];
  topVolume: DiscoveryCoin[];
  allDiscovered: DiscoveryCoin[];
}> {
  const maxPerSource = Math.ceil(SCANNER_CONFIG.maxDiscoveryCoins / 2);
  const [gainers, volume] = await Promise.all([
    fetchCoinGeckoTopGainers(Math.min(maxPerSource, 100)).catch(() => [] as CoinGeckoMarketRow[]),
    fetchCoinGeckoTopVolume(Math.min(maxPerSource, 250)).catch(() => [] as CoinGeckoMarketRow[]),
  ]);

  const seen = new Set<string>();
  const allDiscovered: DiscoveryCoin[] = [];
  const topGainers: DiscoveryCoin[] = [];
  const topVolume: DiscoveryCoin[] = [];

  for (const row of gainers) {
    const coin = mapToDiscoveryCoin(row, krakenSymbols);
    if (!coin || seen.has(coin.baseAsset)) continue;
    seen.add(coin.baseAsset);
    topGainers.push(coin);
    allDiscovered.push(coin);
  }

  for (const row of volume) {
    const coin = mapToDiscoveryCoin(row, krakenSymbols);
    if (!coin || seen.has(coin.baseAsset)) continue;
    seen.add(coin.baseAsset);
    topVolume.push(coin);
    allDiscovered.push(coin);
  }

  return {
    topGainers: topGainers.slice(0, SCANNER_CONFIG.maxDiscoveryCoins),
    topVolume: topVolume.slice(0, SCANNER_CONFIG.maxDiscoveryCoins),
    allDiscovered: allDiscovered.slice(0, SCANNER_CONFIG.maxDiscoveryCoins),
  };
}
