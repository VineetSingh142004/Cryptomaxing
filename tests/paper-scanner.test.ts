import { describe, expect, it, vi } from "vitest";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { buildTickerRows, type KrakenPairInfo } from "@/lib/trading/paper/kraken-universe";
import {
  buildScanCandidate,
  buildScanCandidateFromTiered,
  dedupeScanCandidates,
  quickScoreFromTicker,
  rankCandidates,
  splitCandidates,
  summarizeRejections,
} from "@/lib/trading/paper/opportunity-scanner";
import { evaluateControlledActiveStrategy } from "@/lib/trading/paper/controlled-active-strategy";
import { STABLECOIN_BASES } from "@/lib/trading/paper/paper-config";
import { classifyRiskTier, SCANNER_CONFIG, validateScannerConfig } from "@/lib/trading/paper/scanner-config";
import {
  mapToDiscoveryCoin,
  type CoinGeckoMarketRow,
} from "@/lib/trading/data/providers/coingecko";
import type { TieredCandidate } from "@/lib/trading/paper/wide-universe";

function mockSnapshot(symbol = "DOGE/USD", momentum = 0.2): NormalizedMarketSnapshot {
  const now = new Date().toISOString();
  const base = 100;
  const candles = Array.from({ length: 12 }, (_, i) => ({
    timestamp: new Date(Date.now() - (12 - i) * 300_000).toISOString(),
    open: base + i * 0.1,
    high: base + i * 0.15 + 0.5,
    low: base + i * 0.05,
    close: base + i * 0.1 + momentum * 0.01,
    volume: 5000 + i * 100,
    timeframe: "5m" as const,
  }));

  return {
    symbol,
    ticker: {
      symbol,
      price: 105,
      bid: 104.95,
      ask: 105.05,
      spread: 0.1,
      spreadBps: 9.5,
      volume24h: 500_000,
      timestamp: now,
      source: "kraken",
      latencyMs: 40,
    },
    orderBook: null,
    candles1m: [],
    candles5m: candles,
    relativeVolume: 1.4,
    liquidityUsd: 52_500_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "kraken", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: 0.9 },
    metadata: {
      symbol,
      baseAsset: symbol.split("/")[0],
      quoteAsset: "USD",
      pairAgeDays: null,
      minOrderSize: 1,
      fundingRate: null,
      openInterest: null,
      source: "kraken",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: now,
  };
}

function mockTiered(overrides: Partial<TieredCandidate> = {}): TieredCandidate {
  return {
    symbol: "PEPE/USD",
    baseAsset: "PEPE",
    quoteAsset: "USD",
    price: 0.00001,
    volume24hUsd: 5_000_000,
    change24hPct: 15,
    change1hPct: 3,
    marketCapUsd: 1_000_000_000,
    spreadBps: 50,
    riskTier: "HIGH_VOLATILITY",
    source: "coingecko",
    tradableOnConfiguredExchange: true,
    ...overrides,
  };
}

describe("kraken universe ticker rows", () => {
  it("filters stablecoin bases when excluded", () => {
    const pairs: KrakenPairInfo[] = [
      {
        krakenPair: "USDCUSD",
        symbol: "USDC/USD",
        baseAsset: "USDC",
        quoteAsset: "USD",
        wsname: "USDC/USD",
      },
      {
        krakenPair: "SOLUSD",
        symbol: "SOL/USD",
        baseAsset: "SOL",
        quoteAsset: "USD",
        wsname: "SOL/USD",
      },
    ];
    const tickers = {
      SOLUSD: { a: ["150", "1"], b: ["149.9", "1"], c: ["150", "0"], v: ["10000", "50000"] },
    };
    const rows = buildTickerRows(pairs, tickers);
    expect(rows.some((r) => r.symbol === "USDC/USD")).toBe(false);
    expect(rows.some((r) => r.symbol === "SOL/USD")).toBe(true);
    expect(STABLECOIN_BASES.has("USDC")).toBe(true);
  });

  it("limits by volume filter", () => {
    const pairs: KrakenPairInfo[] = [
      {
        krakenPair: "XRPUSD",
        symbol: "XRP/USD",
        baseAsset: "XRP",
        quoteAsset: "USD",
        wsname: "XRP/USD",
      },
    ];
    const tickers = {
      XRPUSD: { a: ["1", "1"], b: ["0.99", "1"], c: ["1", "0"], v: ["100", "100"] },
    };
    const rows = buildTickerRows(pairs, tickers);
    expect(rows.length).toBe(0);
  });
});

describe("coingecko discovery", () => {
  it("maps top gainer and excludes stablecoins", () => {
    const row: CoinGeckoMarketRow = {
      id: "pepe",
      symbol: "PEPE",
      name: "Pepe",
      currentPrice: 0.00001,
      marketCap: 1e9,
      totalVolume: 10_000_000,
      priceChange24hPct: 25,
      priceChange1hPct: 5,
      high24h: 0.000012,
      low24h: 0.000008,
      lastUpdated: new Date().toISOString(),
    };
    const coin = mapToDiscoveryCoin(row, new Set(["PEPE/USD"]));
    expect(coin).not.toBeNull();
    expect(coin!.tradableOnKraken).toBe(true);
    expect(coin!.change24hPct).toBe(25);
  });

  it("marks non-kraken coin as not tradable", () => {
    const row: CoinGeckoMarketRow = {
      id: "random",
      symbol: "RND",
      name: "Random Coin",
      currentPrice: 1,
      marketCap: 1e8,
      totalVolume: 2_000_000,
      priceChange24hPct: 40,
      priceChange1hPct: 10,
      high24h: 1.2,
      low24h: 0.8,
      lastUpdated: new Date().toISOString(),
    };
    const coin = mapToDiscoveryCoin(row, new Set(["BTC/USD"]));
    expect(coin!.tradableOnKraken).toBe(false);
  });

  it("respects max discovery limits via config", () => {
    expect(SCANNER_CONFIG.maxDiscoveryCoins).toBeLessThanOrEqual(500);
    expect(SCANNER_CONFIG.maxEvaluatedCoins).toBeLessThanOrEqual(100);
  });
});

describe("risk tier classification", () => {
  it("classifies extreme mover as EXTREME_RISK", () => {
    expect(
      classifyRiskTier({ baseAsset: "PEPE", change24hPct: 35, volume24hUsd: 5e6 }),
    ).toBe("EXTREME_RISK");
  });

  it("classifies BTC as MAJOR when change is moderate", () => {
    expect(
      classifyRiskTier({ baseAsset: "BTC", change24hPct: 2, volume24hUsd: 1e9 }),
    ).toBe("MAJOR");
  });

  it("classifies high vol alt as HIGH_VOLATILITY", () => {
    expect(
      classifyRiskTier({ baseAsset: "PEPE", change24hPct: 12, volume24hUsd: 1e6 }),
    ).toBe("HIGH_VOLATILITY");
  });
});

describe("opportunity scanner", () => {
  it("ranks candidates by opportunity score", () => {
    const a = buildScanCandidate({
      snapshot: mockSnapshot("DOGE/USD", 0.3),
      tickerRow: {
        symbol: "DOGE/USD",
        krakenPair: "XDGUSD",
        baseAsset: "DOGE",
        quoteAsset: "USD",
        price: 105,
        bid: 104.95,
        ask: 105.05,
        spreadBps: 9,
        volume24h: 500_000,
        volume24hUsd: 52_500_000,
      },
      tiered: mockTiered({ symbol: "DOGE/USD", baseAsset: "DOGE", change24hPct: 8, riskTier: "ALT_LIQUID" }),
    });
    const b = buildScanCandidate({
      snapshot: {
        ...mockSnapshot("SHIB/USD", 0.01),
        ticker: { ...mockSnapshot().ticker, spreadBps: 35, symbol: "SHIB/USD" },
      },
      tiered: mockTiered({ symbol: "SHIB/USD", baseAsset: "SHIB", change24hPct: 2, riskTier: "MAJOR" }),
    });
    const ranked = rankCandidates([b, a]);
    expect(ranked[0].rank).toBe(1);
  });

  it("rejects wide spread with reason", () => {
    const snap = mockSnapshot();
    snap.ticker.spreadBps = 200;
    const c = buildScanCandidate({
      snapshot: snap,
      tiered: mockTiered({ riskTier: "MAJOR", spreadBps: 200 }),
    });
    expect(c.action).toBe("NO_TRADE");
    expect(c.reasonCode).toBe("SPREAD_TOO_WIDE");
  });

  it("high momentum + good volume scores higher than low liquidity", () => {
    const good = buildScanCandidate({
      snapshot: mockSnapshot("DOGE/USD", 1.5),
      tiered: mockTiered({ change24hPct: 18, volume24hUsd: 50_000_000, riskTier: "HIGH_VOLATILITY" }),
    });
    const bad = buildScanCandidate({
      snapshot: {
        ...mockSnapshot("LOW/USD", 1.5),
        ticker: { ...mockSnapshot().ticker, volume24h: 100, symbol: "LOW/USD" },
      },
      tiered: mockTiered({ symbol: "LOW/USD", change24hPct: 18, volume24hUsd: 100_000, riskTier: "HIGH_VOLATILITY" }),
    });
    expect(good.opportunityScore).toBeGreaterThan(bad.opportunityScore);
  });

  it("creates watchlist candidate for non-tradable high mover", () => {
    const c = buildScanCandidateFromTiered({
      tiered: mockTiered({
        symbol: "RND/USD",
        baseAsset: "RND",
        change24hPct: 40,
        tradableOnConfiguredExchange: false,
        riskTier: "EXTREME_RISK",
      }),
      snapshot: null,
    });
    expect(c.action).toBe("WATCHLIST_ONLY");
    expect(c.actionType).toBe("WATCHLIST_ONLY");
    expect(c.reasonCode).toBe("NOT_TRADABLE_ON_EXCHANGE");
  });

  it("summarizes rejection reasons", () => {
    const summary = summarizeRejections([
      {
        symbol: "A/USD",
        price: 1,
        spreadBps: 50,
        volume24hUsd: 1e6,
        change24hPct: 5,
        change1hPct: 1,
        marketCapUsd: null,
        momentumScore: 0,
        volumeSpikeScore: 0,
        volatilityScore: 0,
        liquidityScore: 0,
        spreadScore: 0,
        trendScore: 0,
        dataQualityScore: 0,
        riskPenalty: 0,
        pumpRiskPenalty: 0,
        opportunityScore: 0,
        riskTier: "ALT_LIQUID",
        shortTermReturnPct: 0,
        breakoutScore: 0,
        source: "kraken",
        tradableOnConfiguredExchange: true,
        action: "NO_TRADE",
        actionType: "REJECTED",
        reasonCode: "SPREAD_TOO_WIDE",
        reasonText: "wide",
      },
    ]);
    expect(summary.SPREAD_TOO_WIDE).toBe(1);
  });

  it("splits tradable vs watchlist vs high-vol", () => {
    const candidates = [
      buildScanCandidateFromTiered({
        tiered: mockTiered({ tradableOnConfiguredExchange: false, change24hPct: 30 }),
        snapshot: null,
      }),
    ];
    const split = splitCandidates(candidates);
    expect(split.watchlistOnlyCandidates.length).toBe(1);
  });
});

describe("controlled active strategy", () => {
  it("opens LONG under favorable mocked conditions", () => {
    const candidate = buildScanCandidate({
      snapshot: mockSnapshot("DOGE/USD", 0.5),
      tiered: mockTiered({ symbol: "DOGE/USD", change24hPct: 12, riskTier: "HIGH_VOLATILITY" }),
    });
    candidate.action = "OPEN_TRADE";
    candidate.actionType = "OPEN_PAPER_TRADE";

    const strategy = evaluateControlledActiveStrategy(candidate, 0.25);
    expect(strategy.decision).toBe("LONG");
    expect(strategy.entryPrice).not.toBeNull();
    expect(strategy.riskTier).toBe("HIGH_VOLATILITY");
    expect(strategy.riskPercent).toBeLessThan(0.5);
    expect(strategy.reasonCode).toBe("TRADE_OPENED");
  });

  it("uses smaller risk for volatile coins", () => {
    const major = buildScanCandidate({
      snapshot: mockSnapshot("BTC/USD", 0.1),
      tiered: mockTiered({ symbol: "BTC/USD", baseAsset: "BTC", change24hPct: 2, riskTier: "MAJOR" }),
    });
    major.action = "OPEN_TRADE";
    major.actionType = "OPEN_PAPER_TRADE";

    const extreme = buildScanCandidate({
      snapshot: mockSnapshot("PEPE/USD", 0.5),
      tiered: mockTiered({ change24hPct: 35, riskTier: "EXTREME_RISK" }),
    });
    extreme.action = "OPEN_TRADE";
    extreme.actionType = "OPEN_PAPER_TRADE";

    const majorStrat = evaluateControlledActiveStrategy(major, 0.1);
    const extremeStrat = evaluateControlledActiveStrategy(extreme, 0.3);
    expect(extremeStrat.riskPercent).toBeLessThan(majorStrat.riskPercent);
    expect(extremeStrat.warning).toBe("EXTREME_RISK_PAPER_ONLY");
  });

  it("returns NO_TRADE for watchlist-only candidate", () => {
    const c = buildScanCandidateFromTiered({
      tiered: mockTiered({ tradableOnConfiguredExchange: false }),
      snapshot: null,
    });
    const strategy = evaluateControlledActiveStrategy(c, 0.5);
    expect(strategy.decision).toBe("NO_TRADE");
  });

  it("never unlocks auto or uses real orders", () => {
    expect(SCANNER_CONFIG.maxOpenTrades).toBeGreaterThan(0);
    const candidate = buildScanCandidate({
      snapshot: mockSnapshot(),
      tiered: mockTiered(),
    });
    candidate.action = "OPEN_TRADE";
    const strategy = evaluateControlledActiveStrategy(candidate, 0.2);
    expect(strategy.decision).not.toBe("REAL_ORDER");
  });
});

describe("quick score", () => {
  it("ranks higher volume tighter spread higher", () => {
    const tight = quickScoreFromTicker({
      symbol: "BTC/USD",
      krakenPair: "XBTUSD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      price: 100_000,
      bid: 99990,
      ask: 100010,
      spreadBps: 2,
      volume24h: 1000,
      volume24hUsd: 100_000_000,
    });
    const wide = quickScoreFromTicker({
      symbol: "ALT/USD",
      krakenPair: "ALTUSD",
      baseAsset: "ALT",
      quoteAsset: "USD",
      price: 1,
      bid: 0.98,
      ask: 1.02,
      spreadBps: 40,
      volume24h: 1000,
      volume24hUsd: 1_000_000,
    });
    expect(tight).toBeGreaterThan(wide);
  });
});

describe("scanner config validation", () => {
  it("returns valid for default wide config", () => {
    const result = validateScannerConfig();
    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe("SCANNER_CONFIG_VALID");
  });

  it("dedupes scan candidates by symbol keeping best score", () => {
    const base = mockTiered({ symbol: "HYPE/USD", change24hPct: 20 });
    const a = buildScanCandidateFromTiered({ tiered: base, snapshot: null });
    const b = buildScanCandidateFromTiered({
      tiered: { ...base, source: "kraken", change24hPct: 25 },
      snapshot: null,
    });
    b.opportunityScore = a.opportunityScore + 5;
    const deduped = dedupeScanCandidates([a, b]);
    expect(deduped.length).toBe(1);
    expect(deduped[0].symbol).toBe("HYPE/USD");
    expect(deduped[0].source).toContain("coingecko");
  });
});

describe("coingecko fetch with mocked data", () => {
  it("discovers coins from mocked markets response", async () => {
    const mockMarkets = [
      {
        id: "bitcoin",
        symbol: "btc",
        name: "Bitcoin",
        current_price: 100000,
        market_cap: 1e12,
        total_volume: 50e9,
        price_change_percentage_24h: 3,
        price_change_percentage_1h_in_currency: 0.5,
        high_24h: 101000,
        low_24h: 99000,
        last_updated: new Date().toISOString(),
      },
      {
        id: "pepe",
        symbol: "pepe",
        name: "Pepe",
        current_price: 0.00001,
        market_cap: 1e9,
        total_volume: 10e6,
        price_change_percentage_24h: 25,
        price_change_percentage_1h_in_currency: 5,
        high_24h: 0.000012,
        low_24h: 0.000008,
        last_updated: new Date().toISOString(),
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMarkets,
      }),
    );

    const { fetchCoinGeckoTopGainers } = await import("@/lib/trading/data/providers/coingecko");
    const gainers = await fetchCoinGeckoTopGainers(10);
    expect(gainers.length).toBe(2);
    expect(gainers.some((g) => g.symbol === "PEPE")).toBe(true);

    vi.unstubAllGlobals();
  });
});
