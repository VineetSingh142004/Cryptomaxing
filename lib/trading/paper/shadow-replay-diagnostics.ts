import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import {
  evaluateAllBlueprintStrategies,
  mapStrategyForCandidate,
} from "@/lib/trading/paper/strategy-mapping";
import { evaluatePaperDecision } from "@/lib/trading/paper/paper-decision-pipeline";

export interface ShadowReplayEntry {
  timestamp: string;
  symbol: string;
  priceAtDecision: number;
  reasonBlocked: string;
  closestStrategy: string;
  featuresAtDecision: {
    momentumScore: number;
    trendScore: number;
    breakoutScore: number;
    opportunityScore: number;
    shortTermReturnPct: number;
  };
  hypotheticalEntry: number;
  hypotheticalStop: number;
  hypotheticalTarget: number;
  priceAfter5m: number | null;
  priceAfter15m: number | null;
  priceAfter30m: number | null;
  priceAfter60m: number | null;
  outcome: "PENDING" | "WOULD_WIN" | "WOULD_LOSE" | "STOP_HIT" | "TARGET_HIT";
  blockProtectedMoney: boolean | null;
  missedOpportunity: boolean | null;
  isRealTrade: false;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface ShadowReplayReport {
  entries: ShadowReplayEntry[];
  blockedLaterLost: number;
  blockedLaterWon: number;
  falsePositiveBlocks: number;
  correctBlocks: number;
  missedWinners: number;
  filterPrecision: number | null;
  moneyProtectedNote: string;
  missedOpportunityNote: string;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function hypotheticalLevels(price: number): { entry: number; stop: number; target: number } {
  const stopPct = PAPER_CONFIG.stopLossBps / 10_000;
  const tpPct = PAPER_CONFIG.takeProfitBps / 10_000;
  return {
    entry: price,
    stop: price * (1 - stopPct),
    target: price * (1 + tpPct),
  };
}

function isBlockedCandidate(c: ScanCandidate): boolean {
  return c.action !== "OPEN_TRADE" && c.actionType !== "OPEN_PAPER_TRADE";
}

export function extractTopBlockedCandidates(ranked: ScanCandidate[], limit = 10): ScanCandidate[] {
  return [...ranked]
    .filter(isBlockedCandidate)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);
}

export function buildShadowReplayEntry(
  candidate: ScanCandidate,
  timestamp: string,
  followUpPrice?: number | null,
): ShadowReplayEntry {
  const debug = evaluateAllBlueprintStrategies(candidate);
  const decision = evaluatePaperDecision(candidate);
  const mapping = mapStrategyForCandidate(candidate, debug);
  const levels = hypotheticalLevels(candidate.price);
  const reasonBlocked =
    decision.blockedReason ??
    debug.finalReason ??
    candidate.reasonText ??
    candidate.reasonCode ??
    "blocked";

  let outcome: ShadowReplayEntry["outcome"] = "PENDING";
  let blockProtectedMoney: boolean | null = null;
  let missedOpportunity: boolean | null = null;

  if (followUpPrice != null && followUpPrice > 0) {
    if (followUpPrice <= levels.stop) {
      outcome = "STOP_HIT";
      blockProtectedMoney = true;
      missedOpportunity = false;
    } else if (followUpPrice >= levels.target) {
      outcome = "TARGET_HIT";
      blockProtectedMoney = false;
      missedOpportunity = true;
    } else if (followUpPrice > candidate.price) {
      outcome = "WOULD_WIN";
      missedOpportunity = true;
      blockProtectedMoney = false;
    } else {
      outcome = "WOULD_LOSE";
      blockProtectedMoney = true;
      missedOpportunity = false;
    }
  }

  return {
    timestamp,
    symbol: candidate.symbol,
    priceAtDecision: candidate.price,
    reasonBlocked: reasonBlocked,
    closestStrategy: mapping.strategyName,
    featuresAtDecision: {
      momentumScore: candidate.momentumScore ?? 0,
      trendScore: candidate.trendScore ?? 0,
      breakoutScore: candidate.breakoutScore ?? 0,
      opportunityScore: candidate.opportunityScore ?? 0,
      shortTermReturnPct: candidate.shortTermReturnPct ?? 0,
    },
    hypotheticalEntry: levels.entry,
    hypotheticalStop: levels.stop,
    hypotheticalTarget: levels.target,
    priceAfter5m: followUpPrice ?? null,
    priceAfter15m: null,
    priceAfter30m: null,
    priceAfter60m: null,
    outcome,
    blockProtectedMoney,
    missedOpportunity,
    isRealTrade: false,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildShadowReplayReport(input: {
  ranked: ScanCandidate[];
  timestamp: string;
  followUpPrices?: Map<string, number>;
}): ShadowReplayReport {
  const blocked = extractTopBlockedCandidates(input.ranked, 10);
  const entries = blocked.map((c) =>
    buildShadowReplayEntry(
      c,
      input.timestamp,
      input.followUpPrices?.get(c.symbol) ?? null,
    ),
  );

  const resolved = entries.filter((e) => e.outcome !== "PENDING");
  const blockedLaterLost = resolved.filter((e) => e.blockProtectedMoney === true).length;
  const blockedLaterWon = resolved.filter((e) => e.missedOpportunity === true).length;
  const correctBlocks = blockedLaterLost;
  const missedWinners = blockedLaterWon;
  const falsePositiveBlocks = resolved.filter(
    (e) => e.outcome === "TARGET_HIT" || e.outcome === "WOULD_WIN",
  ).length;
  const filterPrecision =
    resolved.length > 0 ? correctBlocks / resolved.length : null;

  return {
    entries,
    blockedLaterLost,
    blockedLaterWon,
    falsePositiveBlocks,
    correctBlocks,
    missedWinners,
    filterPrecision,
    moneyProtectedNote:
      "Money protected counts blocked candidates that later lost — NOT paper P&L or real profit.",
    missedOpportunityNote:
      "Missed opportunity counts blocked candidates that later won — diagnostic only, not simulated trade profit.",
    summary:
      entries.length === 0
        ? "No blocked candidates to shadow-track this run."
        : `Shadow tracking ${entries.length} blocked candidates — ${resolved.length} with follow-up price. NOT real trades.`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
