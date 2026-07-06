import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { PipelineSummaryCounts } from "@/lib/trading/paper/paper-decision-pipeline";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { buildFeatureScoreHealth, type FeatureScoreHealth } from "@/lib/trading/paper/feature-score-health";
import { buildStrategyFormulaHealth, type StrategyFormulaHealth } from "@/lib/trading/paper/strategy-formula-health";
import { resolveBotWorkingVerdict, type BotWorkingVerdict } from "@/lib/trading/paper/bot-diagnostic-verdict";
import {
  buildThresholdCalibrationReport,
  type ThresholdCalibrationReport,
} from "@/lib/trading/paper/threshold-calibration";
import { buildShadowReplayReport, type ShadowReplayReport } from "@/lib/trading/paper/shadow-replay-diagnostics";
import { buildTinyBEligibilityReport, type TinyBEligibilityReport } from "@/lib/trading/paper/tiny-b-eligibility";
import { evaluatePaperDecision } from "@/lib/trading/paper/paper-decision-pipeline";

export interface PaperRunDiagnostics {
  botWorkingVerdict: BotWorkingVerdict;
  featureScoreHealth: FeatureScoreHealth;
  strategyFormulaHealth: StrategyFormulaHealth;
  badMarketVsBrokenBot: BotWorkingVerdict["badMarketVsBrokenBot"];
  thresholdCalibration: ThresholdCalibrationReport;
  shadowReplay: ShadowReplayReport;
  tinyBEligibility: TinyBEligibilityReport;
  safetyLocks: ReturnType<typeof verifyPaperSafetyGates>;
  generatedAt: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function buildPaperRunDiagnostics(input: {
  ranked: ScanCandidate[];
  pipelineCounts: PipelineSummaryCounts;
  tradesOpenedThisRun: number;
  providerSource?: string;
  marketDataStatus?: string;
  timestamp?: string;
  followUpPrices?: Map<string, number>;
  tinyBExecution?: import("@/lib/trading/paper/tiny-b-execution").TinyBExecutionSummary;
}): PaperRunDiagnostics {
  const best = [...input.ranked].sort((a, b) => b.opportunityScore - a.opportunityScore)[0] ?? null;
  const featureScoreHealth = buildFeatureScoreHealth({
    ranked: input.ranked,
    providerSource: input.providerSource,
  });
  const strategyFormulaHealth = buildStrategyFormulaHealth({
    ranked: input.ranked,
    bestCandidate: best,
  });
  const thresholdCalibration = buildThresholdCalibrationReport(input.ranked);
  const tinyBEligibility = buildTinyBEligibilityReport({
    ranked: input.ranked,
    tradesOpenedThisRun: input.tradesOpenedThisRun,
  });

  const hasOpenableDecision =
    best != null &&
    evaluatePaperDecision(best).decision === "OPEN_PAPER_TRADE";
  const hasTinyBDecision =
    (best != null && evaluatePaperDecision(best).decision === "TINY_B_SETUP_PAPER_ONLY") ||
    (input.tinyBExecution?.tinyBEligibleCount ?? 0) > 0;

  let botWorkingVerdict = resolveBotWorkingVerdict({
    featureHealth: featureScoreHealth,
    pipelineCounts: input.pipelineCounts,
    tradesOpenedThisRun: input.tradesOpenedThisRun,
    bNearMissCount: tinyBEligibility.bNearMissCount,
    hasOpenableDecision,
    hasTinyBDecision: hasTinyBDecision && input.tradesOpenedThisRun === 0,
    marketDataStatus: input.marketDataStatus,
  });

  if (
    input.tinyBExecution &&
    input.tinyBExecution.tinyBEligibleCount > 0 &&
    input.tinyBExecution.tinyBOpenedCount === 0 &&
    input.tradesOpenedThisRun === 0
  ) {
    const blocker = input.tinyBExecution.blockers[0];
    const blockerText = blocker?.reasonText ?? input.tinyBExecution.executionNote;
    const blockerCode = blocker?.reasonCode ?? "TINY_B_BLOCKED_STRATEGY_LAYER";
    botWorkingVerdict = {
      status: blockerCode,
      headline:
        blockerCode === "TINY_B_BLOCKED_DUPLICATE_SYMBOL"
          ? "No new trade — symbol already open"
          : blockerCode === "TINY_B_BLOCKED_CAUTION_CRITICAL"
            ? "No new trade — caution mode active"
            : blockerCode === "TINY_B_BLOCKED_CAPACITY"
              ? "No new trade — open trade capacity reached"
              : blockerCode === "TINY_B_BLOCKED_STRATEGY_LAYER"
                ? "Tiny B eligible but strategy layer blocked"
                : "Tiny B eligible but not opened — see execution blocker",
      explanation:
        blockerText ??
        "Tiny B was eligible diagnostically but blocked at execution. Review tiny B execution summary.",
      badMarketVsBrokenBot: "TOO_STRICT",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (input.tinyBExecution?.tinyBOpenedCount && input.tinyBExecution.tinyBOpenedCount > 0) {
    botWorkingVerdict = {
      status: "PAPER_TINY_B_READY",
      headline: "Tiny B paper trade opened",
      explanation: input.tinyBExecution.executionNote ?? "Tiny B paper-only trade opened with reduced size.",
      badMarketVsBrokenBot: "READY",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  const shadowReplay = buildShadowReplayReport({
    ranked: input.ranked,
    timestamp: input.timestamp ?? new Date().toISOString(),
    followUpPrices: input.followUpPrices,
  });

  return {
    botWorkingVerdict,
    featureScoreHealth,
    strategyFormulaHealth,
    badMarketVsBrokenBot: botWorkingVerdict.badMarketVsBrokenBot,
    thresholdCalibration,
    shadowReplay,
    tinyBEligibility,
    safetyLocks: verifyPaperSafetyGates(),
    generatedAt: input.timestamp ?? new Date().toISOString(),
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function formatDiagnosticsExportLines(d: PaperRunDiagnostics): string[] {
  const fh = d.featureScoreHealth;
  const lines: string[] = [
    `Bot Working Verdict: ${d.botWorkingVerdict.status} — ${d.botWorkingVerdict.headline}`,
    d.botWorkingVerdict.explanation,
    `Bad market vs broken bot: ${d.badMarketVsBrokenBot}`,
    "",
    "Feature Score Health:",
    fh.summary,
    `  momentumScore max: ${fh.distributions.momentumScore.max.toFixed(1)} median: ${fh.distributions.momentumScore.median.toFixed(1)}`,
    `  trendScore max: ${fh.distributions.trendScore.max.toFixed(1)} — ${fh.zeroScoreExplanations.trendScore}`,
    `  breakoutScore max: ${fh.distributions.breakoutScore.max.toFixed(1)} — ${fh.zeroScoreExplanations.breakoutScore}`,
    `  candles loaded: ${fh.candlesLoaded ? "YES" : "NO"} (${(fh.candlesLoadedPct * 100).toFixed(0)}%) provider: ${fh.providerSource}`,
    `  warning flags: ${fh.warningFlags.join(", ") || "none"}`,
    "",
    "Strategy Formula Health:",
    d.strategyFormulaHealth.summary,
  ];

  for (const s of d.strategyFormulaHealth.strategies) {
    lines.push(
      `  ${s.strategyName}: ${s.pass ? "PASS" : "FAIL"} formula=${s.formulaStatus} source=${s.scoreSource} data=${s.dataAvailable ? "YES" : "NO"}`,
    );
    if (s.failReason) lines.push(`    fail: ${s.failReason}`);
    if (s.zeroScoreReason) lines.push(`    zero reason: ${s.zeroScoreReason}`);
  }

  lines.push(
    "",
    "Threshold Calibration (no auto-adjust):",
    d.thresholdCalibration.recommendation,
  );
  for (const row of d.thresholdCalibration.strategies) {
    lines.push(
      `  ${row.strategyName} ${row.feature}: threshold=${row.currentThreshold} top=${row.topCandidateValue.toFixed(1)} max=${row.maxValue.toFixed(1)} p90=${row.p90Value.toFixed(1)} — ${row.conclusion}`,
    );
  }

  lines.push(
    "",
    "Shadow Replay (NOT real trades):",
    d.shadowReplay.summary,
    d.shadowReplay.moneyProtectedNote,
    d.shadowReplay.missedOpportunityNote,
    `  money protected (blocked later lost): ${d.shadowReplay.blockedLaterLost}`,
    `  missed opportunity (blocked later won): ${d.shadowReplay.blockedLaterWon}`,
    `  filter precision: ${d.shadowReplay.filterPrecision !== null ? (d.shadowReplay.filterPrecision * 100).toFixed(0) + "%" : "pending"}`,
  );

  lines.push("", "Tiny B Eligibility:", d.tinyBEligibility.message);
  for (const n of d.tinyBEligibility.nearMisses.slice(0, 5)) {
    lines.push(
      `  ${n.symbol} score=${n.opportunityScore.toFixed(0)} missing=${n.missingCount} blocker=${n.exactBlocker}`,
    );
  }

  lines.push(
    "",
    "Safety Locks:",
    `  live trading: LOCKED`,
    `  Auto: ${d.safetyLocks.autoExecutionLocked ? "LOCKED" : "UNLOCKED"}`,
    `  P&L: SIMULATED`,
  );

  return lines;
}
