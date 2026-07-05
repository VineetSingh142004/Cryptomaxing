import type { FeatureScoreHealth } from "@/lib/trading/paper/feature-score-health";
import type { PipelineSummaryCounts } from "@/lib/trading/paper/paper-decision-pipeline";

export type BotDiagnosticStatus =
  | "BOT_WORKING_NO_EDGE_FOUND"
  | "BOT_WORKING_TOO_STRICT"
  | "FEATURE_ENGINE_BROKEN"
  | "DATA_PROVIDER_INCOMPLETE"
  | "STRATEGY_THRESHOLDS_TOO_HIGH"
  | "MARKET_WEAK_WAIT"
  | "PAPER_TRADE_READY"
  | "PAPER_TINY_B_READY";

export interface BotWorkingVerdict {
  status: BotDiagnosticStatus;
  headline: string;
  explanation: string;
  badMarketVsBrokenBot: "BAD_MARKET" | "BROKEN_BOT" | "TOO_STRICT" | "READY" | "UNKNOWN";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function resolveBotWorkingVerdict(input: {
  featureHealth: FeatureScoreHealth;
  pipelineCounts: PipelineSummaryCounts;
  tradesOpenedThisRun: number;
  bNearMissCount?: number;
  hasOpenableDecision?: boolean;
  hasTinyBDecision?: boolean;
  marketDataStatus?: string;
}): BotWorkingVerdict {
  const flags = new Set(input.featureHealth.warningFlags);
  const broken =
    flags.has("FEATURE_SCORES_ALL_ZERO") ||
    flags.has("STRATEGY_FEATURES_NOT_COMPUTED") ||
    input.marketDataStatus === "MARKET_DATA_FAILED";

  const dataIncomplete =
    flags.has("CANDLES_MISSING_FOR_STRATEGY") ||
    input.marketDataStatus === "MARKET_DATA_PARTIAL" ||
    input.featureHealth.candlesLoadedPct < 0.3;

  if (input.hasOpenableDecision || input.tradesOpenedThisRun > 0) {
    return {
      status: "PAPER_TRADE_READY",
      headline: "Paper trade ready — valid setup found or opened",
      explanation: "Features computed and a blueprint setup passed trade-quality gates.",
      badMarketVsBrokenBot: "READY",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (input.hasTinyBDecision) {
    return {
      status: "PAPER_TINY_B_READY",
      headline: "Tiny B paper-only setup eligible",
      explanation: "Near-miss blueprint setup with safe reduced size — paper only, no live, no Auto.",
      badMarketVsBrokenBot: "READY",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (flags.has("FEATURE_SCORES_ALL_ZERO") || input.marketDataStatus === "MARKET_DATA_FAILED") {
    return {
      status: "FEATURE_ENGINE_BROKEN",
      headline: "Feature engine likely broken",
      explanation:
        "Important feature scores are all zero — investigate data pipeline before changing thresholds.",
      badMarketVsBrokenBot: "BROKEN_BOT",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (dataIncomplete) {
    return {
      status: "DATA_PROVIDER_INCOMPLETE",
      headline: "Data provider incomplete",
      explanation:
        "Candles or provider data missing for most candidates — strategy scores may default to zero without implying a weak market.",
      badMarketVsBrokenBot: "BROKEN_BOT",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (broken) {
    return {
      status: "FEATURE_ENGINE_BROKEN",
      headline: "Feature engine likely broken",
      explanation:
        "Candle-dependent strategy features were not computed — investigate feature mapping before changing thresholds.",
      badMarketVsBrokenBot: "BROKEN_BOT",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  const nearMisses = input.bNearMissCount ?? input.pipelineCounts.bNearMisses;
  const watchOnly = input.pipelineCounts.cWatchOnly;
  const maxOpp = input.featureHealth.distributions.opportunityScore.max;

  if (nearMisses > 0 || (watchOnly >= 3 && maxOpp >= 62)) {
    const tooStrict = nearMisses === 0 && watchOnly >= 5;
    return {
      status: tooStrict ? "STRATEGY_THRESHOLDS_TOO_HIGH" : "BOT_WORKING_TOO_STRICT",
      headline: tooStrict
        ? "Strategy thresholds may be too high"
        : "Bot working — filters may be too strict",
      explanation:
        "Features look valid but qualified candidates are blocked by blueprint thresholds or caution mode. Review calibration report before lowering thresholds.",
      badMarketVsBrokenBot: "TOO_STRICT",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (flags.has("MARKET_WEAK_NOT_BUG") || flags.has("MOMENTUM_TOO_LOW_FOR_ALL_CANDIDATES")) {
    return {
      status: "MARKET_WEAK_WAIT",
      headline: "Market weak — wait for better setups",
      explanation:
        "Feature engine appears healthy but momentum/trend/breakout scores are uniformly low. No-trade is likely correct market behavior.",
      badMarketVsBrokenBot: "BAD_MARKET",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  return {
    status: "BOT_WORKING_NO_EDGE_FOUND",
    headline: "Bot working — no edge found this run",
    explanation:
      "Features computed correctly, no A/A+/B setups passed. This is honest no-trade behavior, not forced entries.",
    badMarketVsBrokenBot: "BAD_MARKET",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
