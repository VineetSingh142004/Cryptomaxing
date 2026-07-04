export interface DexScreenerPairSummary {
  symbol: string;
  dexId: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  pairAgeHours: number | null;
  status: "ok" | "unavailable" | "not_found";
  error?: string;
}

export async function fetchDexScreenerSummary(baseAsset: string): Promise<DexScreenerPairSummary> {
  const symbol = baseAsset.toUpperCase();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        symbol,
        dexId: "",
        liquidityUsd: null,
        volume24hUsd: null,
        priceChange24hPct: null,
        buys24h: null,
        sells24h: null,
        pairAgeHours: null,
        status: "unavailable",
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        baseToken?: { symbol?: string };
        liquidity?: { usd?: number };
        volume?: { h24?: number };
        priceChange?: { h24?: number };
        txns?: { h24?: { buys?: number; sells?: number } };
        pairCreatedAt?: number;
      }>;
    };
    const pairs = json.pairs ?? [];
    const match =
      pairs.find((p) => p.baseToken?.symbol?.toUpperCase() === symbol) ??
      pairs.find((p) => p.baseToken?.symbol?.toUpperCase().includes(symbol)) ??
      pairs[0];
    if (!match) {
      return {
        symbol,
        dexId: "",
        liquidityUsd: null,
        volume24hUsd: null,
        priceChange24hPct: null,
        buys24h: null,
        sells24h: null,
        pairAgeHours: null,
        status: "not_found",
      };
    }
    const created = match.pairCreatedAt ? Date.now() - match.pairCreatedAt : null;
    return {
      symbol,
      dexId: match.dexId ?? "",
      liquidityUsd: match.liquidity?.usd ?? null,
      volume24hUsd: match.volume?.h24 ?? null,
      priceChange24hPct: match.priceChange?.h24 ?? null,
      buys24h: match.txns?.h24?.buys ?? null,
      sells24h: match.txns?.h24?.sells ?? null,
      pairAgeHours: created !== null ? created / 3_600_000 : null,
      status: "ok",
    };
  } catch (err) {
    return {
      symbol,
      dexId: "",
      liquidityUsd: null,
      volume24hUsd: null,
      priceChange24hPct: null,
      buys24h: null,
      sells24h: null,
      pairAgeHours: null,
      status: "unavailable",
      error: err instanceof Error ? err.message : "DexScreener fetch failed",
    };
  }
}
