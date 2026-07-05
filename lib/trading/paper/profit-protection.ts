import type { PaperTrade as DbPaperTrade } from "@prisma/client";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { ScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { PaperPerformanceSummary } from "@/lib/trading/paper/performance-summary";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import { SCANNER_CONFIG, type RiskTier } from "@/lib/trading/paper/scanner-config";

export type StrategyDecision = "LONG" | "SHORT" | "NO_TRADE";

/** Cost drag estimate on paper exits (fees + slippage on large notionals). */
export const PAPER_COST_DRAG_FACTOR = 1.35;

export const MIN_REWARD_RISK_BY_TIER: Record<RiskTier, number> = {
  MAJOR: 1.2,
  ALT_LIQUID: 1.5,
  HIGH_VOLATILITY: 2.0,
  EXTREME_RISK: 2.5,
};

export interface RiskRewardEvaluation {
  passed: boolean;
  reasonCode: string;
  reasonText: string;
  stopDistancePct: number;
  takeProfitDistancePct: number;
  rewardRiskRatio: number;
  expectedUpsideUsd: number;
  expectedDownsideUsd: number;
  expectedValueUsd: number;
  minimumRequiredRatio: number;
  decisionReasoning: string[];
}

export interface FakePumpEvaluation {
  passed: boolean;
  watchOnly: boolean;
  reasonCode: string;
  reasonText: string;
  decisionReasoning: string[];
}

export interface RiskModeState {
  active: boolean;
  reasons: string[];
  dashboardLabel: "RISK_MODE_ACTIVE" | "NORMAL";
  dashboardMessage: string;
  performanceScope: "all_time" | "strategy_version" | "baseline";
  performanceScopeLabel: string;
}

export type RecordRiskModeLabel = "LOW" | "MEDIUM" | "HIGH" | "CAUTION_MODE" | "RISK_MODE_ACTIVE";

export interface RecordCautionModeState {
  active: boolean;
  mode: RecordRiskModeLabel;
  dashboardLabel: RecordRiskModeLabel;
  dashboardMessage: string;
  allocationMultiplier: number;
  minScoreBoost: number;
  blockHighVolAlts: boolean;
  reasons: string[];
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

/** Record-scoped caution after early losses — tighter filters until more closed trades. */
export function evaluateRecordCautionMode(
  summary: PaperPerformanceSummary,
  startingPaperBalance: number,
): RecordCautionModeState {
  const reasons: string[] = [];
  const largestLoss = Math.abs(summary.largestLoss ?? summary.averageLosingTrade ?? 0);
  const lossPctOfRecord =
    startingPaperBalance > 0 ? (largestLoss / startingPaperBalance) * 100 : 0;
  const firstLargeLoss =
    summary.totalClosedTrades < 5 &&
    summary.losses >= 1 &&
    summary.wins === 0 &&
    (lossPctOfRecord >= 0.4 || largestLoss >= startingPaperBalance * 0.004);

  if (firstLargeLoss) {
    reasons.push(
      `First closed trade lost ${largestLoss.toFixed(2)} SIM (${lossPctOfRecord.toFixed(2)}% of record start)`,
    );
  }
  if (summary.profitFactor === 0 && summary.losses >= 1) {
    reasons.push("Profit factor is 0 in current record");
  }
  if (summary.wins === 0 && summary.losses >= 1 && (summary.averageLosingTrade ?? 0) < 0) {
    reasons.push("No wins yet — average loss exceeds any average win");
  }

  const active = reasons.length > 0 && summary.totalClosedTrades < 5;

  if (active) {
    return {
      active: true,
      mode: "CAUTION_MODE",
      dashboardLabel: "CAUTION_MODE",
      dashboardMessage:
        "Caution mode active — current record started with a loss. Reducing size until more evidence exists.",
      allocationMultiplier: 0.5,
      minScoreBoost: 8,
      blockHighVolAlts: true,
      reasons,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (
    summary.profitFactor !== null &&
    summary.profitFactor < 1 &&
    summary.totalClosedTrades >= 1
  ) {
    return {
      active: true,
      mode: "RISK_MODE_ACTIVE",
      dashboardLabel: "RISK_MODE_ACTIVE",
      dashboardMessage:
        "Risk mode active — current record profit factor below 1. Blocking weaker setups.",
      allocationMultiplier: 0.65,
      minScoreBoost: 5,
      blockHighVolAlts: true,
      reasons: [`Profit factor ${summary.profitFactor.toFixed(2)} below 1.0 in current record`],
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  return {
    active: false,
    mode: "LOW",
    dashboardLabel: "LOW",
    dashboardMessage: "Normal record risk mode — no caution shield active yet.",
    allocationMultiplier: 1,
    minScoreBoost: 0,
    blockHighVolAlts: false,
    reasons: [],
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export interface ProfitQualitySummary {
  startingPaperBalance: number;
  currentPaperBalance: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  portfolioPnl: number;
  totalGrossProfit: number;
  totalGrossLoss: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  avgLossToWinRatio: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  maxDrawdown: number | null;
  currentExposurePct: number | null;
  capitalExposurePct: number | null;
  riskAtStopPct: number | null;
  riskMode: RiskModeState;
  profitQualityVerdict: string;
  healthStatus: "HEALTHY" | "UNHEALTHY" | "INSUFFICIENT_DATA";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface HistoryDiagnosticTrade {
  symbol: string;
  result: string;
  netPnl: number;
  reason: string;
  riskTier: RiskTier;
  opportunityScore: number | null;
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
  rewardRiskRatio: number | null;
  riskAmountUsd: number | null;
  exitReason: string | null;
}

export interface HistoryDiagnosticResult {
  totalClosedLosses: number;
  wouldBlockAtEntry: HistoryDiagnosticTrade[];
  wouldReduceSize: HistoryDiagnosticTrade[];
  wouldExitEarlier: HistoryDiagnosticTrade[];
  estimatedLossReductionUsd: number;
  winnersStillPassing: number;
  winnersBlocked: number;
  overFilterWarning: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function distancePct(from: number, to: number): number {
  if (from <= 0) return 0;
  return (Math.abs(to - from) / from) * 100;
}

export function tierStopLossBps(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return PAPER_CONFIG.stopLossBps;
    case "ALT_LIQUID":
      return PAPER_CONFIG.stopLossBps * 1.1;
    case "HIGH_VOLATILITY":
      return PAPER_CONFIG.stopLossBps * 1.5;
    case "EXTREME_RISK":
      return PAPER_CONFIG.stopLossBps * 2;
  }
}

export function tierTakeProfitBps(tier: RiskTier): number {
  switch (tier) {
    case "MAJOR":
      return PAPER_CONFIG.takeProfitBps;
    case "ALT_LIQUID":
      return PAPER_CONFIG.takeProfitBps * 0.9;
    case "HIGH_VOLATILITY":
      return PAPER_CONFIG.takeProfitBps * 1.2;
    case "EXTREME_RISK":
      return PAPER_CONFIG.takeProfitBps * 1.5;
  }
}

export function computeTierExitDistances(
  riskTier: RiskTier,
  side: StrategyDecision = "LONG",
): { stopDistancePct: number; takeProfitDistancePct: number } {
  const stopDistancePct = tierStopLossBps(riskTier) / 100;
  const takeProfitDistancePct = tierTakeProfitBps(riskTier) / 100;
  return { stopDistancePct, takeProfitDistancePct };
}

export function evaluateRiskReward(input: {
  riskTier: RiskTier;
  side: StrategyDecision;
  entryPrice: number;
  plannedStopLoss: number;
  plannedTakeProfit: number;
  riskAmountUsd: number;
  opportunityScore?: number;
  winProbability?: number;
}): RiskRewardEvaluation {
  const minRatio = MIN_REWARD_RISK_BY_TIER[input.riskTier];
  const stopDistancePct = distancePct(input.entryPrice, input.plannedStopLoss);
  const takeProfitDistancePct = distancePct(input.entryPrice, input.plannedTakeProfit);
  const rewardRiskRatio =
    stopDistancePct > 0 ? takeProfitDistancePct / stopDistancePct : 0;

  const expectedDownsideUsd = input.riskAmountUsd * PAPER_COST_DRAG_FACTOR;
  const expectedUpsideUsd =
    input.riskAmountUsd * rewardRiskRatio * (1 / PAPER_COST_DRAG_FACTOR);
  const winProb =
    input.winProbability ??
    Math.min(0.72, Math.max(0.35, (input.opportunityScore ?? 60) / 100));
  const expectedValueUsd =
    winProb * expectedUpsideUsd - (1 - winProb) * expectedDownsideUsd;

  const reasoning: string[] = [
    `Stop distance: ${stopDistancePct.toFixed(2)}%`,
    `Take-profit distance: ${takeProfitDistancePct.toFixed(2)}%`,
    `Reward/risk ratio: ${rewardRiskRatio.toFixed(2)} (min ${minRatio.toFixed(1)} for ${input.riskTier})`,
    `Expected upside: +${expectedUpsideUsd.toFixed(2)} SIM`,
    `Expected downside: -${expectedDownsideUsd.toFixed(2)} SIM (incl. cost drag)`,
    `Expected value: ${expectedValueUsd >= 0 ? "+" : ""}${expectedValueUsd.toFixed(2)} SIM`,
  ];

  const oneLossWipesMultipleWins =
    expectedDownsideUsd > 0 &&
    expectedUpsideUsd > 0 &&
    expectedDownsideUsd > expectedUpsideUsd * 2.5;

  if (rewardRiskRatio < minRatio) {
    return {
      passed: false,
      reasonCode: "REJECTED_BAD_RISK_REWARD",
      reasonText: `${input.riskTier} reward/risk ${rewardRiskRatio.toFixed(2)} below minimum ${minRatio.toFixed(1)} — one loss could erase multiple wins.`,
      stopDistancePct,
      takeProfitDistancePct,
      rewardRiskRatio,
      expectedUpsideUsd,
      expectedDownsideUsd,
      expectedValueUsd,
      minimumRequiredRatio: minRatio,
      decisionReasoning: reasoning,
    };
  }

  if (expectedValueUsd <= 0) {
    return {
      passed: false,
      reasonCode: "REJECTED_BAD_RISK_REWARD",
      reasonText: `Negative expected value (${expectedValueUsd.toFixed(2)} SIM) after costs — skip trade.`,
      stopDistancePct,
      takeProfitDistancePct,
      rewardRiskRatio,
      expectedUpsideUsd,
      expectedDownsideUsd,
      expectedValueUsd,
      minimumRequiredRatio: minRatio,
      decisionReasoning: reasoning,
    };
  }

  if (oneLossWipesMultipleWins) {
    return {
      passed: false,
      reasonCode: "REJECTED_BAD_RISK_REWARD",
      reasonText: `Expected downside too large vs upside — reject to protect paper balance.`,
      stopDistancePct,
      takeProfitDistancePct,
      rewardRiskRatio,
      expectedUpsideUsd,
      expectedDownsideUsd,
      expectedValueUsd,
      minimumRequiredRatio: minRatio,
      decisionReasoning: reasoning,
    };
  }

  return {
    passed: true,
    reasonCode: "TRADE_READY",
    reasonText: `Risk/reward ${rewardRiskRatio.toFixed(2)} passes ${input.riskTier} minimum ${minRatio.toFixed(1)}.`,
    stopDistancePct,
    takeProfitDistancePct,
    rewardRiskRatio,
    expectedUpsideUsd,
    expectedDownsideUsd,
    expectedValueUsd,
    minimumRequiredRatio: minRatio,
    decisionReasoning: reasoning,
  };
}

export function evaluateExtremeRiskEntry(input: {
  riskTier: RiskTier;
  opportunityScore: number;
  confidence: number;
  liquidityScore: number;
  rewardRiskRatio: number;
}): { allowed: boolean; reasonCode: string; reasonText: string } {
  if (input.riskTier !== "EXTREME_RISK") {
    return { allowed: true, reasonCode: "TRADE_READY", reasonText: "Not extreme tier." };
  }
  const exceptional =
    input.opportunityScore >= PAPER_CONFIG.minOpportunityScore + 20 &&
    input.confidence >= 0.85 &&
    input.liquidityScore >= 70 &&
    input.rewardRiskRatio >= MIN_REWARD_RISK_BY_TIER.EXTREME_RISK;
  if (!exceptional) {
    return {
      allowed: false,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText:
        "EXTREME_RISK is watch-only unless score, confidence, liquidity, and R:R are all exceptional.",
    };
  }
  return { allowed: true, reasonCode: "TRADE_READY", reasonText: "Exceptional EXTREME_RISK setup only." };
}

export function evaluateFakePumpRisk(input: {
  riskTier: RiskTier;
  change24hPct: number;
  change1hPct: number | null;
  volume24hUsd: number;
  liquidityScore: number;
  spreadBps: number;
  pumpRiskPenalty: number;
  momentumScore: number;
  volumeSpikeScore: number;
  tradableOnConfiguredExchange: boolean;
  breakdown: ScoreBreakdown;
  shortTermReturnPct?: number;
}): FakePumpEvaluation {
  const reasoning: string[] = [];
  const abs24h = Math.abs(input.change24hPct);
  const fadingPump =
    abs24h >= SCANNER_CONFIG.highVol24hChangePct &&
    input.change1hPct !== null &&
    Math.sign(input.change1hPct) !== Math.sign(input.change24hPct) &&
    Math.abs(input.change1hPct) < abs24h * 0.15;

  if (!input.tradableOnConfiguredExchange) {
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "REJECTED_FAKE_PUMP_RISK",
      reasonText: "Not confirmed tradable on Kraken — watch only.",
      decisionReasoning: ["Kraken tradability not confirmed"],
    };
  }

  if (input.pumpRiskPenalty >= 35) {
    reasoning.push(`Pump penalty ${input.pumpRiskPenalty.toFixed(0)} too high`);
    return {
      passed: false,
      watchOnly: input.pumpRiskPenalty < 50,
      reasonCode:
        input.pumpRiskPenalty >= 50 ? "REJECTED_FAKE_PUMP_RISK" : "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Pump/fake-move risk too high — do not chase noisy move.",
      decisionReasoning: reasoning,
    };
  }

  if (
    abs24h >= SCANNER_CONFIG.extreme24hChangePct &&
    (input.liquidityScore < 55 || input.volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd * 2)
  ) {
    reasoning.push("Huge 24h move with weak volume quality");
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Huge 24h move but volume/liquidity quality is weak — likely fade risk.",
      decisionReasoning: reasoning,
    };
  }

  if (fadingPump) {
    reasoning.push("24h pump fading on 1h timeframe");
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Price already pumped and started fading — no chase entry.",
      decisionReasoning: reasoning,
    };
  }

  if (input.spreadBps > SCANNER_CONFIG.maxSpreadBpsHighVol && input.riskTier !== "MAJOR") {
    reasoning.push(`Spread ${input.spreadBps.toFixed(0)} bps too wide for tier`);
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Spread too wide — poor exit liquidity on volatile coin.",
      decisionReasoning: reasoning,
    };
  }

  if (
    input.volumeSpikeScore > 85 &&
    input.momentumScore < 45 &&
    abs24h >= SCANNER_CONFIG.min24hChangePct
  ) {
    reasoning.push("Volume spike not sustained by momentum");
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Volume spike is not sustained — possible fake pump.",
      decisionReasoning: reasoning,
    };
  }

  const dominantMetric =
    input.breakdown.trendScore > 80 &&
    input.breakdown.liquidityScore < 50 &&
    input.breakdown.finalScore < PAPER_CONFIG.minOpportunityScore + 5;
  if (dominantMetric) {
    reasoning.push("Score inflated by one noisy metric without liquidity support");
    return {
      passed: false,
      watchOnly: true,
      reasonCode: "WATCH_ONLY_FAKE_PUMP_RISK",
      reasonText: "Score dominated by one noisy metric — setup not balanced.",
      decisionReasoning: reasoning,
    };
  }

  return {
    passed: true,
    watchOnly: false,
    reasonCode: "TRADE_READY",
    reasonText: "No fake-pump red flags detected.",
    decisionReasoning: ["Pump/fake-move checks passed"],
  };
}

export function evaluateRiskMode(
  summary: PaperPerformanceSummary,
  exposurePct: number | null,
  scope: "all_time" | "strategy_version" | "baseline" = "all_time",
): RiskModeState {
  const reasons: string[] = [];
  const avgWin = summary.averageWinningTrade ?? 0;
  const avgLoss = summary.averageLosingTrade ?? 0;
  const scopeLabel =
    scope === "baseline"
      ? "current baseline"
      : scope === "strategy_version"
        ? "current strategy version"
        : "all-time";

  if (summary.profitFactor !== null && summary.profitFactor < 1.2 && summary.totalClosedTrades >= 3) {
    reasons.push(`Profit factor ${summary.profitFactor.toFixed(2)} below 1.2 (${scopeLabel})`);
  }
  if (avgWin > 0 && avgLoss > avgWin * 1.5) {
    reasons.push(`Average loss is larger than 1.5× average win (${scopeLabel})`);
  }
  if (summary.losses >= 2 && summary.totalClosedTrades >= 5) {
    const recentLossStreak = summary.losses / summary.totalClosedTrades;
    if (recentLossStreak >= 0.35) {
      reasons.push(`Loss rate elevated in closed sample (${scopeLabel})`);
    }
  }
  if (
    summary.maxDrawdownSimulated !== null &&
    summary.maxDrawdownSimulated > SCANNER_CONFIG.simulatedAccountUsd * 0.05
  ) {
    reasons.push(`Max drawdown above safe limit (${scopeLabel})`);
  }
  const riskExposure = summary.riskAtStopPct ?? exposurePct;
  if (
    riskExposure !== null &&
    riskExposure > PAPER_RISK_CONFIG.maxTotalExposurePercent
  ) {
    reasons.push("Risk-at-stop above allowed limit");
  }
  if (summary.stopLossHitCount >= 2 && summary.thesisInvalidationExitCount === 0) {
    reasons.push("Recent stop-loss hits increasing without early exits");
  }

  const active = reasons.length > 0 && summary.totalClosedTrades >= 3;
  return {
    active,
    reasons,
    dashboardLabel: active ? "RISK_MODE_ACTIVE" : "NORMAL",
    dashboardMessage: active
      ? `Average loss is larger than average win (${scopeLabel}). Reducing size and blocking weaker trades.`
      : `Normal paper risk mode (${scopeLabel}) — no loss shield active.`,
    performanceScope: scope,
    performanceScopeLabel: scopeLabel,
  };
}

export function buildProfitQualityVerdict(summary: PaperPerformanceSummary): string {
  if (summary.totalClosedTrades === 0) {
    return "Not enough closed trades yet to judge profit quality.";
  }
  const avgWin = summary.averageWinningTrade ?? 0;
  const avgLoss = summary.averageLosingTrade ?? 0;
  const ratio = avgWin > 0 ? avgLoss / avgWin : null;
  const winRatePct =
    summary.winRate !== null ? (summary.winRate * 100).toFixed(1) : "UNKNOWN";

  if (ratio !== null && ratio >= 1.5 && (summary.winRate ?? 0) >= 0.5) {
    return (
      `Bot wins often (${winRatePct}% win rate), but average loss is ${ratio.toFixed(1)}× average win, ` +
      `so strategy is not healthy yet.`
    );
  }
  if (summary.totalNetPnl > 0 && (summary.profitFactor ?? 0) >= 1.2) {
    return `Paper strategy is healthy so far (+${summary.totalNetPnl.toFixed(2)} SIM, simulated only).`;
  }
  if (summary.totalNetPnl < 0) {
    return `Paper P&L is negative (${summary.totalNetPnl.toFixed(2)} SIM) — losses are outweighing wins despite ${winRatePct}% win rate.`;
  }
  return "Profit quality is mixed — continue paper evidence with strict filters.";
}

export function buildProfitQualitySummary(
  summary: PaperPerformanceSummary,
  options?: {
    performanceScope?: "all_time" | "strategy_version" | "baseline";
  },
): ProfitQualitySummary {
  const scope = options?.performanceScope ?? "all_time";
  const avgWin = summary.averageWinningTrade;
  const avgLoss = summary.averageLosingTrade;
  const riskMode = evaluateRiskMode(summary, summary.riskAtStopPct ?? summary.currentExposurePct, scope);
  const profitQualityVerdict = buildProfitQualityVerdict(summary);
  let healthStatus: ProfitQualitySummary["healthStatus"] = "INSUFFICIENT_DATA";
  if (summary.totalClosedTrades >= 5) {
    healthStatus =
      (summary.profitFactor ?? 0) >= 1.2 &&
      (avgWin ?? 0) > 0 &&
      (avgLoss ?? 0) <= (avgWin ?? 0) * 1.2
        ? "HEALTHY"
        : "UNHEALTHY";
  }

  return {
    startingPaperBalance: summary.startingPaperBalance,
    currentPaperBalance: summary.currentPaperBalance,
    totalRealizedPnl: summary.totalRealizedPnl,
    totalUnrealizedPnl: summary.totalUnrealizedPnl,
    portfolioPnl: summary.totalNetPnl,
    totalGrossProfit: summary.totalGrossProfit,
    totalGrossLoss: summary.totalGrossLoss,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    averageWin: avgWin,
    averageLoss: avgLoss,
    avgLossToWinRatio: avgWin && avgWin > 0 && avgLoss ? avgLoss / avgWin : null,
    profitFactor: summary.profitFactor,
    expectancy: summary.expectancyPerTrade,
    largestWin: summary.largestWin,
    largestLoss: summary.largestLoss,
    maxDrawdown: summary.maxDrawdownSimulated,
    currentExposurePct: summary.capitalExposurePct ?? summary.currentExposurePct,
    capitalExposurePct: summary.capitalExposurePct ?? summary.currentExposurePct,
    riskAtStopPct: summary.riskAtStopPct,
    riskMode,
    profitQualityVerdict,
    healthStatus,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function parseScore(reason: string): number | null {
  const m = reason.match(/score:\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseExit(reason: string): string | null {
  const m = reason.match(/closed:\s*([^|]+)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

function inferRiskTier(reason: string, symbol: string): RiskTier {
  if (reason.includes("EXTREME_RISK")) return "EXTREME_RISK";
  if (reason.includes("HIGH_VOLATILITY")) return "HIGH_VOLATILITY";
  const base = symbol.split("/")[0] ?? "";
  if (["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "LINK", "DOT", "AVAX"].includes(base)) {
    return "MAJOR";
  }
  return "ALT_LIQUID";
}

export function tradeToHistoryDiagnostic(trade: DbPaperTrade): HistoryDiagnosticTrade {
  const entry = Number(trade.entryPrice ?? 0);
  const stop = Number(trade.plannedStopLoss ?? 0);
  const tp = Number(trade.plannedTakeProfit ?? 0);
  const stopDistancePct = entry > 0 && stop ? distancePct(entry, stop) : null;
  const takeProfitDistancePct = entry > 0 && tp ? distancePct(entry, tp) : null;
  const rewardRiskRatio =
    stopDistancePct && takeProfitDistancePct && stopDistancePct > 0
      ? takeProfitDistancePct / stopDistancePct
      : null;

  return {
    symbol: trade.symbol,
    result: trade.result,
    netPnl: Number(trade.netPaperPnl ?? 0),
    reason: trade.reason,
    riskTier: inferRiskTier(trade.reason, trade.symbol),
    opportunityScore: parseScore(trade.reason),
    stopDistancePct,
    takeProfitDistancePct,
    rewardRiskRatio,
    riskAmountUsd: Number(trade.riskAmount ?? 0),
    exitReason: parseExit(trade.reason),
  };
}

export function diagnoseTradeHistory(trades: DbPaperTrade[]): HistoryDiagnosticResult {
  const closedLosses = trades
    .filter((t) => t.result === "LOSS" && t.side !== "NO_TRADE")
    .map(tradeToHistoryDiagnostic);

  const closedWins = trades
    .filter((t) => t.result === "WIN" && t.side !== "NO_TRADE")
    .map(tradeToHistoryDiagnostic);

  const wouldBlockAtEntry: HistoryDiagnosticTrade[] = [];
  const wouldReduceSize: HistoryDiagnosticTrade[] = [];
  const wouldExitEarlier: HistoryDiagnosticTrade[] = [];
  let estimatedLossReductionUsd = 0;

  for (const t of closedLosses) {
    const minRr = MIN_REWARD_RISK_BY_TIER[t.riskTier];
    const score = t.opportunityScore ?? 0;
    let blocked = false;

    if (t.rewardRiskRatio !== null && t.rewardRiskRatio < minRr) {
      blocked = true;
    }
    if (t.riskTier === "EXTREME_RISK" && score < PAPER_CONFIG.minOpportunityScore + 20) {
      blocked = true;
    }
    if (t.riskTier === "HIGH_VOLATILITY" && score < PAPER_CONFIG.minOpportunityScore + 8) {
      blocked = true;
    }
    if (
      t.riskTier === "ALT_LIQUID" &&
      score > 0 &&
      score < Math.max(PAPER_CONFIG.minOpportunityScore - 5, 55)
    ) {
      blocked = true;
    }
    if (/FARTCOIN|POPCAT|SPX/i.test(t.symbol) && t.riskTier === "HIGH_VOLATILITY") {
      blocked = true;
    }

    if (blocked) {
      wouldBlockAtEntry.push(t);
      estimatedLossReductionUsd += Math.abs(t.netPnl);
      continue;
    }

    if (
      t.exitReason?.includes("STOP_LOSS") &&
      t.riskAmountUsd &&
      Math.abs(t.netPnl) > t.riskAmountUsd * 1.3
    ) {
      wouldExitEarlier.push(t);
      const saved = Math.abs(t.netPnl) - t.riskAmountUsd * PAPER_COST_DRAG_FACTOR;
      estimatedLossReductionUsd += Math.max(0, saved * 0.5);
    }

    if (Math.abs(t.netPnl) > 30) {
      wouldReduceSize.push(t);
      estimatedLossReductionUsd += Math.abs(t.netPnl) * 0.35;
    }
  }

  let winnersStillPassing = 0;
  let winnersBlocked = 0;
  for (const w of closedWins) {
    const minRr = MIN_REWARD_RISK_BY_TIER[w.riskTier];
    if (w.rewardRiskRatio !== null && w.rewardRiskRatio >= minRr) {
      winnersStillPassing++;
    } else {
      winnersBlocked++;
    }
  }

  const blockRate =
    closedLosses.length > 0 ? wouldBlockAtEntry.length / closedLosses.length : 0;
  const overFilterWarning =
    winnersBlocked > winnersStillPassing
      ? "New rules may block more historical winners than losers — tune thresholds carefully."
      : blockRate >= 0.85
        ? "Rules would block most historical losses but may be strict on marginal winners."
        : null;

  return {
    totalClosedLosses: closedLosses.length,
    wouldBlockAtEntry,
    wouldReduceSize,
    wouldExitEarlier,
    estimatedLossReductionUsd: Math.round(estimatedLossReductionUsd * 100) / 100,
    winnersStillPassing,
    winnersBlocked,
    overFilterWarning,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildCandidateDecisionReasoning(input: {
  candidate: ScanCandidate;
  riskReward: RiskRewardEvaluation;
  fakePump: FakePumpEvaluation;
  action: "ENTER" | "SKIP" | "HOLD" | "EXIT";
}): string[] {
  const lines = [
    `Action: ${input.action}`,
    `Symbol: ${input.candidate.symbol} (${input.candidate.riskTier})`,
    `Score: ${input.candidate.opportunityScore.toFixed(0)} · Confidence: ${input.candidate.scoreBreakdown.confidenceLevel}`,
    ...input.fakePump.decisionReasoning,
    ...input.riskReward.decisionReasoning,
  ];
  if (!input.riskReward.passed) {
    lines.push(`Blocked: ${input.riskReward.reasonText}`);
  }
  if (!input.fakePump.passed) {
    lines.push(`Pump filter: ${input.fakePump.reasonText}`);
  }
  return lines;
}

export function noTradeBestDecisionMessage(candidateCount: number, openCount: number): string {
  if (candidateCount === 0) {
    return "NO_TRADE_BEST_DECISION — No candidates met quality filters this run.";
  }
  if (openCount > 0) {
    return "NO_TRADE_BEST_DECISION — Open trades held; no new entry strong enough to open.";
  }
  return "NO_TRADE_BEST_DECISION — No setup strong enough; skipping is better than forcing a trade.";
}
