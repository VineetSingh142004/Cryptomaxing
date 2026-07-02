import type {
  NormalizedCandle,
  NormalizedMarketSnapshot,
  NormalizedOrderBook,
  NormalizedTicker,
} from "@/lib/trading/data/types";
import {
  computeSpreadBps,
  estimateSlippageFromBook,
} from "@/lib/trading/data/quality-gates";

const KRAKEN_SYMBOL_MAP: Record<string, string> = {
  "BTC/USD": "XXBTZUSD",
  "ETH/USD": "XETHZUSD",
  "SOL/USD": "SOLUSD",
};

async function timedFetch<T>(url: string): Promise<{ data: T; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { data, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchKrakenTicker(symbol: string): Promise<NormalizedTicker> {
  const pair = KRAKEN_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const { data, latencyMs } = await timedFetch<{
    result: Record<string, { a: string[]; b: string[]; c: string[]; v: string[] }>;
  }>(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);

  const entry = Object.values(data.result)[0];
  if (!entry) throw new Error(`No ticker for ${symbol}`);

  const bid = parseFloat(entry.b[0]);
  const ask = parseFloat(entry.a[0]);
  const price = parseFloat(entry.c[0]);
  const volume24h = parseFloat(entry.v[1]);

  return {
    symbol,
    price,
    bid,
    ask,
    spread: ask - bid,
    spreadBps: computeSpreadBps(bid, ask),
    volume24h,
    timestamp: new Date().toISOString(),
    source: "kraken",
    latencyMs,
  };
}

export async function fetchKrakenOrderBook(symbol: string, depth = 25): Promise<NormalizedOrderBook> {
  const pair = KRAKEN_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const { data, latencyMs } = await timedFetch<{
    result: { [key: string]: { bids: string[][]; asks: string[][] } };
  }>(`https://api.kraken.com/0/public/Depth?pair=${pair}&count=${depth}`);

  const book = Object.values(data.result)[0];
  if (!book) throw new Error(`No order book for ${symbol}`);

  return {
    bids: book.bids.map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) })),
    asks: book.asks.map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) })),
    timestamp: new Date().toISOString(),
    source: "kraken",
    latencyMs,
  };
}

export async function fetchKrakenOHLC(
  symbol: string,
  intervalMinutes: number,
): Promise<NormalizedCandle[]> {
  const pair = KRAKEN_SYMBOL_MAP[symbol] ?? symbol.replace("/", "");
  const { data } = await timedFetch<{
    result: { [key: string]: number[][] };
  }>(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${intervalMinutes}`);

  const ohlc = Object.values(data.result)[0];
  if (!ohlc) return [];

  const tf = intervalMinutes === 1 ? "1m" : intervalMinutes === 5 ? "5m" : intervalMinutes === 15 ? "15m" : "1h";

  return ohlc.slice(0, -1).map((row) => ({
    timestamp: new Date(Number(row[0]) * 1000).toISOString(),
    open: parseFloat(String(row[1])),
    high: parseFloat(String(row[2])),
    low: parseFloat(String(row[3])),
    close: parseFloat(String(row[4])),
    volume: parseFloat(String(row[6])),
    timeframe: tf as NormalizedCandle["timeframe"],
  }));
}

const KRAKEN_FEE_BPS = { maker: 16, taker: 26 };

export async function fetchNormalizedMarketSnapshot(symbol: string): Promise<NormalizedMarketSnapshot> {
  const [ticker, orderBook, candles1m, candles5m] = await Promise.all([
    fetchKrakenTicker(symbol),
    fetchKrakenOrderBook(symbol).catch(() => null),
    fetchKrakenOHLC(symbol, 1),
    fetchKrakenOHLC(symbol, 5),
  ]);

  const mid = (ticker.bid + ticker.ask) / 2;
  const slippage = estimateSlippageFromBook(orderBook, mid, 10_000);

  const avgVolume1m =
    candles1m.length > 0
      ? candles1m.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles1m.length)
      : 0;
  const lastVol = candles1m.at(-1)?.volume ?? 0;
  const relativeVolume = avgVolume1m > 0 ? lastVol / avgVolume1m : null;

  const [base] = symbol.split("/");

  return {
    symbol,
    ticker,
    orderBook,
    candles1m,
    candles5m,
    relativeVolume,
    liquidityUsd: ticker.volume24h * ticker.price,
    feeModel: {
      makerBps: KRAKEN_FEE_BPS.maker,
      takerBps: KRAKEN_FEE_BPS.taker,
      source: "kraken_schedule",
      known: true,
    },
    slippageEstimate: {
      bps: slippage.bps,
      method: "order_book_walk_10k_usd",
      confidence: slippage.confidence,
    },
    metadata: {
      symbol,
      baseAsset: base,
      quoteAsset: "USD",
      pairAgeDays: null,
      minOrderSize: base === "BTC" ? 0.0001 : base === "ETH" ? 0.001 : 0.01,
      fundingRate: null,
      openInterest: null,
      source: "kraken",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchCoinGeckoPrice(symbol: string): Promise<NormalizedTicker | null> {
  const coinId = symbol.startsWith("BTC") ? "bitcoin" : symbol.startsWith("ETH") ? "ethereum" : symbol.startsWith("SOL") ? "solana" : null;
  if (!coinId) return null;

  try {
    const { data, latencyMs } = await timedFetch<{ [id: string]: { usd: number } }>(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
    );
    const price = data[coinId]?.usd;
    if (!price) return null;

    return {
      symbol,
      price,
      bid: price,
      ask: price,
      spread: 0,
      spreadBps: 0,
      volume24h: 0,
      timestamp: new Date().toISOString(),
      source: "coingecko",
      latencyMs,
    };
  } catch {
    return null;
  }
}
