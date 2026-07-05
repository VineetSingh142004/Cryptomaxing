import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { minScoreForTier, resolveCandidateBlockReason } from "@/lib/trading/paper/trade-selection";
import type { RecordCautionModeState } from "@/lib/trading/paper/profit-protection";
import {
  evaluateAllBlueprintStrategies,
  mapStrategyForCandidate,
  type BlueprintStrategyMatchDebug,
} from "@/lib/trading/paper/strategy-mapping";
import {
  evaluatePaperDecision,
  type PipelineSummaryCounts,
} from "@/lib/trading/paper/paper-decision-pipeline";

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
  pipelineCounts: PipelineSummaryCounts;
  blueprintStrategyMatchDebug: BlueprintStrategyMatchDebug | null;
  closestStrategy: string | null;
  passedConditions: string[];
  failedConditions: string[];
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function isWatchOnlyAction(action: string): boolean {
  return action === "WATCH" || action === "WATCH_ONLY" || action === "WATCHLIST_ONLY";
}

function effectiveMinScore(
  tier: ScanCandidate["riskTier"],
  recordCaution?: RecordCautionModeState,
): number {
  return minScoreForTier(tier) + (recordCaution?.active ? recordCaution.minScoreBoost : 0);
}

function pickBestCandidate(ranked: ScanCandidate[]): ScanCandidate | null {
  if (ranked.length === 0) return null;
  const withDecision = ranked.map((c) => ({
    candidate: c,
    decision: evaluatePaperDecision(c),
  }));
  const openable = withDecision.find(
    (x) => x.decision.decision === "OPEN_PAPER_TRADE" || x.decision.decision === "TINY_B_SETUP_PAPER_ONLY",
  );
  if (openable) return openable.candidate;
  return [...withDecision]
    .sort((a, b) => b.candidate.opportunityScore - a.candidate.opportunityScore)[0]?.candidate ?? null;
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
  pipelineCounts?: PipelineSummaryCounts;
  discovered?: number;
  evaluated?: number;
}): WhyNoTradeReport | null {
  if (input.tradesOpenedThisRun > 0) return null;

  const ranked = [...input.ranked].sort((a, b) => b.opportunityScore - a.opportunityScore);
  const totalRanked = input.totalCandidates || ranked.length;
  const best = pickBestCandidate(ranked);
  const pipelineCounts =
    input.pipelineCounts ??
    ({
      discovered: input.discovered ?? totalRanked,
      evaluated: input.evaluated ?? totalRanked,
      ranked: totalRanked,
      failedFilters: ranked.filter((c) => c.action === "NO_TRADE" || c.action === "SKIPPED").length,
      aPlusMatches: 0,
      aMatches: 0,
      bNearMisses: 0,
      cWatchOnly: 0,
      rejected: totalRanked,
    } satisfies PipelineSummaryCounts);

  const failedCandidates = ranked.filter((c) => c.action === "NO_TRADE" || c.action === "SKIPPED").length;
  const watchlistOnly = ranked.filter((c) => isWatchOnlyAction(c.action)).length;

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
    NO_BLUEPRINT_STRATEGY_MATCH: input.rejectionSummary.NO_BLUEPRINT_STRATEGY_MATCH ?? 0,
    CAUTION_MODE: input.recordCaution?.active ? 1 : 0,
    CAPACITY: input.availableSlots <= 0 ? 1 : 0,
  };

  let exactBlocker: string | null = null;
  let requiredThreshold: string | null = null;
  let actualValue: string | null = null;
  let blueprintStrategyMatchDebug: BlueprintStrategyMatchDebug | null = null;
  let closestStrategy: string | null = null;
  let passedConditions: string[] = [];
  let failedConditions: string[] = [];

  const paperDecision = best ? evaluatePaperDecision(best, { recordCaution: input.recordCaution }) : null;

  if (input.availableSlots <= 0) {
    exactBlocker = "MAX_OPEN_TRADES_OR_EXPOSURE";
    requiredThreshold = "available slot > 0";
    actualValue = `${input.openTradesCount} open, ${input.availableSlots} slots`;
  } else if (best && paperDecision) {
    blueprintStrategyMatchDebug = paperDecision.blueprint;
    closestStrategy = paperDecision.closestStrategy;
    passedConditions = paperDecision.passedConditions;
    failedConditions = paperDecision.failedConditions;
    const baseMin = minScoreForTier(best.riskTier);
    const effectiveMin = effectiveMinScore(best.riskTier, input.recordCaution);

    if (input.recordCaution?.pauseNewEntries) {
      exactBlocker = "CAUTION_MODE";
      requiredThreshold = "cooldown / caution pause";
      actualValue = input.recordCaution.dashboardMessage;
    } else if (
      input.recordCaution?.active &&
      best.opportunityScore >= baseMin &&
      best.opportunityScore < effectiveMin
    ) {
      exactBlocker = "CAUTION_MODE";
      requiredThreshold = `${effectiveMin} effective min for ${best.riskTier} (base ${baseMin} + caution boost)`;
      actualValue = String(best.opportunityScore);
    } else if (paperDecision.decision === "WATCH_ONLY" || paperDecision.decision === "RESEARCH_ONLY") {
      exactBlocker = "NO_BLUEPRINT_STRATEGY_MATCH";
      requiredThreshold = "One of 3 blueprint strategies (VWAP Reclaim / Vol Compression / Trend Pullback)";
      actualValue = paperDecision.setupTier;
    } else if (
      best.opportunityScore >= baseMin &&
      (paperDecision.blockedReason || blueprintStrategyMatchDebug?.finalReason)
    ) {
      exactBlocker = "NO_BLUEPRINT_STRATEGY_MATCH";
      requiredThreshold = "One of 3 blueprint strategies";
      actualValue = paperDecision.setupTier;
    } else if (
      best.reasonCode === "REJECTED_BAD_RISK_REWARD" ||
      best.reasonCode === "RISK_REWARD_TOO_WEAK"
    ) {
      exactBlocker = "BAD_RISK_REWARD";
      actualValue = best.reasonText;
    } else if (best.reasonCode === "SCORE_TOO_LOW" && best.opportunityScore >= baseMin) {
      exactBlocker = input.recordCaution?.active ? "CAUTION_MODE" : "CONFIDENCE_OR_FILTER";
      requiredThreshold = input.recordCaution?.active
        ? `${effectiveMin} effective min for ${best.riskTier}`
        : `base ${baseMin} for ${best.riskTier}`;
      actualValue = String(best.opportunityScore);
    } else if (best.reasonCode === "SCORE_TOO_LOW") {
      exactBlocker = "SCORE_TOO_LOW";
      requiredThreshold = `${baseMin} for ${best.riskTier}`;
      actualValue = String(best.opportunityScore);
    } else {
      exactBlocker = paperDecision.blockedReason ? "NO_BLUEPRINT_STRATEGY_MATCH" : best.reasonCode;
      actualValue = paperDecision.blockedReason ?? best.reasonText;
    }
  }

  const blockerDetail =
    exactBlocker === "MAX_OPEN_TRADES_OR_EXPOSURE"
      ? `Capacity full — ${input.openTradesCount} open, ${input.availableSlots} slots available.`
      : exactBlocker === "NO_BLUEPRINT_STRATEGY_MATCH" && paperDecision
      ? paperDecision.blockedReason ?? blueprintStrategyMatchDebug?.finalReason ?? "No blueprint strategy matched."
      : exactBlocker === "CAUTION_MODE"
        ? "Score passed, but blocked by caution mode."
        : exactBlocker === "CONFIDENCE_OR_FILTER" && best
          ? resolveCandidateBlockReason({
              score: best.opportunityScore,
              tier: best.riskTier,
              reasonCode: best.reasonCode,
              reasonText: best.reasonText,
              recordCaution: input.recordCaution,
            })
          : exactBlocker === "BAD_RISK_REWARD"
            ? "Score passed, but reward/risk too weak."
            : best
              ? resolveCandidateBlockReason({
                  score: best.opportunityScore,
                  tier: best.riskTier,
                  reasonCode: best.reasonCode,
                  reasonText: best.reasonText,
                  recordCaution: input.recordCaution,
                })
              : "blocked";

  const pipelineLine =
    `Discovered ${pipelineCounts.discovered}, evaluated ${pipelineCounts.evaluated}, ranked ${pipelineCounts.ranked}, ` +
    `failed filters ${pipelineCounts.failedFilters}, A+ ${pipelineCounts.aPlusMatches}, A ${pipelineCounts.aMatches}, ` +
    `B near-miss ${pipelineCounts.bNearMisses}, C watch-only ${pipelineCounts.cWatchOnly}, rejected ${pipelineCounts.rejected}.`;

  const finalReason = best
    ? `${pipelineLine} Best ${best.symbol} (${best.opportunityScore.toFixed(0)}) — closest ${closestStrategy ?? "none"} — ${blockerDetail}`
    : `No trade opened — ${pipelineLine}`;

  return {
    finalReason,
    bestCandidate: best
      ? {
          symbol: best.symbol,
          score: best.opportunityScore,
          strategy: mapStrategyForCandidate(best, blueprintStrategyMatchDebug ?? undefined).strategyName,
          status: best.action,
          reasonCode: best.reasonCode,
          reasonText: blockerDetail,
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
      failedFilters: Math.min(failedCandidates, totalRanked),
      watchlistOnly,
      qualifiedButBlocked: pipelineCounts.bNearMisses + pipelineCounts.cWatchOnly,
      selectedTradeCandidate: best?.symbol ?? null,
    },
    pipelineCounts,
    blueprintStrategyMatchDebug,
    closestStrategy,
    passedConditions,
    failedConditions,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
