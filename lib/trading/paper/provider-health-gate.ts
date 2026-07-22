import type { FeatureScoreHealth } from "@/lib/trading/paper/feature-score-health";
import type { KrakenCacheStatus } from "@/lib/trading/paper/kraken-last-good-cache";

export type ProviderHealthStatus =
  | "PROVIDER_HEALTHY"
  | "KRAKEN_PUBLIC_DEGRADED"
  | "KRAKEN_UNAVAILABLE"
  | "COINGECKO_FALLBACK_DISCOVERY_ONLY"
  | "DATA_PROVIDER_INCOMPLETE"
  | "STRATEGY_SCORING_BLOCKED_NO_CANDLES"
  | "EXCHANGE_TRADABILITY_UNKNOWN";

export interface ProviderHealthGateResult {
  status: ProviderHealthStatus;
  strategyScoringAllowed: boolean;
  tradeReadyCandidatesAllowed: boolean;
  discoveryOnly: boolean;
  headline: string;
  dashboardMessage: string;
  reasonCode: string;
  krakenCacheLabel: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateProviderHealth(input: {
  krakenStatus: "ok" | "unavailable";
  krakenError?: string | null;
  coingeckoStatus: "ok" | "unavailable" | "skipped";
  krakenFallbackUsed?: boolean;
  krakenCacheStatus?: KrakenCacheStatus | null;
  candlesLoadedPct?: number;
  tradabilityUnknownPct?: number;
  featureHealth?: FeatureScoreHealth | null;
}): ProviderHealthGateResult {
  const candlesPct = input.candlesLoadedPct ?? input.featureHealth?.candlesLoadedPct ?? 0;
  const tradUnknown = input.tradabilityUnknownPct ?? 0;
  const cache = input.krakenCacheStatus;
  const cacheLabel = cache?.label ?? null;

  if (input.krakenStatus === "unavailable" && input.coingeckoStatus === "ok" && input.krakenFallbackUsed) {
    return {
      status: "COINGECKO_FALLBACK_DISCOVERY_ONLY",
      strategyScoringAllowed: false,
      tradeReadyCandidatesAllowed: false,
      discoveryOnly: true,
      headline: "CoinGecko discovery only — Kraken tradability/candles unavailable",
      dashboardMessage:
        "No trade opened because Kraken tradability/candle data unavailable. CoinGecko fallback is watchlist/discovery only — not trade-ready.",
      reasonCode: "COINGECKO_FALLBACK_DISCOVERY_ONLY",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (input.krakenStatus === "unavailable") {
    return {
      status: "KRAKEN_UNAVAILABLE",
      strategyScoringAllowed: false,
      tradeReadyCandidatesAllowed: false,
      discoveryOnly: true,
      headline: "Kraken unavailable — strategy scoring blocked",
      dashboardMessage:
        `No trade opened because Kraken tradability/candle data unavailable.${input.krakenError ? ` (${input.krakenError})` : ""}`,
      reasonCode: "KRAKEN_UNAVAILABLE",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (input.krakenStatus === "ok" && cache?.label === "KRAKEN_CACHE_STALE") {
    return {
      status: "KRAKEN_PUBLIC_DEGRADED",
      strategyScoringAllowed: candlesPct >= 0.5,
      tradeReadyCandidatesAllowed: false,
      discoveryOnly: !cache.canOpenTrades,
      headline: "Kraken cache stale — no new trades",
      dashboardMessage:
        "Kraken last-good universe cache is stale (>60m). Watchlist only — cannot open new paper trades until fresh Kraken data returns.",
      reasonCode: "KRAKEN_CACHE_STALE",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (candlesPct < 0.1 || input.featureHealth?.warningFlags.includes("CANDLES_MISSING_FOR_STRATEGY")) {
    return {
      status: "STRATEGY_SCORING_BLOCKED_NO_CANDLES",
      strategyScoringAllowed: false,
      tradeReadyCandidatesAllowed: false,
      discoveryOnly: true,
      headline: "Strategy scoring blocked — candles missing",
      dashboardMessage:
        "No trade opened because fewer than required 5m candles loaded. Breakout/trend scores are NOT_COMPUTED — not market weakness.",
      reasonCode: "STRATEGY_SCORING_BLOCKED_NO_CANDLES",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (candlesPct < 0.8) {
    return {
      status: "DATA_PROVIDER_INCOMPLETE",
      strategyScoringAllowed: candlesPct >= 0.5,
      tradeReadyCandidatesAllowed: candlesPct >= 0.8 && tradUnknown < 0.5,
      discoveryOnly: candlesPct < 0.8,
      headline: "Data provider incomplete — limited strategy scoring",
      dashboardMessage:
        `Candles loaded for ${(candlesPct * 100).toFixed(0)}% of ranked candidates (need 80% for V8). Strategy scoring limited.`,
      reasonCode: "DATA_PROVIDER_INCOMPLETE",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (tradUnknown >= 0.5) {
    return {
      status: "EXCHANGE_TRADABILITY_UNKNOWN",
      strategyScoringAllowed: false,
      tradeReadyCandidatesAllowed: false,
      discoveryOnly: true,
      headline: "Exchange tradability unknown for most candidates",
      dashboardMessage:
        "No trade opened because Kraken tradability could not be confirmed for top candidates.",
      reasonCode: "EXCHANGE_TRADABILITY_UNKNOWN",
      krakenCacheLabel: cacheLabel,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  return {
    status: cache?.label === "USING_LAST_GOOD_KRAKEN_UNIVERSE" ? "KRAKEN_PUBLIC_DEGRADED" : "PROVIDER_HEALTHY",
    strategyScoringAllowed: true,
    tradeReadyCandidatesAllowed: true,
    discoveryOnly: false,
    headline:
      cache?.label === "USING_LAST_GOOD_KRAKEN_UNIVERSE"
        ? "Using last-good Kraken universe — fresh prices required for trades"
        : "Provider healthy — strategy scoring enabled",
    dashboardMessage:
      cache?.label === "USING_LAST_GOOD_KRAKEN_UNIVERSE"
        ? "Kraken live fetch failed; using fresh last-good pair map for tradability. Trades still require live candles."
        : "Kraken data healthy — full strategy scoring enabled.",
    reasonCode: cache?.label === "USING_LAST_GOOD_KRAKEN_UNIVERSE" ? "USING_LAST_GOOD_KRAKEN_UNIVERSE" : "PROVIDER_HEALTHY",
    krakenCacheLabel: cacheLabel,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
