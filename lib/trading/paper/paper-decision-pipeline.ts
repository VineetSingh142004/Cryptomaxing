import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { SCANNER_CONFIG, maxSpreadForTier } from "@/lib/trading/paper/scanner-config";
import type { RecordCautionModeState } from "@/lib/trading/paper/profit-protection";
import { minScoreForTier } from "@/lib/trading/paper/trade-selection";
import {
  evaluateAllBlueprintStrategies,
  mapStrategyForCandidate,
  type BlueprintStrategyCheck,
  type BlueprintStrategyMatchDebug,
} from "@/lib/trading/paper/strategy-mapping";

export type PaperTradeDecision =
  | "OPEN_PAPER_TRADE"
  | "TINY_B_SETUP_PAPER_ONLY"
  | "WATCH_ONLY"
  | "RESEARCH_ONLY"
  | "REJECT";

export type SetupTier = "A+" | "A" | "B" | "C" | "REJECTED";

const HARD_SAFETY_REASON_CODES = new Set([
  "NOT_TRADABLE_ON_EXCHANGE",
  "EXCHANGE_AVAILABILITY_UNKNOWN",
  "VOLUME_TOO_LOW",
  "SPREAD_TOO_WIDE",
  "LIQUIDITY_TOO_LOW",
  "REJECTED_BAD_RISK_REWARD",
  "RISK_REWARD_TOO_WEAK",
  "REJECTED_FAKE_PUMP_RISK",
  "PUMP_RISK_TOO_HIGH",
  "WATCH_ONLY_FAKE_PUMP_RISK",
  "MARKET_DATA_FAILED",
  "DATA_STALE",
  "OHLC_MISSING",
]);

const CRITICAL_MISSING_KEYWORDS = [
  "not confirmed tradable",
  "volume",
  "spread",
  "fake",
  "pump",
  "data stale",
  "ohlc",
  "r:r",
  "risk/reward",
];

export interface PaperDecisionResult {
  decision: PaperTradeDecision;
  setupTier: SetupTier;
  blueprint: BlueprintStrategyMatchDebug;
  closestStrategy: string | null;
  passedConditions: string[];
  failedConditions: string[];
  blockedReason: string | null;
  allocationMultiplier: number;
  mapping: ReturnType<typeof mapStrategyForCandidate>;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface PipelineSummaryCounts {
  discovered: number;
  evaluated: number;
  ranked: number;
  failedFilters: number;
  aPlusMatches: number;
  aMatches: number;
  bNearMisses: number;
  cWatchOnly: number;
  rejected: number;
}

export function passedHardSafetyFilters(candidate: ScanCandidate): boolean {
  if (!candidate.tradableOnConfiguredExchange) return false;
  if (HARD_SAFETY_REASON_CODES.has(String(candidate.reasonCode).toUpperCase())) return false;
  if ((candidate.volume24hUsd ?? 0) < SCANNER_CONFIG.min24hVolumeUsd) return false;
  if ((candidate.spreadBps ?? 999) > maxSpreadForTier(candidate.riskTier)) return false;
  if ((candidate.pumpRiskPenalty ?? 0) >= 40) return false;
  if ((candidate.dataQualityScore ?? 0) < 40) return false;
  return true;
}

function passedTradeQuality(candidate: ScanCandidate, recordCaution?: RecordCautionModeState): boolean {
  const baseMin = minScoreForTier(candidate.riskTier);
  const effectiveMin = baseMin + (recordCaution?.active ? recordCaution.minScoreBoost : 0);
  if (candidate.opportunityScore < baseMin) return false;
  if (recordCaution?.active && candidate.opportunityScore < effectiveMin) return false;
  if (candidate.scoreBreakdown.confidenceLevel === "LOW") return false;
  if (
    candidate.reasonCode === "REJECTED_BAD_RISK_REWARD" ||
    candidate.reasonCode === "RISK_REWARD_TOO_WEAK"
  ) {
    return false;
  }
  return true;
}

function isCriticalMissing(condition: string): boolean {
  const lower = condition.toLowerCase();
  return CRITICAL_MISSING_KEYWORDS.some((k) => lower.includes(k));
}

function nearMissStrategy(check: BlueprintStrategyCheck): boolean {
  if (check.passed) return false;
  if (check.missingConditions.length === 0 || check.missingConditions.length > 3) return false;
  return !check.missingConditions.some(isCriticalMissing);
}

function closestStrategyCheck(checks: BlueprintStrategyCheck[]): BlueprintStrategyCheck | null {
  return (
    [...checks].sort((a, b) => a.missingConditions.length - b.missingConditions.length)[0] ?? null
  );
}

function formatStrategyFailure(check: BlueprintStrategyCheck): string {
  const missing = check.missingConditions[0] ?? "conditions not met";
  return `${check.strategyName} failed because ${missing}.`;
}

export function evaluatePaperDecision(
  candidate: ScanCandidate,
  options?: { recordCaution?: RecordCautionModeState },
): PaperDecisionResult {
  const blueprint = evaluateAllBlueprintStrategies(candidate);
  const mapping = mapStrategyForCandidate(candidate, blueprint);
  const checks = [
    blueprint.vwapReclaimMomentum,
    blueprint.volatilityCompressionBreakout,
    blueprint.trendPullbackContinuation,
  ];
  const passedCheck = checks.find((c) => c.passed) ?? null;
  const closest = closestStrategyCheck(checks);
  const baseMin = minScoreForTier(candidate.riskTier);

  const passedConditions: string[] = [];
  const failedConditions: string[] = [];

  if (candidate.tradableOnConfiguredExchange) passedConditions.push("exchange tradable");
  else failedConditions.push("not tradable on configured exchange");

  if ((candidate.volume24hUsd ?? 0) >= SCANNER_CONFIG.min24hVolumeUsd) {
    passedConditions.push(`volume $${(candidate.volume24hUsd ?? 0).toFixed(0)}`);
  } else {
    failedConditions.push(`volume $${(candidate.volume24hUsd ?? 0).toFixed(0)} below minimum`);
  }

  if (candidate.opportunityScore >= baseMin) {
    passedConditions.push(`score ${candidate.opportunityScore.toFixed(0)} >= ${baseMin}`);
  } else {
    failedConditions.push(`score ${candidate.opportunityScore.toFixed(0)} < ${baseMin}`);
  }

  if (passedCheck) {
    passedConditions.push(`${passedCheck.strategyName} blueprint match`);
  } else if (closest) {
    failedConditions.push(formatStrategyFailure(closest));
  }

  let setupTier: SetupTier = "REJECTED";
  let decision: PaperTradeDecision = "REJECT";
  let blockedReason: string | null = null;
  let allocationMultiplier = 1;

  if (!passedHardSafetyFilters(candidate)) {
    decision = "REJECT";
    setupTier = "REJECTED";
    blockedReason = candidate.reasonText || candidate.reasonCode || "hard safety filter failed";
  } else if (options?.recordCaution?.pauseNewEntries) {
    decision = "REJECT";
    setupTier = "REJECTED";
    blockedReason = options.recordCaution.dashboardMessage;
  } else if (passedCheck && passedTradeQuality(candidate, options?.recordCaution)) {
    decision = "OPEN_PAPER_TRADE";
    setupTier = passedCheck.passed && candidate.opportunityScore >= baseMin + 10 ? "A+" : "A";
    allocationMultiplier = options?.recordCaution?.active
      ? (options.recordCaution.allocationMultiplier ?? 1)
      : 1;
  } else if (
    passedHardSafetyFilters(candidate) &&
    passedTradeQuality(candidate, options?.recordCaution) &&
    checks.some(nearMissStrategy) &&
    candidate.opportunityScore >= baseMin
  ) {
    decision = "TINY_B_SETUP_PAPER_ONLY";
    setupTier = "B";
    allocationMultiplier = Math.min(
      0.35,
      (options?.recordCaution?.active ? options.recordCaution.allocationMultiplier ?? 0.5 : 0.35),
    );
    blockedReason = closest ? formatStrategyFailure(closest) : "near-miss blueprint setup";
  } else if (candidate.opportunityScore >= baseMin) {
    decision = "WATCH_ONLY";
    setupTier = "C";
    blockedReason = closest
      ? formatStrategyFailure(closest)
      : blueprint.finalReason;
  } else {
    decision = "RESEARCH_ONLY";
    setupTier = "REJECTED";
    blockedReason = closest
      ? formatStrategyFailure(closest)
      : candidate.reasonText || "score below tier threshold";
  }

  return {
    decision,
    setupTier,
    blueprint,
    closestStrategy: passedCheck?.strategyName ?? closest?.strategyName ?? null,
    passedConditions,
    failedConditions,
    blockedReason,
    allocationMultiplier,
    mapping,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function summarizePipelineCounts(
  ranked: ScanCandidate[],
  options?: { recordCaution?: RecordCautionModeState; discovered?: number; evaluated?: number },
): PipelineSummaryCounts {
  const decisions = ranked.map((c) => evaluatePaperDecision(c, options));
  return {
    discovered: options?.discovered ?? ranked.length,
    evaluated: options?.evaluated ?? ranked.length,
    ranked: ranked.length,
    failedFilters: ranked.filter((c) => !passedHardSafetyFilters(c)).length,
    aPlusMatches: decisions.filter((d) => d.setupTier === "A+").length,
    aMatches: decisions.filter((d) => d.setupTier === "A").length,
    bNearMisses: decisions.filter((d) => d.setupTier === "B").length,
    cWatchOnly: decisions.filter((d) => d.setupTier === "C").length,
    rejected: decisions.filter((d) => d.decision === "REJECT" || d.decision === "RESEARCH_ONLY").length,
  };
}

export function canOpenPaperTrade(decision: PaperTradeDecision): boolean {
  return decision === "OPEN_PAPER_TRADE" || decision === "TINY_B_SETUP_PAPER_ONLY";
}
