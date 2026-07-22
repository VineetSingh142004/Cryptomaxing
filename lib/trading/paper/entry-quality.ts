import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { StrategyScoreStatus } from "@/lib/trading/paper/strategy-score-state";
import { shouldExcludeFromScoring } from "@/lib/trading/paper/field-sanitization";

export interface EntryQualityBlockResult {
  blocked: boolean;
  reasonCode: string | null;
  reasonText: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateEntryQualityBlockers(input: {
  candidate: ScanCandidate;
  btcShortReturnPct?: number | null;
  ethShortReturnPct?: number | null;
  pullbackStrategyConfirmed?: boolean;
  providerDiscoveryOnly?: boolean;
}): EntryQualityBlockResult {
  const c = input.candidate;
  const ok = (blocked: boolean, code: string, text: string): EntryQualityBlockResult => ({
    blocked,
    reasonCode: blocked ? code : null,
    reasonText: blocked ? text : null,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  });

  if (input.providerDiscoveryOnly || c.discoveryOnly) {
    return ok(true, "COINGECKO_DISCOVERY_ONLY_NOT_TRADEABLE", "Fallback-only discovery — not trade-ready");
  }
  if (c.breakoutScoreStatus === "NOT_COMPUTED" || c.trendScoreStatus === "NOT_COMPUTED") {
    return ok(true, "STRATEGY_SCORING_BLOCKED_NO_CANDLES", "Candles missing — strategy scores NOT_COMPUTED");
  }
  if (!c.candlesLoaded || (c.candleCount ?? 0) < 10) {
    return ok(true, "STRATEGY_SCORING_BLOCKED_NO_CANDLES", "Insufficient candles for entry");
  }
  if (c.providerAnomalyFlags?.includes("DATA_OUTLIER_SANITIZED")) {
    return ok(true, "DATA_OUTLIER_SANITIZED", "Provider 24h change outlier — watchlist only");
  }
  if (c.source === "coingecko" && !c.tradableOnConfiguredExchange) {
    return ok(true, "COINGECKO_DISCOVERY_ONLY_NOT_TRADEABLE", "CoinGecko-only symbol without Kraken confirmation");
  }
  if (
    (c.shortTermReturnPct ?? 0) < 0 &&
    !input.pullbackStrategyConfirmed
  ) {
    return ok(true, "ENTRY_BLOCKED_NEGATIVE_SHORT_RETURN", "Short-term return negative without pullback reclaim");
  }
  if ((c.momentumScore ?? 0) < 30 && (c.shortTermReturnPct ?? 0) < 0) {
    return ok(true, "ENTRY_BLOCKED_MOMENTUM_FADING", "Momentum fading over recent candles");
  }
  const btcRed = (input.btcShortReturnPct ?? 0) < -0.3;
  const ethRed = (input.ethShortReturnPct ?? 0) < -0.3;
  if (btcRed && ethRed) {
    return ok(true, "ENTRY_BLOCKED_BTC_ETH_REGIME", "BTC and ETH both red — alt long blocked");
  }
  if (c.change24hDrivesScore && (c.momentumScore ?? 0) < 45) {
    return ok(true, "ENTRY_BLOCKED_24H_ONLY_STRENGTH", "Strength driven only by 24h change without momentum confirmation");
  }
  return ok(false, "", "");
}

export function tinyBEntryQualityBlock(input: {
  candidate: ScanCandidate;
  providerDiscoveryOnly?: boolean;
}): EntryQualityBlockResult {
  const base = evaluateEntryQualityBlockers({
    candidate: input.candidate,
    providerDiscoveryOnly: input.providerDiscoveryOnly,
  });
  if (base.blocked) return base;
  const c = input.candidate;
  if (!c.tradableOnConfiguredExchange) {
    return {
      blocked: true,
      reasonCode: "TINY_B_BLOCKED_DATA_QUALITY",
      reasonText: "Tiny B requires confirmed tradable Kraken pair",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }
  if (!c.candlesLoaded || (c.candleCount ?? 0) < 10) {
    return {
      blocked: true,
      reasonCode: "STRATEGY_SCORING_BLOCKED_NO_CANDLES",
      reasonText: "Tiny B requires real candles and at least one valid strategy component",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }
  const hasComponent =
    (c.momentumScore ?? 0) >= 40 ||
    (c.breakoutScoreStatus === "COMPUTED" && (c.breakoutScore ?? 0) >= 40) ||
    (c.trendScoreStatus === "COMPUTED" && (c.trendScore ?? 0) >= 40);
  if (!hasComponent) {
    return {
      blocked: true,
      reasonCode: "TINY_B_BLOCKED_STRATEGY_LAYER",
      reasonText: "Tiny B requires at least one valid strategy component — not score alone",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }
  return { blocked: false, reasonCode: null, reasonText: null, simulatedLabel: "SIMULATED_PAPER_ONLY" };
}
