import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { minScoreForTier } from "@/lib/trading/paper/trade-selection";
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

export interface BlueprintStrategyCheck {
  strategyId: string;
  strategyName: string;
  passed: boolean;
  verdict: StrategyVerdict;
  missingConditions: string[];
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface BlueprintStrategyMatchDebug {
  checkedStrategies: string[];
  vwapReclaimMomentum: BlueprintStrategyCheck;
  volatilityCompressionBreakout: BlueprintStrategyCheck;
  trendPullbackContinuation: BlueprintStrategyCheck;
  bestMatchStrategy: string | null;
  missingConditions: string[];
  finalDecision: StrategyVerdict;
  finalReason: string;
  paperModeSuggestion: "TRADE_ALLOWED" | "WATCH_ONLY" | "TINY_B_SETUP";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

const STRATEGIES: StrategyDefinition[] = [
  VWAP_RECLAIM_MOMENTUM,
  VOLATILITY_COMPRESSION_BREAKOUT,
  TREND_PULLBACK_CONTINUATION,
];

function minStrategyScore(strategy: StrategyDefinition): number {
  if (strategy.id === "volatility-compression-breakout") return 68;
  if (strategy.id === "vwap-reclaim-momentum") return 65;
  return 62;
}

function checkVwapReclaimMomentum(candidate: ScanCandidate): BlueprintStrategyCheck {
  const mom = candidate.momentumScore ?? 0;
  const shortRet = candidate.shortTermReturnPct ?? 0;
  const score = candidate.opportunityScore;
  const minScore = minStrategyScore(VWAP_RECLAIM_MOMENTUM);
  const missing: string[] = [];

  if (mom < 60) missing.push(`momentumScore ${mom.toFixed(0)}/60`);
  if (shortRet <= 0.2) missing.push(`shortTermReturn ${shortRet.toFixed(2)}% <= 0.2%`);
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");

  const passed = missing.length === 0;
  return {
    strategyId: VWAP_RECLAIM_MOMENTUM.id,
    strategyName: VWAP_RECLAIM_MOMENTUM.name,
    passed,
    verdict: passed ? "TRADE_ALLOWED" : score >= minScoreForTier(candidate.riskTier) ? "WATCH_ONLY" : "RESEARCH_ONLY",
    missingConditions: missing,
    summary: passed
      ? "PASS — VWAP reclaim momentum setup confirmed"
      : `FAIL — ${missing[0] ?? "conditions not met"}`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function checkVolatilityCompressionBreakout(candidate: ScanCandidate): BlueprintStrategyCheck {
  const breakout = candidate.breakoutScore ?? 0;
  const vol = candidate.volatilityScore ?? 0;
  const change = Math.abs(candidate.change24hPct ?? 0);
  const score = candidate.opportunityScore;
  const minScore = minStrategyScore(VOLATILITY_COMPRESSION_BREAKOUT);
  const missing: string[] = [];

  if (breakout < 65) missing.push(`breakoutScore ${breakout.toFixed(0)}/65`);
  if (vol < 55) missing.push(`volatilityScore ${vol.toFixed(0)}/55`);
  if (change < 3) missing.push(`24h move ${change.toFixed(1)}% < 3%`);
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");

  const passed = missing.length === 0;
  return {
    strategyId: VOLATILITY_COMPRESSION_BREAKOUT.id,
    strategyName: VOLATILITY_COMPRESSION_BREAKOUT.name,
    passed,
    verdict: passed ? "TRADE_ALLOWED" : score >= minScoreForTier(candidate.riskTier) ? "WATCH_ONLY" : "RESEARCH_ONLY",
    missingConditions: missing,
    summary: passed
      ? "PASS — compression breakout setup confirmed"
      : `FAIL — ${missing[0] ?? "conditions not met"}`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function checkTrendPullbackContinuation(candidate: ScanCandidate): BlueprintStrategyCheck {
  const trend = candidate.trendScore ?? 0;
  const mom = candidate.momentumScore ?? 0;
  const score = candidate.opportunityScore;
  const minScore = minStrategyScore(TREND_PULLBACK_CONTINUATION);
  const missing: string[] = [];

  const trendPullback = trend >= 55 && mom >= 45;
  const highScoreFallback = score >= 70;
  if (!trendPullback && !highScoreFallback) {
    if (trend < 55) missing.push(`trendScore ${trend.toFixed(0)}/55`);
    if (mom < 45) missing.push(`momentumScore ${mom.toFixed(0)}/45`);
    if (score < 70) missing.push(`opportunityScore ${score.toFixed(0)} < 70 fallback threshold`);
  }
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");

  const passed = missing.length === 0;
  return {
    strategyId: TREND_PULLBACK_CONTINUATION.id,
    strategyName: TREND_PULLBACK_CONTINUATION.name,
    passed,
    verdict: passed ? "TRADE_ALLOWED" : score >= minScoreForTier(candidate.riskTier) ? "WATCH_ONLY" : "RESEARCH_ONLY",
    missingConditions: missing,
    summary: passed
      ? "PASS — trend pullback continuation setup confirmed"
      : `FAIL — ${missing[0] ?? "conditions not met"}`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function pickStrategyDefinition(candidate: ScanCandidate): StrategyDefinition {
  const mom = candidate.momentumScore ?? 0;
  const vol = candidate.volatilityScore ?? 0;
  const trend = candidate.trendScore ?? 0;
  const breakout = candidate.breakoutScore ?? 0;
  const change = Math.abs(candidate.change24hPct ?? 0);

  if (breakout >= 65 && vol >= 55 && change >= 3) return VOLATILITY_COMPRESSION_BREAKOUT;
  if (mom >= 60 && candidate.shortTermReturnPct > 0.2) return VWAP_RECLAIM_MOMENTUM;
  if (trend >= 55 && mom >= 45) return TREND_PULLBACK_CONTINUATION;
  return TREND_PULLBACK_CONTINUATION;
}

export function evaluateAllBlueprintStrategies(candidate: ScanCandidate): BlueprintStrategyMatchDebug {
  const vwap = checkVwapReclaimMomentum(candidate);
  const volBreakout = checkVolatilityCompressionBreakout(candidate);
  const trendPullback = checkTrendPullbackContinuation(candidate);
  const checks = [vwap, volBreakout, trendPullback];
  const passedCheck = checks.find((c) => c.passed) ?? null;
  const chosen = passedCheck
    ? STRATEGIES.find((s) => s.id === passedCheck.strategyId) ?? pickStrategyDefinition(candidate)
    : pickStrategyDefinition(candidate);

  let finalDecision: StrategyVerdict = "RESEARCH_ONLY";
  if (passedCheck) {
    finalDecision = "TRADE_ALLOWED";
  } else if (candidate.opportunityScore >= minScoreForTier(candidate.riskTier)) {
    finalDecision = "WATCH_ONLY";
  }

  const allMissing = [...new Set(checks.flatMap((c) => c.missingConditions))];
  let paperModeSuggestion: BlueprintStrategyMatchDebug["paperModeSuggestion"] = "WATCH_ONLY";
  if (finalDecision === "TRADE_ALLOWED") {
    paperModeSuggestion = "TRADE_ALLOWED";
  } else if (
    candidate.opportunityScore >= minScoreForTier(candidate.riskTier) + 5 &&
    candidate.opportunityScore >= 68 &&
    checks.some((c) => !c.passed && c.missingConditions.length <= 3)
  ) {
    paperModeSuggestion = "TINY_B_SETUP";
  }

  const closestFail = [...checks].sort((a, b) => a.missingConditions.length - b.missingConditions.length)[0];
  const finalReason = passedCheck
    ? `${passedCheck.strategyName} matched — trade allowed in paper mode.`
    : closestFail
      ? `${closestFail.strategyName} failed because ${closestFail.missingConditions[0] ?? "conditions not met"}.`
      : "Score and blueprint conditions not met — research only.";

  return {
    checkedStrategies: STRATEGIES.map((s) => s.name),
    vwapReclaimMomentum: vwap,
    volatilityCompressionBreakout: volBreakout,
    trendPullbackContinuation: trendPullback,
    bestMatchStrategy: passedCheck?.strategyName ?? chosen.name,
    missingConditions: allMissing,
    finalDecision,
    finalReason,
    paperModeSuggestion,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function formatBlueprintStrategyMatchDebugLines(debug: BlueprintStrategyMatchDebug): string[] {
  const fmtCheck = (check: BlueprintStrategyCheck) =>
    `${check.strategyName}: ${check.passed ? "PASS" : "FAIL"} — ${check.summary}${
      check.missingConditions.length ? ` | missing: ${check.missingConditions.join("; ")}` : ""
    }`;

  return [
    fmtCheck(debug.vwapReclaimMomentum),
    fmtCheck(debug.volatilityCompressionBreakout),
    fmtCheck(debug.trendPullbackContinuation),
    `Best match: ${debug.bestMatchStrategy ?? "none"}`,
    `Missing conditions: ${debug.missingConditions.length ? debug.missingConditions.join("; ") : "none"}`,
    `Final decision: ${debug.finalDecision}`,
    `Paper mode suggestion: ${debug.paperModeSuggestion}`,
    debug.finalReason,
  ];
}

export function mapStrategyForCandidate(
  candidate: ScanCandidate,
  blueprint?: BlueprintStrategyMatchDebug,
): StrategyMappingResult {
  const debug = blueprint ?? evaluateAllBlueprintStrategies(candidate);
  const chosen =
    STRATEGIES.find((s) => s.name === debug.bestMatchStrategy) ?? pickStrategyDefinition(candidate);
  const passedCheck =
    debug.vwapReclaimMomentum.passed ||
    debug.volatilityCompressionBreakout.passed ||
    debug.trendPullbackContinuation.passed;

  let whyNow = "Trend-aligned pullback with continuation signals";
  if (chosen.id === VOLATILITY_COMPRESSION_BREAKOUT.id) {
    whyNow = "Compression breakout with volume expansion";
  } else if (chosen.id === VWAP_RECLAIM_MOMENTUM.id) {
    whyNow = "VWAP reclaim momentum with volume confirmation";
  } else if ((candidate.trendScore ?? 0) >= 55 && (candidate.momentumScore ?? 0) >= 45) {
    whyNow = "Intraday trend pullback holding support";
  } else if (candidate.opportunityScore >= 70) {
    whyNow = "Highest-score fallback mapped to trend continuation rules";
  }

  const verdict: StrategyVerdict = passedCheck
    ? "TRADE_ALLOWED"
    : candidate.opportunityScore >= minScoreForTier(candidate.riskTier)
      ? "WATCH_ONLY"
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

export function blockIfNoBlueprintStrategy(candidate: ScanCandidate): {
  blocked: boolean;
  mapping: StrategyMappingResult;
  debug: BlueprintStrategyMatchDebug;
} {
  const debug = evaluateAllBlueprintStrategies(candidate);
  const mapping = mapStrategyForCandidate(candidate, debug);
  const blocked = !(
    debug.vwapReclaimMomentum.passed ||
    debug.volatilityCompressionBreakout.passed ||
    debug.trendPullbackContinuation.passed
  );
  return {
    blocked,
    mapping,
    debug,
  };
}

export const BLUEPRINT_STRATEGY_NAMES = STRATEGIES.map((s) => s.name);
