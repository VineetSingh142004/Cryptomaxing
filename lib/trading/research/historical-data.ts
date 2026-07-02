import { prisma } from "@/lib/db/client";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import { detectCandleGaps } from "@/lib/trading/data/quality-gates";
import { DATA_QUALITY_THRESHOLDS } from "@/lib/trading/data/types";
import { candlesToSorted, historySpanDays } from "@/lib/trading/research/types";

const KRAKEN_SYMBOL_MAP: Record<string, string> = {
  "BTC/USD": "XXBTZUSD",
  "ETH/USD": "XETHZUSD",
  "SOL/USD": "SOLUSD",
};

const INTERVAL_MAP: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };

async function fetchKrakenPage(
  pair: string,
  interval: number,
  since?: number,
): Promise<{ candles: NormalizedCandle[]; last: number }> {
  const url = since
    ? `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`
    : `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Kraken OHLC HTTP ${res.status}`);
  const data = (await res.json()) as { result: Record<string, number[][]>; error?: string[] };
  if (data.error?.length) throw new Error(data.error.join(", "));

  const key = Object.keys(data.result).find((k) => k !== "last") ?? "";
  const rows = (key ? data.result[key] : []) as number[][];
  const last = Number(data.result.last ?? rows.at(-1)?.[0] ?? since ?? 0);

  const tf = interval === 1 ? "1m" : interval === 5 ? "5m" : interval === 15 ? "15m" : "1h";

  const candles: NormalizedCandle[] = rows.slice(0, -1).map((row) => ({
    timestamp: new Date(Number(row[0]) * 1000).toISOString(),
    open: parseFloat(String(row[1])),
    high: parseFloat(String(row[2])),
    low: parseFloat(String(row[3])),
    close: parseFloat(String(row[4])),
    volume: parseFloat(String(row[6])),
    timeframe: tf as NormalizedCandle["timeframe"],
  }));

  return { candles, last: Number(last) };
}

export async function fetchHistoricalCandles(input: {
  symbol: string;
  timeframe: "1m" | "5m";
  minDays: number;
  maxPages?: number;
}): Promise<{
  candles: NormalizedCandle[];
  dataSource: string;
  spanDays: number;
  sufficient: boolean;
  reasonCodes: string[];
}> {
  const pair = KRAKEN_SYMBOL_MAP[input.symbol];
  if (!pair) {
    return {
      candles: [],
      dataSource: "none",
      spanDays: 0,
      sufficient: false,
      reasonCodes: ["SYMBOL_NOT_MAPPED"],
    };
  }

  const interval = INTERVAL_MAP[input.timeframe];
  const maxPages = input.maxPages ?? 50;
  const all: NormalizedCandle[] = [];
  let since: number | undefined;
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const { candles, last } = await fetchKrakenPage(pair, interval, since);
    if (candles.length === 0) break;

    for (const c of candles) {
      if (!seen.has(c.timestamp)) {
        seen.add(c.timestamp);
        all.push(c);
      }
    }

    const span = historySpanDays(all);
    if (span >= input.minDays) break;

    if (last === since) break;
    since = last;
    await new Promise((r) => setTimeout(r, 350));
  }

  const sorted = candlesToSorted(all);
  const spanDays = historySpanDays(sorted);
  const gaps = detectCandleGaps(sorted, interval * 60_000);
  const reasonCodes: string[] = [];

  if (spanDays < input.minDays) reasonCodes.push("HISTORY_INSUFFICIENT");
  if (gaps.hasGaps) reasonCodes.push("CANDLE_GAPS_DETECTED");
  if (sorted.length < DATA_QUALITY_THRESHOLDS.minBacktestSampleSize) {
    reasonCodes.push("SAMPLE_SIZE_INSUFFICIENT");
  }

  const sufficient =
    spanDays >= input.minDays &&
    !gaps.hasGaps &&
    sorted.length >= DATA_QUALITY_THRESHOLDS.minBacktestSampleSize;

  return {
    candles: sorted,
    dataSource: `kraken_ohlc_${input.timeframe}`,
    spanDays,
    sufficient,
    reasonCodes,
  };
}

export async function loadOrFetchHistoricalCandles(input: {
  symbol: string;
  timeframe: "1m" | "5m";
  minDays: number;
}): Promise<ReturnType<typeof fetchHistoricalCandles>> {
  await ensureResearchVenuesAndAssets();

  const asset = await prisma.asset.findUnique({ where: { symbol: input.symbol } });
  const venue = await prisma.venue.findUnique({ where: { code: "kraken" } });

  if (asset && venue) {
    const stored = await prisma.candle.findMany({
      where: { assetId: asset.id, venueId: venue.id, timeframe: input.timeframe },
      orderBy: { timestamp: "asc" },
    });
    if (stored.length > 0) {
      const candles: NormalizedCandle[] = stored.map((c) => ({
        timestamp: c.timestamp.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
        timeframe: input.timeframe,
      }));
      const spanDays = historySpanDays(candles);
      const gaps = detectCandleGaps(candles, input.timeframe === "1m" ? 60_000 : 300_000);
      if (spanDays >= input.minDays && !gaps.hasGaps) {
        return {
          candles,
          dataSource: "db_cache",
          spanDays,
          sufficient: candles.length >= DATA_QUALITY_THRESHOLDS.minBacktestSampleSize,
          reasonCodes: [],
        };
      }
    }
  }

  const fetched = await fetchHistoricalCandles(input);

  if (fetched.sufficient && asset && venue) {
    await prisma.candle.createMany({
      data: fetched.candles.map((c) => ({
        assetId: asset.id,
        venueId: venue.id,
        timeframe: input.timeframe,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: new Date(c.timestamp),
      })),
      skipDuplicates: true,
    });
  }

  return fetched;
}

export async function ensureResearchVenuesAndAssets(): Promise<void> {
  await prisma.venue.upsert({
    where: { code: "kraken" },
    create: { code: "kraken", name: "Kraken" },
    update: {},
  });
  for (const symbol of ["BTC/USD", "ETH/USD", "SOL/USD"]) {
    const [base, quote] = symbol.split("/");
    await prisma.asset.upsert({
      where: { symbol },
      create: { symbol, baseAsset: base, quoteAsset: quote },
      update: {},
    });
  }
}
