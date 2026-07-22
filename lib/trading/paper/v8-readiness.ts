import type { FeatureScoreHealth } from "@/lib/trading/paper/feature-score-health";
import type { ProviderHealthGateResult } from "@/lib/trading/paper/provider-health-gate";
import type { V6LossPostmortemReport } from "@/lib/trading/paper/v6-loss-postmortem";

export const V8_STRATEGY_VERSION = "v0.11-provider-health-profit-quality" as const;
export const V8_RECORD_NAME = "V8 Data-Healthy Profit Quality Test";

export interface V8ReadinessCheck {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  candlesLoadedPct: number;
  tradabilityConfirmedPct: number;
  providerHealth: string;
  v6PostmortemComplete: boolean;
  accountingSyncOk: boolean;
  message: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateV8Readiness(input: {
  providerHealth: ProviderHealthGateResult;
  featureHealth: FeatureScoreHealth | null;
  rankedCount: number;
  tradableRankedCount: number;
  v6Postmortem: V6LossPostmortemReport | null;
  accountingSyncOk?: boolean;
}): V8ReadinessCheck {
  const candlesPct = input.featureHealth?.candlesLoadedPct ?? 0;
  const tradPct =
    input.rankedCount > 0 ? input.tradableRankedCount / input.rankedCount : 0;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.providerHealth.tradeReadyCandidatesAllowed) {
    blockers.push(input.providerHealth.dashboardMessage);
  }
  if (input.providerHealth.status === "STRATEGY_SCORING_BLOCKED_NO_CANDLES") {
    blockers.push("STRATEGY_SCORING_BLOCKED_NO_CANDLES");
  }
  if (input.providerHealth.status === "DATA_PROVIDER_INCOMPLETE") {
    blockers.push("DATA_PROVIDER_INCOMPLETE");
  }
  if (candlesPct < 0.8) {
    blockers.push(`Candles loaded ${(candlesPct * 100).toFixed(0)}% — need 80%`);
  }
  if (tradPct < 0.5) {
    blockers.push(`Tradability confirmed ${(tradPct * 100).toFixed(0)}% — too many EXCHANGE_AVAILABILITY_UNKNOWN`);
  }
  if (input.featureHealth?.warningFlags.includes("FEATURE_SCORES_ALL_ZERO")) {
    blockers.push("FEATURE_ENGINE_BROKEN");
  }
  if (!input.v6Postmortem || input.v6Postmortem.closedTrades === 0) {
    warnings.push("V6 loss postmortem incomplete — no closed V6 trades analyzed");
  } else if (input.v6Postmortem.lessons.length === 0) {
    warnings.push("V6 loss lessons not generated");
  }
  if (input.accountingSyncOk === false) {
    blockers.push("Export/dashboard accounting mismatch");
  }

  const ready = blockers.length === 0;
  return {
    ready,
    blockers,
    warnings,
    candlesLoadedPct: candlesPct,
    tradabilityConfirmedPct: tradPct,
    providerHealth: input.providerHealth.status,
    v6PostmortemComplete: Boolean(input.v6Postmortem && input.v6Postmortem.closedTrades > 0),
    accountingSyncOk: input.accountingSyncOk !== false,
    message: ready
      ? "V8 Data-Healthy Profit Quality Test may start — provider health and postmortem gates passed."
      : `V8 blocked: ${blockers.join("; ")}`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
