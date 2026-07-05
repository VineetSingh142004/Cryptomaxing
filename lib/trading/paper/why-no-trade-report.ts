import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { minScoreForTier } from "@/lib/trading/paper/trade-selection";
import type { RecordCautionModeState } from "@/lib/trading/paper/profit-protection";
import { mapStrategyForCandidate } from "@/lib/trading/paper/strategy-mapping";

export interface WhyNoTradeReport {
  finalReason: string;
  bestCandidate: {
    symbol: string;
    score: number;
    strategy: string;
    status: string;
    reasonCode: string;
    reasonText: string;
  } | null;
  exactBlocker: string | null;
  requiredThreshold: string | null;
  actualValue: string | null;
  slotsAvailable: number;
  openTradesCount: number;
  riskMode: string;
  capitalExposureUsedPct: number | null;
  riskAtStopUsedPct: number | null;
  blockedBy: Record<string, number>;
  candidateCounts: {
    totalRanked: number;
    failedFilters: number;
    watchlistOnly: number;
    qualifiedButBlocked: number;
    selectedTradeCandidate: string | null;
  };
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function isQualifiedAction(action: string): boolean {
  return action === "OPEN_TRADE" || action === "OPEN_PAPER_TRADE";
}

function isWatchOnlyAction(action: string): boolean {
  return action === "WATCH" || action === "WATCH_ONLY";
}

function effectiveMinScore(
  tier: ScanCandidate["riskTier"],
  recordCaution?: RecordCautionModeState,
): number {
  return minScoreForTier(tier) + (recordCaution?.active ? recordCaution.minScoreBoost : 0);
}

export function buildWhyNoTradeReport(input: {
  tradesOpenedThisRun: number;
  ranked: ScanCandidate[];
  rejectionSummary: Record<string, number>;
  openTradesCount: number;
  availableSlots: number;
  riskMode: string;
  recordCaution?: RecordCautionModeState;
  capitalExposureUsedPct?: number | null;
  riskAtStopUsedPct?: number | null;
  totalCandidates: number;
}): WhyNoTradeReport | null {
  if (input.tradesOpenedThisRun > 0) return null;

  const ranked = [...input.ranked].sort((a, b) => b.opportunityScore - a.opportunityScore);
  const totalRanked = input.totalCandidates || ranked.length;
  const best =
    ranked.find((c) => isQualifiedAction(c.action)) ??
    ranked[0] ??
    null;

  const failedCandidates = ranked.filter((c) => !isQualifiedAction(c.action)).length;
  const watchlistOnly = ranked.filter((c) => isWatchOnlyAction(c.action)).length;
  const qualifiedButBlocked = ranked.filter(
    (c) =>
      isQualifiedAction(c.action) &&
      c.reasonCode !== "TRADE_READY" &&
      c.action !== "OPEN_TRADE",
  ).length;

  const blockedBy = {
    SCORE_TOO_LOW: input.rejectionSummary.SCORE_TOO_LOW ?? 0,
    VOLUME_TOO_LOW: input.rejectionSummary.VOLUME_TOO_LOW ?? 0,
    BAD_RISK_REWARD:
      (input.rejectionSummary.BAD_RISK_REWARD ?? 0) +
      (input.rejectionSummary.REJECTED_BAD_RISK_REWARD ?? 0),
    NOT_TRADABLE_ON_EXCHANGE: input.rejectionSummary.NOT_TRADABLE_ON_EXCHANGE ?? 0,
    FAKE_PUMP:
      (input.rejectionSummary.FAKE_PUMP ?? 0) +
      (input.rejectionSummary.WATCH_ONLY_FAKE_PUMP_RISK ?? 0),
    CAUTION_MODE: input.recordCaution?.active ? 1 : 0,
    CAPACITY: input.availableSlots <= 0 ? 1 : 0,
  };

  let exactBlocker: string | null = null;
  let requiredThreshold: string | null = null;
  let actualValue: string | null = null;

  if (input.availableSlots <= 0) {
    exactBlocker = "MAX_OPEN_TRADES_OR_EXPOSURE";
    requiredThreshold = "available slot > 0";
    actualValue = `${input.openTradesCount} open, ${input.availableSlots} slots`;
  } else if (best) {
    const mapping = mapStrategyForCandidate(best);
    const baseMin = minScoreForTier(best.riskTier);
    const effectiveMin = effectiveMinScore(best.riskTier, input.recordCaution);

    if (mapping.verdict === "RESEARCH_ONLY" || mapping.verdict === "WATCH_ONLY") {
      exactBlocker = "NO_BLUEPRINT_STRATEGY_MATCH";
      requiredThreshold = "One of 3 blueprint strategies";
      actualValue = mapping.verdict;
    } else if (input.recordCaution?.active && best.opportunityScore >= baseMin && best.opportunityScore < effectiveMin) {
      exactBlocker = "CAUTION_MODE";
      requiredThreshold = `${effectiveMin} effective min for ${best.riskTier} (base ${baseMin} + caution boost)`;
      actualValue = String(best.opportunityScore);
    } else if (input.recordCaution?.pauseNewEntries) {
      exactBlocker = "CAUTION_MODE";
      requiredThreshold = "cooldown / caution pause";
      actualValue = input.recordCaution.dashboardMessage;
    } else if (best.reasonCode === "SCORE_TOO_LOW" && best.opportunityScore >= baseMin) {
      exactBlocker = best.reasonCode;
      requiredThreshold = `${baseMin} for ${best.riskTier}`;
      actualValue = String(best.opportunityScore);
    } else if (best.reasonCode === "SCORE_TOO_LOW") {
      exactBlocker = "SCORE_TOO_LOW";
      requiredThreshold = `${baseMin} for ${best.riskTier}`;
      actualValue = String(best.opportunityScore);
    } else if (
      best.reasonCode === "REJECTED_BAD_RISK_REWARD" ||
      best.reasonCode === "RISK_REWARD_TOO_WEAK"
    ) {
      exactBlocker = "BAD_RISK_REWARD";
      actualValue = best.reasonText;
    } else if (!isQualifiedAction(best.action)) {
      exactBlocker = best.reasonCode;
      actualValue = best.reasonText;
    } else if (input.recordCaution?.active) {
      exactBlocker = "CAUTION_MODE";
      actualValue = input.recordCaution.dashboardMessage;
    }
  }

  const safeFailed = Math.min(failedCandidates, totalRanked);
  const blockerDetail = exactBlocker
    ? exactBlocker === "SCORE_TOO_LOW" && best && best.opportunityScore >= minScoreForTier(best.riskTier)
      ? `Score passed base threshold, but blocked by ${input.recordCaution?.active ? "caution mode" : "another rule"}`
      : exactBlocker === "CAUTION_MODE"
        ? "Score passed, but blocked by caution mode."
        : exactBlocker === "NO_BLUEPRINT_STRATEGY_MATCH"
          ? "Score passed, but no blueprint strategy match."
          : exactBlocker === "BAD_RISK_REWARD"
            ? "Score passed, but reward/risk too weak."
            : `${exactBlocker}: ${best?.reasonText ?? "blocked"}`
    : best?.reasonText ?? "blocked";

  const finalReason = best
    ? `${totalRanked} candidates ranked. ${safeFailed} failed filters` +
      (watchlistOnly > 0 ? `, ${watchlistOnly} watchlist-only` : "") +
      (qualifiedButBlocked > 0 ? `, ${qualifiedButBlocked} qualified but blocked` : "") +
      `. ${best.symbol} best (${best.opportunityScore.toFixed(0)}) — ${blockerDetail}`
    : `No trade opened — ${totalRanked} candidates scanned, none tradable after filters.`;

  return {
    finalReason,
    bestCandidate: best
      ? {
          symbol: best.symbol,
          score: best.opportunityScore,
          strategy: mapStrategyForCandidate(best).strategyName,
          status: best.action,
          reasonCode: best.reasonCode,
          reasonText: best.reasonText,
        }
      : null,
    exactBlocker,
    requiredThreshold,
    actualValue,
    slotsAvailable: input.availableSlots,
    openTradesCount: input.openTradesCount,
    riskMode: input.riskMode,
    capitalExposureUsedPct: input.capitalExposureUsedPct ?? null,
    riskAtStopUsedPct: input.riskAtStopUsedPct ?? null,
    blockedBy,
    candidateCounts: {
      totalRanked,
      failedFilters: safeFailed,
      watchlistOnly,
      qualifiedButBlocked,
      selectedTradeCandidate: best?.symbol ?? null,
    },
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
