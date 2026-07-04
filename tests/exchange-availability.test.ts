import { describe, expect, it } from "vitest";
import {
  KrakenPairIndex,
  checkKrakenAvailability,
  loadKrakenPairIndex,
} from "@/lib/trading/exchange/availability-service";
import { isConfirmedTradable, isUnconfirmedTradable } from "@/lib/trading/exchange/availability-types";
import { mapToDiscoveryCoin, type CoinGeckoMarketRow } from "@/lib/trading/data/providers/coingecko";
import { fetchDefiLlamaSummary } from "@/lib/trading/data/providers/defillama";
import { fetchDexScreenerSummary } from "@/lib/trading/data/providers/dexscreener";
import { fetchLunarCrushSummary } from "@/lib/trading/data/providers/lunarcrush";
import { finalizePipelineStats } from "@/lib/trading/paper/scan-pipeline";
import { buildScanCandidateFromTiered } from "@/lib/trading/paper/opportunity-scanner";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { TieredCandidate } from "@/lib/trading/paper/wide-universe";

function mockPairIndex(pairs: Array<{ base: string; symbol: string; quote?: string; margin?: boolean }>) {
  return KrakenPairIndex.fromPairs(
    pairs.map((p) => ({
      krakenPair: p.symbol.replace("/", ""),
      symbol: p.symbol,
      baseAsset: p.base,
      quoteAsset: p.quote ?? "USD",
      wsname: p.symbol,
      status: "online",
      hasMarginLeverage: p.margin ?? false,
    })),
  );
}

const sampleRow = (overrides: Partial<CoinGeckoMarketRow> = {}): CoinGeckoMarketRow => ({
  id: "pepe",
  symbol: "PEPE",
  name: "Pepe",
  currentPrice: 0.00001,
  marketCap: 1_000_000_000,
  totalVolume: 5_000_000,
  priceChange24hPct: 12,
  priceChange1hPct: 2,
  high24h: 0.000011,
  low24h: 0.000009,
  lastUpdated: new Date().toISOString(),
  ...overrides,
});

describe("exchange availability tri-state", () => {
  it("returns YES for listed Kraken spot pair", () => {
    const index = mockPairIndex([{ base: "SOL", symbol: "SOL/USD" }]);
    const result = checkKrakenAvailability({ baseAsset: "SOL", pairIndex: index });
    expect(result.listedOnKraken).toBe("YES");
    expect(result.krakenSpotAvailable).toBe("YES");
    expect(isConfirmedTradable(result)).toBe(true);
  });

  it("returns NO only when pairs loaded and asset absent", () => {
    const index = mockPairIndex([{ base: "BTC", symbol: "BTC/USD" }]);
    const result = checkKrakenAvailability({ baseAsset: "FAKECOIN", pairIndex: index });
    expect(result.listedOnKraken).toBe("NO");
    expect(result.krakenSpotAvailable).toBe("NO");
    expect(isUnconfirmedTradable(result)).toBe(false);
  });

  it("returns UNKNOWN when Kraken pair index not loaded", () => {
    const index = KrakenPairIndex.empty("network error");
    const result = checkKrakenAvailability({ baseAsset: "ETH", pairIndex: index });
    expect(result.listedOnKraken).toBe("UNKNOWN");
    expect(result.krakenSpotAvailable).toBe("UNKNOWN");
    expect(isUnconfirmedTradable(result)).toBe(true);
  });

  it("finds non-USD pairs like PEPE/USDT", () => {
    const index = mockPairIndex([{ base: "PEPE", symbol: "PEPE/USDT", quote: "USDT" }]);
    const result = checkKrakenAvailability({ baseAsset: "PEPE", pairIndex: index });
    expect(result.krakenSpotAvailable).toBe("YES");
    expect(result.availablePairs).toContain("PEPE/USDT");
  });

  it("US leverage stays UNKNOWN when margin detected", () => {
    const index = mockPairIndex([{ base: "ETH", symbol: "ETH/USD", margin: true }]);
    const result = checkKrakenAvailability({
      baseAsset: "ETH",
      pairIndex: index,
      jurisdiction: "US",
    });
    expect(result.krakenMarginAvailable).toBe("YES");
    expect(result.usLeverageAvailable).toBe("UNKNOWN");
    expect(result.krakenFuturesAvailable).toBe("UNKNOWN");
  });
});

describe("CoinGecko discovery availability", () => {
  it("does not mark coin unavailable when only USD pair missing but USDT exists", () => {
    const index = mockPairIndex([{ base: "LINK", symbol: "LINK/USDT", quote: "USDT" }]);
    const coin = mapToDiscoveryCoin(sampleRow({ symbol: "LINK", id: "chainlink" }), index);
    expect(coin?.tradableOnKraken).toBe(true);
    expect(coin?.krakenSymbol).toBe("LINK/USDT");
  });

  it("uses UNKNOWN tradability when pair index unavailable", () => {
    const index = KrakenPairIndex.empty();
    const coin = mapToDiscoveryCoin(sampleRow(), index);
    expect(coin?.tradableOnKraken).toBe(false);
    expect(coin?.availability.krakenSpotAvailable).toBe("UNKNOWN");
  });
});

describe("provider failure fallback", () => {
  it("DeFiLlama disabled does not throw", async () => {
    const prev = process.env.DEFILLAMA_ENABLED;
    process.env.DEFILLAMA_ENABLED = "false";
    const r = await fetchDefiLlamaSummary();
    expect(r.status).toBe("disabled");
    process.env.DEFILLAMA_ENABLED = prev;
  });

  it("LunarCrush disabled does not throw", async () => {
    const prev = process.env.LUNARCRUSH_ENABLED;
    process.env.LUNARCRUSH_ENABLED = "false";
    const r = await fetchLunarCrushSummary("BTC");
    expect(r.status).toBe("disabled");
    process.env.LUNARCRUSH_ENABLED = prev;
  });

  it("DexScreener returns unavailable on bad symbol without throwing", async () => {
    const r = await fetchDexScreenerSummary("ZZZZNOTREAL999");
    expect(["unavailable", "not_found", "ok"]).toContain(r.status);
  });
});

describe("scan pipeline stats", () => {
  it("tracks staged counts", () => {
    const p = finalizePipelineStats({
      coinsDiscovered: 300,
      coinsScanned: 300,
      passedBasicFilters: 75,
      deepEvaluated: 20,
      finalPaperTradeCandidates: 2,
      watchOnlyCandidates: 10,
    });
    expect(p.coinsDiscovered).toBe(300);
    expect(p.finalPaperTradeCandidates).toBe(2);
  });
});

describe("scanner watch vs not tradable", () => {
  const unknownAvailability = checkKrakenAvailability({
    baseAsset: "PEPE",
    pairIndex: KrakenPairIndex.empty(),
  });

  it("unknown availability yields WATCHLIST with EXCHANGE_AVAILABILITY_UNKNOWN", () => {
    const tiered: TieredCandidate = {
      symbol: "PEPE/USD",
      baseAsset: "PEPE",
      quoteAsset: "USD",
      price: 0.00001,
      volume24hUsd: 5_000_000,
      change24hPct: 20,
      change1hPct: 3,
      marketCapUsd: 1e9,
      spreadBps: null,
      riskTier: "HIGH_VOLATILITY",
      source: "coingecko",
      tradableOnConfiguredExchange: false,
      availability: unknownAvailability,
      name: "Pepe",
    };
    const c = buildScanCandidateFromTiered({ tiered, snapshot: null });
    expect(c.action).toBe("WATCHLIST_ONLY");
    expect(c.reasonCode).toBe("EXCHANGE_AVAILABILITY_UNKNOWN");
    expect(c.reasonText).toContain("not confirmed tradable");
  });
});

describe("auto remains locked", () => {
  it("availability improvements do not unlock Auto", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        apiSecure: true,
        noWithdrawalPermission: true,
        executionEngineWired: false,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
  });
});

describe("loadKrakenPairIndex cache", () => {
  it("exports load function", () => {
    expect(typeof loadKrakenPairIndex).toBe("function");
  });
});
