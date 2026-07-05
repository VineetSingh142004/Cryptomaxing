import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  TREND_PULLBACK_CONTINUATION,
  VOLATILITY_COMPRESSION_BREAKOUT,
  VWAP_RECLAIM_MOMENTUM,
  type StrategyDefinition,
} from "@/lib/trading/strategies/definitions";

export type StrategyVerdict = "TRADE_ALLOWED" | "WATCH_ONLY" | "RESEARCH_ONLY";

export interface StrategyMappingResult {
  strategyId: string;
  strategyName: string;
  verdict: StrategyVerdict;
  entryFormula: string;
  stopFormula: string;
  takeProfitFormula: string;
  invalidationFormula: string;
  whyNow: string;
  whyItCanFail: string;
  whyBetterThanWaiting: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

const STRATEGIES: StrategyDefinition[] = [
  VWAP_RECLAIM_MOMENTUM,
  VOLATILITY_COMPRESSION_BREAKOUT,
  TREND_PULLBACK_CONTINUATION,
];

export function mapStrategyForCandidate(candidate: ScanCandidate): StrategyMappingResult {
  const mom = candidate.momentumScore ?? 0;
  const vol = candidate.volatilityScore ?? 0;
  const trend = candidate.trendScore ?? 0;
  const breakout = candidate.breakoutScore ?? 0;
  const change = Math.abs(candidate.change24hPct ?? 0);

  let chosen: StrategyDefinition = TREND_PULLBACK_CONTINUATION;
  let whyNow = "Trend-aligned pullback with continuation signals";

  if (breakout >= 65 && vol >= 55 && change >= 3) {
    chosen = VOLATILITY_COMPRESSION_BREAKOUT;
    whyNow = "Compression breakout with volume expansion";
  } else if (mom >= 60 && candidate.shortTermReturnPct > 0.2) {
    chosen = VWAP_RECLAIM_MOMENTUM;
    whyNow = "VWAP reclaim momentum with volume confirmation";
  } else if (trend >= 55 && mom >= 45) {
    chosen = TREND_PULLBACK_CONTINUATION;
    whyNow = "Intraday trend pullback holding support";
  } else if (candidate.opportunityScore >= 70 && candidate.action === "OPEN_TRADE") {
    chosen = TREND_PULLBACK_CONTINUATION;
    whyNow = "Highest-score fallback mapped to trend continuation rules";
  }

  const verdict: StrategyVerdict =
    candidate.action !== "OPEN_TRADE"
      ? candidate.action === "WATCHLIST_ONLY"
        ? "WATCH_ONLY"
        : "RESEARCH_ONLY"
      : candidate.opportunityScore >= minStrategyScore(chosen) &&
          candidate.tradableOnConfiguredExchange
        ? "TRADE_ALLOWED"
        : "RESEARCH_ONLY";

  return {
    strategyId: chosen.id,
    strategyName: chosen.name,
    verdict,
    entryFormula: chosen.rules.entry.slice(0, 2).join(" + "),
    stopFormula: chosen.rules.stop,
    takeProfitFormula: chosen.rules.takeProfit.join(", "),
    invalidationFormula: chosen.rules.invalidation.slice(0, 2).join("; "),
    whyNow,
    whyItCanFail: chosen.rules.failure[0] ?? chosen.rules.invalidation[0] ?? "Thesis fails",
    whyBetterThanWaiting:
      verdict === "TRADE_ALLOWED"
        ? `Expected net edge after costs beats waiting — score ${candidate.opportunityScore}`
        : "Does not beat waiting — blocked or watch only",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function minStrategyScore(strategy: StrategyDefinition): number {
  if (strategy.id === "volatility-compression-breakout") return 68;
  if (strategy.id === "vwap-reclaim-momentum") return 65;
  return 62;
}

export function blockIfNoBlueprintStrategy(candidate: ScanCandidate): {
  blocked: boolean;
  mapping: StrategyMappingResult;
} {
  const mapping = mapStrategyForCandidate(candidate);
  return {
    blocked: mapping.verdict !== "TRADE_ALLOWED",
    mapping,
  };
}

export const BLUEPRINT_STRATEGY_NAMES = STRATEGIES.map((s) => s.name);
