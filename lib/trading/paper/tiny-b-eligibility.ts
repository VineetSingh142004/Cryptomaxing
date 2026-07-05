import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  evaluateAllBlueprintStrategies,
  type BlueprintStrategyCheck,
} from "@/lib/trading/paper/strategy-mapping";
import { evaluatePaperDecision } from "@/lib/trading/paper/paper-decision-pipeline";
import { minScoreForTier } from "@/lib/trading/paper/trade-selection";

export interface TinyBNearMiss {
  symbol: string;
  opportunityScore: number;
  closestStrategy: string;
  missingConditions: string[];
  missingCount: number;
  criticalMissing: string[];
  exactBlocker: string;
  tinyBAllowed: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface TinyBEligibilityReport {
  bNearMissCount: number;
  nearMisses: TinyBNearMiss[];
  tinyBAllowedThisRun: boolean;
  exactBlockerSummary: string | null;
  message: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

const CRITICAL_KEYWORDS = [
  "not confirmed tradable",
  "not tradable",
  "volume",
  "spread",
  "fake",
  "pump",
];

function isCritical(condition: string): boolean {
  const lower = condition.toLowerCase();
  return CRITICAL_KEYWORDS.some((k) => lower.includes(k));
}

function isNearMissCheck(check: BlueprintStrategyCheck, candidate: ScanCandidate): boolean {
  if (check.passed) return false;
  if (check.missingConditions.length === 0 || check.missingConditions.length > 3) return false;
  return !check.missingConditions.some(isCritical);
}

export function buildTinyBEligibilityReport(input: {
  ranked: ScanCandidate[];
  tradesOpenedThisRun: number;
}): TinyBEligibilityReport {
  const eligibleCandidates = input.ranked.filter((c) => {
    const baseMin = minScoreForTier(c.riskTier);
    if (c.opportunityScore < baseMin) return false;
    const debug = evaluateAllBlueprintStrategies(c);
    const checks = [
      debug.vwapReclaimMomentum,
      debug.volatilityCompressionBreakout,
      debug.trendPullbackContinuation,
    ];
    return checks.some((check) => isNearMissCheck(check, c));
  });

  const nearMisses: TinyBNearMiss[] = eligibleCandidates.slice(0, 10).map((c) => {
    const debug = evaluateAllBlueprintStrategies(c);
    const decision = evaluatePaperDecision(c);
    const checks = [
      debug.vwapReclaimMomentum,
      debug.volatilityCompressionBreakout,
      debug.trendPullbackContinuation,
    ];
    const closest =
      [...checks].sort((a, b) => a.missingConditions.length - b.missingConditions.length)[0] ??
      checks[0];
    const criticalMissing = closest.missingConditions.filter(isCritical);
    const tinyBAllowed = decision.decision === "TINY_B_SETUP_PAPER_ONLY";

    return {
      symbol: c.symbol,
      opportunityScore: c.opportunityScore,
      closestStrategy: closest.strategyName,
      missingConditions: closest.missingConditions,
      missingCount: closest.missingConditions.length,
      criticalMissing,
      exactBlocker:
        decision.blockedReason ??
        closest.missingConditions[0] ??
        "blueprint conditions not met",
      tinyBAllowed,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  });

  const tinyBAllowedThisRun =
    input.tradesOpenedThisRun === 0 &&
    nearMisses.some((n) => n.tinyBAllowed);

  let message: string;
  if (nearMisses.length === 0) {
    message =
      "No B near-miss found — market weak or feature scores too low. Tiny B paper-only not eligible.";
  } else if (tinyBAllowedThisRun) {
    message = `Tiny B paper-only eligible for ${nearMisses.filter((n) => n.tinyBAllowed).length} near-miss candidate(s) — reduced size, strict stop, no live, no Auto.`;
  } else {
    message = `${nearMisses.length} near-miss candidate(s) found but tiny B not allowed — see exact blockers.`;
  }

  return {
    bNearMissCount: nearMisses.length,
    nearMisses,
    tinyBAllowedThisRun,
    exactBlockerSummary: nearMisses[0]?.exactBlocker ?? null,
    message,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
