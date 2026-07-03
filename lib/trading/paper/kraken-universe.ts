import { PAPER_CONFIG, STABLECOIN_BASES } from "@/lib/trading/paper/paper-config";
import { computeSpreadBps } from "@/lib/trading/data/quality-gates";

export interface KrakenPairInfo {
  krakenPair: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  wsname: string;
}

export interface UniverseTickerRow {
  symbol: string;
  krakenPair: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  bid: number;
  ask: number;
  spreadBps: number;
  volume24h: number;
  volume24hUsd: number;
}

type AssetPairsResult = Record<
  string,
  {
    altname?: string;
    wsname?: string;
    base?: string;
    quote?: string;
    status?: string;
    leverage_buy?: number[];
    leverage_sell?: number[];
  }
>;

type TickerResult = Record<
  string,
  { a: string[]; b: string[]; c: string[]; v: string[] }
>;

let cachedUniverse: {
  symbols: string[];
  fetchedAt: number;
  pairMap: Map<string, KrakenPairInfo>;
  topByVolume: UniverseTickerRow[];
} | null = null;

const BASE_NORMALIZE: Record<string, string> = {
  XBT: "BTC",
  XXBT: "BTC",
  XETH: "ETH",
};

function normalizeBase(raw: string): string {
  const upper = raw.toUpperCase().replace(/^X(?=.{3})/, "");
  return BASE_NORMALIZE[raw] ?? BASE_NORMALIZE[upper] ?? upper.replace(/^X/, "");
}

function normalizeQuote(raw: string): string {
  if (raw === "ZUSD" || raw === "USD") return "USD";
  if (raw === "USDT") return "USDT";
  return raw.replace(/^Z/, "");
}

function parseWsname(wsname: string): { base: string; quote: string } | null {
  const parts = wsname.split("/");
  if (parts.length !== 2) return null;
  return { base: normalizeBase(parts[0]), quote: normalizeQuote(parts[1]) };
}

async function krakenFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { error?: string[]; result?: T };
    if (json.error?.length) throw new Error(json.error.join(", "));
    return json.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchKrakenSpotPairs(): Promise<KrakenPairInfo[]> {
  const result = await krakenFetch<AssetPairsResult>(
    "https://api.kraken.com/0/public/AssetPairs",
  );

  const allowedQuotes = new Set(PAPER_CONFIG.includeQuotes);
  const pairs: KrakenPairInfo[] = [];

  for (const [krakenPair, info] of Object.entries(result)) {
    if (info.status !== "online") continue;
    if (krakenPair.includes(".d")) continue;

    const wsname = info.wsname;
    if (!wsname) continue;

    const parsed = parseWsname(wsname);
    if (!parsed) continue;
    if (!allowedQuotes.has(parsed.quote)) continue;

    if (PAPER_CONFIG.excludeStablecoins) {
      if (STABLECOIN_BASES.has(parsed.base)) continue;
      if (STABLECOIN_BASES.has(parsed.quote)) continue;
    }

    if (krakenPair.startsWith("USDT") || krakenPair.startsWith("USDC")) continue;

    pairs.push({
      krakenPair,
      symbol: `${parsed.base}/${parsed.quote}`,
      baseAsset: parsed.base,
      quoteAsset: parsed.quote,
      wsname,
    });
  }

  return pairs;
}

export async function fetchKrakenAllTickers(): Promise<TickerResult> {
  return krakenFetch<TickerResult>("https://api.kraken.com/0/public/Ticker");
}

export function buildTickerRows(
  pairs: KrakenPairInfo[],
  tickers: TickerResult,
): UniverseTickerRow[] {
  const rows: UniverseTickerRow[] = [];

  for (const pair of pairs) {
    const t = tickers[pair.krakenPair];
    if (!t) continue;

    const bid = parseFloat(t.b[0]);
    const ask = parseFloat(t.a[0]);
    const price = parseFloat(t.c[0]);
    const volume24h = parseFloat(t.v[1]);
    if (!bid || !ask || !price || price <= 0) continue;

    const volume24hUsd = volume24h * price;
    if (volume24hUsd < PAPER_CONFIG.min24hVolumeUsd) continue;

    rows.push({
      symbol: pair.symbol,
      krakenPair: pair.krakenPair,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      price,
      bid,
      ask,
      spreadBps: computeSpreadBps(bid, ask),
      volume24h,
      volume24hUsd,
    });
  }

  return rows.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

export async function buildPaperSymbolUniverse(options?: {
  maxSymbols?: number;
  bypassCache?: boolean;
}): Promise<{
  symbols: string[];
  universeSize: number;
  pairMap: Map<string, KrakenPairInfo>;
  topByVolume: UniverseTickerRow[];
}> {
  const maxSymbols = options?.maxSymbols ?? PAPER_CONFIG.maxSymbols;
  const now = Date.now();

  if (
    !options?.bypassCache &&
    cachedUniverse &&
    now - cachedUniverse.fetchedAt < PAPER_CONFIG.universeCacheTtlMs
  ) {
    return {
      symbols: cachedUniverse.symbols.slice(0, maxSymbols),
      universeSize: cachedUniverse.symbols.length,
      pairMap: cachedUniverse.pairMap,
      topByVolume: cachedUniverse.topByVolume.slice(0, maxSymbols),
    };
  }

  const [pairs, tickers] = await Promise.all([fetchKrakenSpotPairs(), fetchKrakenAllTickers()]);
  const rows = buildTickerRows(pairs, tickers);
  const pairMap = new Map(pairs.map((p) => [p.symbol, p]));
  const symbols = rows.slice(0, maxSymbols).map((r) => r.symbol);

  cachedUniverse = { symbols, fetchedAt: now, pairMap, topByVolume: rows.slice(0, maxSymbols) };

  return {
    symbols,
    universeSize: rows.length,
    pairMap,
    topByVolume: rows.slice(0, maxSymbols),
  };
}

export function resolveKrakenPair(symbol: string, pairMap?: Map<string, KrakenPairInfo>): string {
  const fromMap = pairMap?.get(symbol)?.krakenPair;
  if (fromMap) return fromMap;
  return symbol.replace("/", "");
}

export function clearUniverseCache(): void {
  cachedUniverse = null;
}
