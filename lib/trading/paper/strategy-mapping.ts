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

  if (mom < 60) missing.push(`momentumScore ${mom.toFixed(0)} < 60`);
  if (shortRet <= 0.2) missing.push(`shortTermReturnPct ${shortRet.toFixed(2)}% <= 0.2%`);
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");
  if (candidate.action !== "OPEN_TRADE") missing.push(`action ${candidate.action} (needs OPEN_TRADE)`);

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

  if (breakout < 65) missing.push(`breakoutScore ${breakout.toFixed(0)} < 65`);
  if (vol < 55) missing.push(`volatilityScore ${vol.toFixed(0)} < 55`);
  if (change < 3) missing.push(`24h move ${change.toFixed(1)}% < 3%`);
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");
  if (candidate.action !== "OPEN_TRADE") missing.push(`action ${candidate.action} (needs OPEN_TRADE)`);

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
  const highScoreFallback = score >= 70 && candidate.action === "OPEN_TRADE";
  if (!trendPullback && !highScoreFallback) {
    if (trend < 55) missing.push(`trendScore ${trend.toFixed(0)} < 55`);
    if (mom < 45) missing.push(`momentumScore ${mom.toFixed(0)} < 45`);
    if (score < 70) missing.push(`opportunityScore ${score.toFixed(0)} < 70 fallback threshold`);
  }
  if (score < minScore) missing.push(`opportunityScore ${score.toFixed(0)} < ${minScore}`);
  if (!candidate.tradableOnConfiguredExchange) missing.push("not confirmed tradable on exchange");
  if (candidate.action !== "OPEN_TRADE") missing.push(`action ${candidate.action} (needs OPEN_TRADE)`);

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

export function evaluateAllBlueprintStrategies(candidate: ScanCandidate): BlueprintStrategyMatchDebug {
  const vwap = checkVwapReclaimMomentum(candidate);
  const volBreakout = checkVolatilityCompressionBreakout(candidate);
  const trendPullback = checkTrendPullbackContinuation(candidate);
  const checks = [vwap, volBreakout, trendPullback];
  const passedCheck = checks.find((c) => c.passed) ?? null;
  const mapping = mapStrategyForCandidate(candidate);

  let finalDecision: StrategyVerdict = mapping.verdict;
  if (passedCheck) {
    finalDecision = "TRADE_ALLOWED";
  } else if (candidate.opportunityScore >= minScoreForTier(candidate.riskTier)) {
    finalDecision = "WATCH_ONLY";
  } else {
    finalDecision = "RESEARCH_ONLY";
  }

  const allMissing = [...new Set(checks.flatMap((c) => c.missingConditions))];
  let paperModeSuggestion: BlueprintStrategyMatchDebug["paperModeSuggestion"] = "WATCH_ONLY";
  if (finalDecision === "TRADE_ALLOWED") {
    paperModeSuggestion = "TRADE_ALLOWED";
  } else if (
    candidate.opportunityScore >= minScoreForTier(candidate.riskTier) + 5 &&
    candidate.opportunityScore >= 68
  ) {
    paperModeSuggestion = "TINY_B_SETUP";
  }

  const finalReason = passedCheck
    ? `${passedCheck.strategyName} matched — trade allowed in paper mode.`
    : candidate.opportunityScore >= minScoreForTier(candidate.riskTier)
      ? `Score passed tier threshold but no blueprint strategy matched — ${paperModeSuggestion === "TINY_B_SETUP" ? "consider tiny B paper setup" : "WATCH_ONLY in paper mode"}.`
      : "Score and blueprint conditions not met — research only.";

  return {
    checkedStrategies: STRATEGIES.map((s) => s.name),
    vwapReclaimMomentum: vwap,
    volatilityCompressionBreakout: volBreakout,
    trendPullbackContinuation: trendPullback,
    bestMatchStrategy: passedCheck?.strategyName ?? mapping.strategyName,
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

export function blockIfNoBlueprintStrategy(candidate: ScanCandidate): {
  blocked: boolean;
  mapping: StrategyMappingResult;
  debug: BlueprintStrategyMatchDebug;
} {
  const debug = evaluateAllBlueprintStrategies(candidate);
  const mapping = mapStrategyForCandidate(candidate);
  const blocked = debug.finalDecision !== "TRADE_ALLOWED";
  return {
    blocked,
    mapping,
    debug,
  };
}

export const BLUEPRINT_STRATEGY_NAMES = STRATEGIES.map((s) => s.name);
