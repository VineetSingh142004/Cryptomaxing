import type { PaperEvidenceRun, PaperTrade as DbPaperTrade } from "@prisma/client";
import { APP_VERSION } from "@/lib/config/constants";
import { getAuthStatus } from "@/lib/security/auth";
import { getOrCreateModeState } from "@/lib/trading/mode-service";
import { evaluateAutoUnlock, buildAutoUnlockInput } from "@/lib/trading/auto";
import { getMarketDataProviderStatus } from "@/lib/trading/paper/safe-check";
import { buildActiveTradingRules } from "@/lib/trading/paper/active-trading-rules";
import { analyzeLosingTrades } from "@/lib/trading/paper/loss-analysis";
import { buildTradeHistoryRow } from "@/lib/trading/paper/trade-history";
import { DATA_TRUTH } from "@/lib/trading/paper/data-truth";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import { serializePaperRiskConfig } from "@/lib/trading/paper/paper-risk-config";
import { mapCandidateRecommendationLabel, summarizeRejectionCategories } from "@/lib/trading/paper/paper-labels";
import { formatBlueprintStrategyMatchDebugLines } from "@/lib/trading/paper/strategy-mapping";
import { evaluateTradeFrequencyHealth } from "@/lib/trading/paper/trade-frequency-health";
import {
  buildPaperPerformanceSummary,
  formatMetric,
  formatProfitFactorDisplay,
  type PaperPerformanceSummary,
} from "@/lib/trading/paper/performance-summary";
import { buildCarriedClosedTradeSnapshots } from "@/lib/trading/paper/record-accounting";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import {
  evaluateOpenTradeThesisReview,
} from "@/lib/trading/paper/thesis-invalidation";
import {
  buildRecordComparison,
  buildRecordHistoryRows,
  buildCarriedTradeSnapshots,
  buildCurrentRecordAccounting,
  buildRecordActivityFeed,
  buildRecordBotHealthCheck,
  computeRecordPerformanceBreakdown,
  isNewRecordTrade,
  recordHeading,
  serializePaperRecord,
  type CurrentRecordAccounting,
  type SerializedPaperRecord,
  ensurePaperRecords,
  getActivePaperRecord,
  sumRecordRejectionCounts,
  splitRecordTrades,
  LEGACY_CARRY_BASELINE_MISSING_MESSAGE,
  CARRIED_FROM_PREVIOUS_RECORD,
} from "@/lib/trading/paper/paper-record";
import { prisma } from "@/lib/db/client";
import {
  formatDiagnosticsExportLines,
  type PaperRunDiagnostics,
} from "@/lib/trading/paper/paper-diagnostics";

export type PaperExportMode =
  | "SUMMARY_EXPORT"
  | "FULL_TRADE_LOG_EXPORT"
  | "FULL_DEBUG_EXPORT"
  | "CURRENT_RECORD_EXPORT"
  | "ALL_RECORDS_EXPORT"
  | "ARCHIVED_RECORDS_EXPORT";

export const DEFAULT_PAPER_EXPORT_MODE: PaperExportMode = "FULL_TRADE_LOG_EXPORT";

export const PAPER_EXPORT_MODE_LABELS: Record<PaperExportMode, string> = {
  SUMMARY_EXPORT: "Summary only — performance and system status",
  FULL_TRADE_LOG_EXPORT: "Full trade log — summary, trades, run overview",
  FULL_DEBUG_EXPORT: "Full debug — all sections with detailed run/candidate history",
  CURRENT_RECORD_EXPORT: "Current active record only",
  ALL_RECORDS_EXPORT: "All records with headings and comparison",
  ARCHIVED_RECORDS_EXPORT: "Archived records only",
};

const DEFAULT_MAX_DETAILED_RUNS = 50;
const FULL_TRADE_LOG_DETAILED_RUNS = 10;
const DEFAULT_MAX_CANDIDATES = 50;

export function exportContainsSecrets(text: string): boolean {
  const assignmentPatterns = [
    /api[_-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
    /password\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
    /private[_-]?key\s*[:=]\s*\S+/i,
    /KRAKEN_API_\w+\s*[:=]\s*\S+/i,
    /DATABASE_URL\s*[:=]\s*\S+/i,
  ];
  return assignmentPatterns.some((pattern) => pattern.test(text));
}

export function parsePaperExportMode(value: string | null | undefined): PaperExportMode {
  if (
    value === "SUMMARY_EXPORT" ||
    value === "FULL_DEBUG_EXPORT" ||
    value === "CURRENT_RECORD_EXPORT" ||
    value === "ALL_RECORDS_EXPORT" ||
    value === "ARCHIVED_RECORDS_EXPORT"
  ) {
    return value;
  }
  return DEFAULT_PAPER_EXPORT_MODE;
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

export function formatExportLine(
  label: string,
  value: string | number | null | undefined | boolean,
): string {
  const v =
    value === null || value === undefined || value === ""
      ? "UNKNOWN"
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : typeof value === "number"
          ? Number.isFinite(value)
            ? String(value)
          : "UNKNOWN"
          : String(value);
  return `${label}: ${v}`;
}

function line(label: string, value: string | number | null | undefined | boolean): string {
  return formatExportLine(label, value);
}

function section(title: string, lines: string[]): string {
  return `\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n${lines.join("\n")}\n`;
}

function simpleSummaryLines(s: PaperPerformanceSummary): string[] {
  return [
    "=== SIMPLE PERFORMANCE SUMMARY (SIMULATED — SHAREABLE) ===",
    line("Started with", `${s.startingPaperBalance.toFixed(2)} SIM`),
    line("Current paper balance", `${s.currentPaperBalance.toFixed(4)} SIM`),
    line("Portfolio P&L (realized + unrealized)", `${s.totalNetPnl >= 0 ? "+" : ""}${s.totalNetPnl.toFixed(4)} SIM`),
    line("Realized P&L (closed trades)", `${s.totalRealizedPnl.toFixed(4)} SIM`),
    line("Unrealized P&L (open trades)", `${s.totalUnrealizedPnl.toFixed(4)} SIM`),
    line("Gross profit", `+${s.totalGrossProfit.toFixed(4)} SIM`),
    line("Gross loss", `-${s.totalGrossLoss.toFixed(4)} SIM`),
    line("Open trades", s.totalOpenTrades),
    line("Closed trades", s.totalClosedTrades),
    line("Wins", s.wins),
    line("Losses", s.losses),
    line("Breakevens", s.breakevens),
    line("Win rate", s.winRate !== null ? `${(s.winRate * 100).toFixed(1)}%` : "UNKNOWN"),
    line("Average win", formatMetric(s.averageWinningTrade)),
    line("Average loss", formatMetric(s.averageLosingTrade)),
    line("Largest win", formatMetric(s.largestWin)),
    line("Largest loss", formatMetric(s.largestLoss)),
    line("Profit factor", formatMetric(s.profitFactor)),
    line("Max drawdown", formatMetric(s.maxDrawdownSimulated)),
    line("Capital exposure %", formatMetric(s.capitalExposurePct ?? s.currentExposurePct, 2)),
    line("Risk-at-stop %", formatMetric(s.riskAtStopPct, 2)),
    line("Peak capital exposure %", formatMetric(s.maxExposureUsedPct, 2)),
    line("Largest single trade %", formatMetric(s.largestSingleTradeExposurePct, 2)),
    "",
    "VERDICT:",
    s.simpleVerdict,
    "",
    "WHAT NEEDS IMPROVEMENT NEXT:",
    ...s.improvementItems.map((item) => `  - ${item}`),
    "",
    s.exposureExplanation ?? "",
    "",
    "WARNING: SIMULATED PAPER ONLY — NOT REAL TRADING PROFIT",
  ];
}

function performanceLines(s: PaperPerformanceSummary): string[] {
  return [
    line("Starting paper balance (SIM)", `${s.startingPaperBalance} SIM`),
    line("Current paper balance (SIM)", `${s.currentPaperBalance.toFixed(4)} SIM`),
    line("Portfolio P&L (SIM) = realized + unrealized", `${s.totalNetPnl.toFixed(4)} SIM`),
    line("Realized P&L (SIM) — closed paper trades", `${s.totalRealizedPnl.toFixed(4)} SIM`),
    line("Unrealized P&L (SIM) — open paper trades", `${s.totalUnrealizedPnl.toFixed(4)} SIM`),
    line("Total gross profit (SIM)", `${s.totalGrossProfit.toFixed(4)} SIM`),
    line("Total gross loss (SIM)", `${s.totalGrossLoss.toFixed(4)} SIM`),
    line("Total closed trades", s.totalClosedTrades),
    line("Total open trades", s.totalOpenTrades),
    line("Wins", s.wins),
    line("Losses", s.losses),
    line("Breakevens", s.breakevens),
    line("Win rate", s.winRate !== null ? `${(s.winRate * 100).toFixed(1)}%` : "UNKNOWN"),
    line("Profit factor", formatMetric(s.profitFactor)),
    line("Expectancy per trade (SIM)", formatMetric(s.expectancyPerTrade)),
    line("Average winner (SIM)", formatMetric(s.averageWinningTrade)),
    line("Average loser (SIM)", formatMetric(s.averageLosingTrade)),
    line("Largest win (SIM)", formatMetric(s.largestWin)),
    line("Largest loss (SIM)", formatMetric(s.largestLoss)),
    line("Max drawdown (SIM)", formatMetric(s.maxDrawdownSimulated)),
    line("Average trade duration (hours)", formatMetric(s.averageTradeDurationHours, 1)),
    line("Stop-loss hit count", s.stopLossHitCount),
    line("Take-profit hit count", s.takeProfitHitCount),
    line("Expiry exit count", s.expiryExitCount),
    line("Thesis invalidation exit count", s.thesisInvalidationExitCount),
    line("Best coin", s.bestCoin),
    line("Worst coin", s.worstCoin),
    line("Most traded coin", s.mostTradedCoin),
    line("Current capital exposure % (open notional)", formatMetric(s.capitalExposurePct ?? s.currentExposurePct, 2)),
    line("Current risk-at-stop %", formatMetric(s.riskAtStopPct, 2)),
    line("Peak capital exposure %", formatMetric(s.maxExposureUsedPct, 2)),
    line("Largest single trade exposure %", formatMetric(s.largestSingleTradeExposurePct, 2)),
    line("Exposure note", s.exposureExplanation),
    "WARNING: All P&L values are SIMULATED paper trades — not real profit or loss.",
  ];
}

function buildRunDetailLines(run: PaperEvidenceRun, idx: number): string[] {
  const summary = (run.scanSummary ?? {}) as Record<string, unknown>;
  const warnings = Array.isArray(run.runWarnings) ? (run.runWarnings as string[]) : [];
  const errors = Array.isArray(run.runErrors) ? (run.runErrors as string[]) : [];
  const durationMs =
    run.completedAt && run.startedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : null;
  const actions = Array.isArray(run.actions) ? (run.actions as string[]) : [];
  const lines: string[] = [];
  lines.push(`--- Run #${idx + 1} ---`);
  lines.push(line("Run ID", run.id));
  lines.push(line("Strategy version", (run as { strategyVersion?: string }).strategyVersion ?? "legacy"));
  lines.push(line("Timestamp", run.startedAt?.toISOString() ?? "UNKNOWN"));
  lines.push(line("Status", run.status));
  lines.push(line("Latest action", actions.at(-1) ?? run.reasonCode ?? "UNKNOWN"));
  lines.push(line("Duration (ms)", durationMs));
  lines.push(line("Candidates stored", run.candidatesStored));
  lines.push(line("Signals stored", run.signalsStored));
  lines.push(line("Snapshots stored", run.snapshotsStored));
  lines.push(line("Coins discovered", run.coinsDiscovered));
  lines.push(line("Coins evaluated", run.coinsEvaluated));
  lines.push(line("Opened this run", run.tradesOpened));
  lines.push(line("Updated this run", run.tradesUpdated));
  lines.push(line("Closed this run", run.tradesClosed));
  lines.push(line("Reason code", run.reasonCode));
  lines.push(line("Warnings", warnings.length ? warnings.join("; ") : "none"));
  lines.push(line("Errors", errors.length ? errors.join("; ") : "none"));
  if (summary.providerContributions) {
    lines.push(line("Provider contribution", "see scan summary (stored)"));
  }
  lines.push("");
  return lines;
}

function buildRunHistorySummaryLines(runs: PaperEvidenceRun[]): string[] {
  const completed = runs.filter((r) => r.status === "COMPLETED").length;
  const failed = runs.filter((r) => r.status === "FAILED").length;
  const totalCandidates = runs.reduce((sum, r) => sum + (r.candidatesStored ?? 0), 0);
  const totalOpened = runs.reduce((sum, r) => sum + (r.tradesOpened ?? 0), 0);
  const totalClosed = runs.reduce((sum, r) => sum + (r.tradesClosed ?? 0), 0);
  return [
    line("Total paper runs", runs.length),
    line("Completed runs", completed),
    line("Failed runs", failed),
    line("Total candidates stored (all runs)", totalCandidates),
    line("Total trades opened (all runs)", totalOpened),
    line("Total trades closed (all runs)", totalClosed),
    line("First run", runs[0]?.startedAt?.toISOString() ?? "UNKNOWN"),
    line("Latest run", runs.at(-1)?.startedAt?.toISOString() ?? "UNKNOWN"),
    line("Latest run status", runs.at(-1)?.status ?? "UNKNOWN"),
  ];
}

function buildRunHistorySection(
  runs: PaperEvidenceRun[],
  mode: PaperExportMode,
): string[] {
  if (runs.length === 0) return ["No runs recorded."];

  const summaryLines = buildRunHistorySummaryLines(runs);
  const detailedLimit =
    mode === "FULL_DEBUG_EXPORT" ? DEFAULT_MAX_DETAILED_RUNS : FULL_TRADE_LOG_DETAILED_RUNS;
  const detailedRuns = runs.slice(-detailedLimit);
  const omitted = runs.length - detailedRuns.length;

  const lines: string[] = [...summaryLines, ""];
  if (omitted > 0) {
    lines.push(
      `Showing last ${detailedRuns.length} of ${runs.length} runs in detail (${omitted} older runs omitted).`,
      mode === "FULL_TRADE_LOG_EXPORT"
        ? "Use FULL_DEBUG_EXPORT for up to 50 detailed runs."
        : "",
      "",
    );
  }

  detailedRuns.forEach((run, idx) => {
    const globalIdx = runs.length - detailedRuns.length + idx;
    lines.push(...buildRunDetailLines(run, globalIdx));
  });
  return lines;
}

export interface PaperExportContext {
  userId: string;
  generatedAt: Date;
  mode?: PaperExportMode;
  recordId?: string;
  maxDetailedRuns?: number;
  maxCandidates?: number;
}

interface PaperExportData {
  mode: PaperExportMode;
  generatedAt: Date;
  recordId?: string;
  modeState: Awaited<ReturnType<typeof getOrCreateModeState>>;
  auth: Awaited<ReturnType<typeof getAuthStatus>>;
  marketData: ReturnType<typeof getMarketDataProviderStatus>;
  safety: ReturnType<typeof verifyPaperSafetyGates>;
  unlock: ReturnType<typeof evaluateAutoUnlock>;
  activeRules: ReturnType<typeof buildActiveTradingRules>;
  trades: DbPaperTrade[];
  runs: PaperEvidenceRun[];
  latestCandidates: Awaited<ReturnType<typeof prisma.paperScanCandidate.findMany>>;
  openTradesWithSnaps: Array<
    DbPaperTrade & { snapshots: Array<{ markPrice: unknown; unrealizedPnl: unknown; capturedAt: Date }> }
  >;
  performance: PaperPerformanceSummary;
  activeRecord: SerializedPaperRecord | null;
  recordHistory: Awaited<ReturnType<typeof buildRecordHistoryRows>>;
  recordComparison: ReturnType<typeof buildRecordComparison>;
  currentRecordAccounting: CurrentRecordAccounting | null;
  lossPanel: ReturnType<typeof analyzeLosingTrades>;
  evidenceCounts: {
    runs: number;
    candidates: number;
    signals: number;
    snapshots: number;
  };
}

async function loadPaperExportData(ctx: PaperExportContext): Promise<PaperExportData> {
  const { userId, generatedAt } = ctx;
  const mode = ctx.mode ?? DEFAULT_PAPER_EXPORT_MODE;
  const maxCandidates =
    mode === "SUMMARY_EXPORT" ? 0 : (ctx.maxCandidates ?? DEFAULT_MAX_CANDIDATES);

  const [
    modeState,
    auth,
    marketData,
    safety,
    unlockInput,
    trades,
    runs,
    latestCandidates,
    openTradesWithSnaps,
    evidenceCounts,
  ] = await Promise.all([
    getOrCreateModeState(),
    getAuthStatus(),
    Promise.resolve(getMarketDataProviderStatus()),
    Promise.resolve(verifyPaperSafetyGates()),
    buildAutoUnlockInput(),
    prisma.paperTrade.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.paperEvidenceRun.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        userId: true,
        recordId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        reasonCode: true,
        candidatesStored: true,
        signalsStored: true,
        snapshotsStored: true,
        coinsDiscovered: true,
        coinsEvaluated: true,
        tradesOpened: true,
        tradesUpdated: true,
        tradesClosed: true,
        highVolCount: true,
        watchlistCount: true,
        scanSummary: true,
        runWarnings: true,
        runErrors: true,
        actions: true,
      },
    }),
    maxCandidates > 0
      ? prisma.paperScanCandidate.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: Math.max(maxCandidates, 200),
        })
      : Promise.resolve([]),
    prisma.paperTrade.findMany({
      where: { userId, status: "OPEN" },
      include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    }),
    Promise.all([
      prisma.paperEvidenceRun.count({ where: { userId } }),
      prisma.paperScanCandidate.count({ where: { userId } }),
      prisma.paperSignal.count({ where: { userId } }),
      prisma.paperTradeSnapshot.count({ where: { trade: { userId } } }),
    ]).then(([runs, candidates, signals, snapshots]) => ({
      runs,
      candidates,
      signals,
      snapshots,
    })),
  ]);

  const unlock = evaluateAutoUnlock(unlockInput);
  const activeRules = buildActiveTradingRules();

  const closedForDd = trades.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of [...closedForDd].sort(
    (a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0),
  )) {
    equity += toNumber(t.netPaperPnl) ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const markMap = new Map<string, number>();
  for (const t of openTradesWithSnaps) {
    const snap = t.snapshots[0];
    const mark = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (mark !== null) markMap.set(t.id, mark);
  }

  const performance = buildPaperPerformanceSummary({
    trades,
    latestMarkByTradeId: markMap,
    maxDrawdown,
  });
  await ensurePaperRecords(userId);
  const activeRecordRow = await getActivePaperRecord(userId);
  const activeRecord = activeRecordRow ? serializePaperRecord(activeRecordRow) : null;
  const recordHistory = await buildRecordHistoryRows(userId);
  const recordComparison = buildRecordComparison(recordHistory);
  const currentRecordAccounting =
    activeRecordRow && activeRecord
      ? buildCurrentRecordAccounting({
          record: activeRecordRow,
          recordTrades: trades.filter((t) => t.recordId === activeRecord.recordId),
          allTrades: trades,
          openTradesWithSnaps,
        })
      : null;

  const candidateScores = new Map(
    latestCandidates.map((c) => [c.symbol, toNumber(c.opportunityScore) ?? 0]),
  );
  const lossPanel = analyzeLosingTrades(trades, {
    candidateScores,
    averageWinningTrade: performance.averageWinningTrade,
    averageLosingTrade: performance.averageLosingTrade,
    limit: null,
  });

  return {
    mode,
    generatedAt,
    recordId: ctx.recordId,
    modeState,
    auth,
    marketData,
    safety,
    unlock,
    activeRules,
    trades,
    runs,
    latestCandidates,
    openTradesWithSnaps,
    performance,
    activeRecord,
    recordHistory,
    recordComparison,
    currentRecordAccounting,
    lossPanel,
    evidenceCounts,
  };
}

function buildExportHeader(data: PaperExportData): string[] {
  return [
    "ALPHA AUTOPILOT — PAPER TRADING LOG",
    `Export mode: ${data.mode}`,
    `Export mode description: ${PAPER_EXPORT_MODE_LABELS[data.mode]}`,
    `Generated: ${data.generatedAt.toISOString()}`,
    `App version: ${APP_VERSION}`,
    "SIMULATED DATA WARNING: This report contains simulated paper trades only.",
    "No live orders were placed. No real P&L is shown.",
    "P&L definitions: Realized = closed paper trades | Unrealized = open paper trades | Portfolio = realized + unrealized",
  ];
}

function buildSystemStatusSection(data: PaperExportData): string {
  const { modeState, auth, marketData, unlock, runs, evidenceCounts } = data;
  return section("SECTION 1 — SYSTEM STATUS", [
    line("App mode", modeState.current_mode),
    line("Local owner mode", auth.localOwnerMode ?? auth.status === "LOCAL_OWNER_MODE"),
    line("Trading mode", modeState.current_mode),
    line("Auto lock status", unlock.autoExecutionEnabled ? "UNLOCKED" : "LOCKED"),
    line("Live trading lock status", "LOCKED"),
    line("Provider status", marketData.configured ? "CONFIGURED" : "NOT_CONFIGURED"),
    line("Last paper run time", runs.at(-1)?.startedAt?.toISOString() ?? "UNKNOWN"),
    line("Evidence — paper runs", evidenceCounts.runs),
    line("Evidence — candidates", evidenceCounts.candidates),
    line("Evidence — signals", evidenceCounts.signals),
    line("Evidence — snapshots", evidenceCounts.snapshots),
    line("Scanner mode", SCANNER_CONFIG.mode),
    line("Data sources enabled", SCANNER_CONFIG.dataSources.join(", ")),
    "Paper/simulated warning: All trade P&L in this file is SIMULATED — never real profit.",
  ]);
}

function buildTradeHistorySection(trades: DbPaperTrade[]): string {
  const tradeLines: string[] = [];
  const actionable = trades.filter((t) => t.status !== "NO_TRADE" && t.side !== "NO_TRADE");
  actionable.forEach((trade, idx) => {
    const row = buildTradeHistoryRow(trade, idx + 1);
    tradeLines.push(`--- Trade #${idx + 1} ---`);
    tradeLines.push(line("Trade ID", trade.id));
    tradeLines.push(line("Symbol", trade.symbol));
    tradeLines.push(line("Side", trade.side));
    tradeLines.push(line("Status", trade.status));
    tradeLines.push(line("Entry time", row.entryTime));
    tradeLines.push(line("Exit time", row.exitTime ?? "OPEN"));
    tradeLines.push(line("Entry price", row.entryPrice));
    tradeLines.push(line("Exit price", row.exitPrice ?? "OPEN"));
    tradeLines.push(line("Quantity", row.amountEntered));
    tradeLines.push(line("Allocation %", row.allocationPct));
    tradeLines.push(line("Leverage", row.leverageUsed));
    tradeLines.push(line("Realized/unrealized", trade.status === "OPEN" ? "unrealized (open)" : "realized (closed)"));
    tradeLines.push(line("Net P&L (SIM)", row.netPnl));
    tradeLines.push(line("P&L %", row.pctGainLoss));
    tradeLines.push(line("Result", row.finalResult));
    tradeLines.push(line("Duration (hours)", row.durationHours));
    tradeLines.push(line("Entry reason", row.entryReason));
    tradeLines.push(line("Exit reason", row.exitReason ?? "OPEN"));
    tradeLines.push(line("Rule followed", row.followedBotRules ? "yes" : "no"));
    tradeLines.push("");
  });
  return section(
    "SECTION 4 — FULL TRADE HISTORY",
    tradeLines.length ? tradeLines : ["No trades recorded."],
  );
}

function buildLossDiagnosisSection(data: PaperExportData): string {
  const lossLines: string[] = [];
  for (const l of data.lossPanel.losses) {
    lossLines.push(`--- ${l.symbol} ---`);
    lossLines.push(line("Entry price", l.entryPrice));
    lossLines.push(line("Exit price", l.exitPrice));
    lossLines.push(line("Allocation %", l.allocationPct));
    lossLines.push(line("Stop-loss distance %", formatMetric(l.stopLossDistancePct, 2)));
    lossLines.push(line("Take-profit distance %", formatMetric(l.takeProfitDistancePct, 2)));
    lossLines.push(line("Entry score", l.scoreAtEntry));
    lossLines.push(line("Exit reason", l.exitReason));
    lossLines.push(line("Loss amount (SIM)", l.lossAmount));
    lossLines.push(line("Loss %", formatMetric(l.lossPct, 2)));
    lossLines.push(
      line("Average loss too large", l.averageLossTooLarge === null ? "UNKNOWN" : l.averageLossTooLarge),
    );
    lossLines.push(line("Exit too late", l.exitTooLate === null ? "UNKNOWN" : l.exitTooLate));
    lossLines.push(line("Stop-loss hit", l.stopLossHit === null ? "UNKNOWN" : l.stopLossHit));
    lossLines.push(line("Momentum reversed", l.momentumReversed === null ? "UNKNOWN" : l.momentumReversed));
    lossLines.push(line("Volume weakened", l.volumeWeakened === null ? "UNKNOWN" : l.volumeWeakened));
    lossLines.push(line("Spread widened", l.spreadWidened === null ? "UNKNOWN" : l.spreadWidened));
    lossLines.push(line("Suggested fix", l.suggestedFix));
    lossLines.push("");
  }
  return section(
    "SECTION 5 — LOSING TRADE DIAGNOSIS",
    lossLines.length ? lossLines : ["No losing trades."],
  );
}

function buildOpenTradeSection(data: PaperExportData): string {
  const openLines: string[] = [];
  for (const t of data.openTradesWithSnaps) {
    const snap = t.snapshots[0];
    const entry = toNumber(t.entryPrice);
    const mark = snap ? toNumber(snap.markPrice) : entry;
    const unrealized = snap ? toNumber(snap.unrealizedPnl) : null;
    const tp = toNumber(t.plannedTakeProfit);
    const sl = toNumber(t.plannedStopLoss);
    const spreadMatch = t.reason?.match(/spread:\s*([\d.]+)/i);
    const entrySpreadBps = spreadMatch ? parseFloat(spreadMatch[1]) : null;
    const thesisReview =
      entry && mark
        ? evaluateOpenTradeThesisReview({
            side: t.side,
            entryPrice: entry,
            markPrice: mark,
            snapshot: {
              symbol: t.symbol,
              ticker: { last: mark, bid: mark, ask: mark, spreadBps: entrySpreadBps ?? 0 },
              candles5m: [],
              relativeVolume: 1,
            } as NormalizedMarketSnapshot,
            entrySpreadBps,
            hasMarketData: false,
          })
        : {
            status: "UNKNOWN_NEEDS_DATA" as const,
            recommendation: "NEEDS_MORE_DATA" as const,
            reasons: ["Missing entry or mark price"],
          };
    openLines.push(`--- ${t.symbol} ---`);
    openLines.push(line("Strategy version", t.strategyVersion ?? "legacy"));
    openLines.push(line("Entry price", entry));
    openLines.push(line("Current price", mark));
    openLines.push(line("Unrealized P&L (SIM)", unrealized));
    openLines.push(
      line("Distance to TP", entry && tp && mark ? `${(((tp - mark) / entry) * 100).toFixed(2)}%` : "UNKNOWN"),
    );
    openLines.push(
      line("Distance to SL", entry && sl && mark ? `${(((mark - sl) / entry) * 100).toFixed(2)}%` : "UNKNOWN"),
    );
    openLines.push(line("Entry reason", t.reason?.split("|")[0]?.trim() ?? "UNKNOWN"));
    openLines.push(line("Thesis validation", thesisReview.status));
    openLines.push(line("Thesis reasons", thesisReview.reasons.join("; ") || "UNKNOWN"));
    openLines.push(
      line(
        "Recommendation",
        `${thesisReview.recommendation} (paper mode — simulated only)`,
      ),
    );
    openLines.push("");
  }
  return section(
    "SECTION 6 — OPEN TRADE REVIEW",
    openLines.length ? openLines : ["No open trades."],
  );
}

function buildCandidateSection(data: PaperExportData, maxCandidates: number): string {
  const latestRunId = data.runs.at(-1)?.id;
  const runCandidates = latestRunId
    ? data.latestCandidates.filter((c) => c.runId === latestRunId)
    : data.latestCandidates.slice(0, 30);
  const candLines: string[] = [];
  for (const c of runCandidates.slice(0, maxCandidates)) {
    candLines.push(`--- ${c.symbol} ---`);
    candLines.push(line("Score", toNumber(c.opportunityScore)));
    candLines.push(line("Risk tier", c.riskTier));
    candLines.push(line("Volume 24h USD", toNumber(c.volume24hUsd)));
    candLines.push(line("24h move %", toNumber(c.change24hPct)));
    candLines.push(line("Spread bps", toNumber(c.spreadBps)));
    candLines.push(
      line(
        "Recommendation",
        mapCandidateRecommendationLabel({
          action: c.action,
          reasonCode: c.reasonCode,
          tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
        }),
      ),
    );
    candLines.push(line("Reason", c.reasonText));
    candLines.push(line("Kraken tradable", c.tradableOnConfiguredExchange));
    candLines.push("");
  }
  if (runCandidates.length > maxCandidates) {
    candLines.unshift(
      `Showing ${maxCandidates} of ${runCandidates.length} candidates from latest run.`,
      "",
    );
  }
  return section(
    "SECTION 7 — CANDIDATE HISTORY (latest run)",
    candLines.length ? candLines : ["No candidates."],
  );
}

function buildRecordSummaryLines(
  record: SerializedPaperRecord,
  metrics: {
    recordPnl: number | null;
    closedTrades: number;
    winRate: number | null;
    profitFactor: number | null;
    newTradesOpened?: number;
    newOpenTrades?: number;
    carriedOpenTrades?: number;
    newRecordRealizedPnl?: number;
    newRecordUnrealizedPnl?: number;
    carriedPnlSinceCarry?: number;
    startingEquity?: number;
    currentEquity?: number;
    cashBalance?: number;
    activityCounts?: {
      runsCompletedInRecord: number;
      tradesUpdatedInRecord: number;
      candidatesScannedInRecord: number;
      rejectionsInRecord: number;
      carriedTradesMonitored: number;
    };
  },
): string[] {
  const startingEquity =
    metrics.startingEquity ??
    (typeof record.startingPaperBalance === "number"
      ? record.startingPaperBalance
      : toNumber(record.startingPaperBalance as never) ?? 0);
  const recordPnl = metrics.recordPnl ?? 0;
  const resolvedCurrentEquity =
    record.status === "ARCHIVED"
      ? (record.endingPaperBalance ?? startingEquity + recordPnl)
      : metrics.currentEquity ?? startingEquity + recordPnl;

  const lines = [
    recordHeading(record),
    line("Starting equity (SIM)", formatMetric(startingEquity)),
  ];
  if (record.status === "ARCHIVED") {
    lines.push(line("Ending equity (SIM)", formatMetric(record.endingPaperBalance)));
  } else {
    lines.push(line("Current equity (SIM)", formatMetric(resolvedCurrentEquity)));
    if (metrics.cashBalance !== undefined) {
      lines.push(line("Cash balance (SIM)", formatMetric(metrics.cashBalance)));
    }
  }
  lines.push(
    line("Total record P&L (SIM)", formatMetric(metrics.recordPnl)),
    line("Realized P&L — new trades in record (SIM)", formatMetric(metrics.newRecordRealizedPnl ?? 0)),
    line("Unrealized P&L — new trades in record (SIM)", formatMetric(metrics.newRecordUnrealizedPnl ?? 0)),
    line("Carried trade P&L since carry (SIM)", formatMetric(metrics.carriedPnlSinceCarry ?? 0)),
    line("New trades opened in this record", metrics.newTradesOpened ?? 0),
    line("New open trades", metrics.newOpenTrades ?? 0),
    line("Carried open trades", metrics.carriedOpenTrades ?? 0),
    line("Closed new trades in this record", metrics.closedTrades),
    line("Win rate (closed new trades)", metrics.winRate !== null ? `${(metrics.winRate * 100).toFixed(1)}%` : "Not enough data"),
    line("Profit factor (closed new trades)", metrics.profitFactor !== null ? formatMetric(metrics.profitFactor) : "Not enough data"),
    line("Notes", record.notes ?? "none"),
    "",
  );
  if (
    (metrics.newTradesOpened ?? 0) === 0 &&
    (metrics.closedTrades ?? 0) === 0 &&
    (metrics.newOpenTrades ?? 0) === 0 &&
    record.status === "ACTIVE"
  ) {
    lines.splice(lines.length - 1, 0, "Fresh record started. Not enough closed trades yet.");
  }
  if (metrics.activityCounts) {
    lines.splice(
      lines.length - 1,
      0,
      line("Runs completed in this record", metrics.activityCounts.runsCompletedInRecord),
      line("Trades updated in this record", metrics.activityCounts.tradesUpdatedInRecord),
      line("Candidates scanned in this record", metrics.activityCounts.candidatesScannedInRecord),
      line("Rejections in this record", metrics.activityCounts.rejectionsInRecord),
      line("Carried trades monitored", metrics.activityCounts.carriedTradesMonitored),
    );
  }
  return lines;
}

function buildArchivedRecordsSection(data: PaperExportData): string {
  const archived = data.recordHistory.filter((r) => r.status === "ARCHIVED");
  if (archived.length === 0) return section("SECTION 2 — ARCHIVED RECORDS SUMMARY", ["No archived records yet."]);
  const lines: string[] = [];
  for (const record of archived) {
    lines.push(...buildRecordSummaryLines(record, record));
  }
  return section("SECTION 2 — ARCHIVED RECORDS SUMMARY", lines);
}

function buildCurrentRecordLatestRunSection(run: PaperEvidenceRun | undefined): string {
  if (!run) {
    return section("SECTION 2 — CURRENT RECORD LATEST RUN", ["No paper evidence run in this record yet."]);
  }
  const summary = (run.scanSummary ?? {}) as Record<string, unknown>;
  const rejectionSummary = (summary.rejectionSummary ?? {}) as Record<string, number>;
  const rejectionCategories = summarizeRejectionCategories(rejectionSummary);
  const actions = Array.isArray(run.actions) ? (run.actions as string[]) : [];
  return section("SECTION 2 — CURRENT RECORD LATEST RUN", [
    line("Run time", run.startedAt?.toISOString() ?? "UNKNOWN"),
    line("Status", run.status),
    line("Reason code", run.reasonCode),
    line("Latest action", actions.at(-1) ?? run.reasonCode ?? "UNKNOWN"),
    line("Duration ms", run.completedAt && run.startedAt ? run.completedAt.getTime() - run.startedAt.getTime() : "UNKNOWN"),
    line("Opened / updated / closed this run", `${run.tradesOpened} / ${run.tradesUpdated} / ${run.tradesClosed}`),
    line("Candidates / signals / snapshots", `${run.candidatesStored} / ${run.signalsStored} / ${run.snapshotsStored}`),
    line("Discovered / evaluated", `${run.coinsDiscovered ?? "UNKNOWN"} / ${run.coinsEvaluated ?? "UNKNOWN"}`),
    line("High-vol count", run.highVolCount ?? "UNKNOWN"),
    line("Watchlist count", run.watchlistCount ?? "UNKNOWN"),
    line("Realized P&L this run (SIM)", formatMetric(toNumber(summary.realizedPnlThisRun as never))),
    line("Unrealized P&L change this run (SIM)", formatMetric(toNumber(summary.unrealizedPnlChangeThisRun as never))),
    line("Net change this run (SIM)", formatMetric(toNumber(summary.currentRunPnlDelta as never))),
    line("Best decision", run.tradesOpened > 0 ? "OPEN_PAPER_TRADE" : "NO_TRADE_BEST_DECISION"),
    line("Rejection summary", Object.keys(rejectionSummary).length ? JSON.stringify(rejectionSummary) : "none"),
  ]);
}

function buildCurrentRecordBotHealthSection(
  recordRuns: PaperEvidenceRun[],
  active: SerializedPaperRecord | null,
  trades: DbPaperTrade[],
): string {
  if (!active) {
    return section("SECTION 1B — BOT HEALTH CHECK", ["No active record."]);
  }
  const scopedRuns = recordRuns.filter(
    (run) =>
      run.recordId === active.recordId ||
      (!run.recordId && run.startedAt >= new Date(active.startedAt)),
  );
  const latest = scopedRuns.at(-1);
  const recordTrades = trades.filter((t) => t.recordId === active.recordId);
  const carriedOpen = recordTrades.filter(
    (t) => t.status === "OPEN" && t.reason.includes(CARRIED_FROM_PREVIOUS_RECORD),
  ).length;
  const activityCounts = {
    runsCompletedInRecord: scopedRuns.filter((r) => r.status === "COMPLETED").length,
    tradesUpdatedInRecord: scopedRuns.reduce((sum, r) => sum + (r.tradesUpdated ?? 0), 0),
    candidatesScannedInRecord: scopedRuns.reduce((sum, r) => sum + (r.candidatesStored ?? 0), 0),
    rejectionsInRecord: sumRecordRejectionCounts(scopedRuns),
    newTradesOpenedInRecord: recordTrades.filter((t) => isNewRecordTrade(t)).length,
    carriedTradesMonitored: carriedOpen,
  };
  const health = buildRecordBotHealthCheck({
    latestRun: latest
      ? {
          startedAt: latest.startedAt,
          status: latest.status,
          reasonCode: latest.reasonCode,
          tradesUpdated: latest.tradesUpdated ?? 0,
          candidatesStored: latest.candidatesStored ?? 0,
          coinsDiscovered: latest.coinsDiscovered,
        }
      : null,
    activityCounts,
  });
  return section("SECTION 1B — BOT HEALTH CHECK (SIMULATED)", [
    line("Bot working", health.isWorking ? "YES" : "NO"),
    line("Latest run completed", health.latestRunCompleted ? "YES" : "NO"),
    line("Latest run time", health.latestRunTime ?? "UNKNOWN"),
    line("Latest action", latest && Array.isArray(latest.actions) ? (latest.actions as string[]).at(-1) ?? latest.reasonCode : "UNKNOWN"),
    line("Latest reason code", health.currentReason ?? "UNKNOWN"),
    line("Runs completed in this record", health.currentRecordRuns),
    line("Trades updated in this record", health.tradesUpdatedInRecord),
    line("Candidates scanned in this record", activityCounts.candidatesScannedInRecord),
    line("Rejections in this record", health.rejectionsInRecord),
    line("Carried trades monitored", health.carriedTradesMonitored),
    health.plainEnglishSummary,
  ]);
}

function buildCurrentRecordScannerSection(
  run: PaperEvidenceRun | undefined,
  candidates: Awaited<ReturnType<typeof prisma.paperScanCandidate.findMany>>,
): string {
  if (!run) {
    return section("SECTION 3 — CURRENT RECORD SCANNER SUMMARY", ["No scanner data in this record yet."]);
  }
  const summary = (run.scanSummary ?? {}) as Record<string, unknown>;
  const pipeline = (summary.pipeline ?? {}) as Record<string, number>;
  const rejectionSummary = (summary.rejectionSummary ?? {}) as Record<string, number>;
  const rejectionCategories = summarizeRejectionCategories(rejectionSummary);
  const runCandidates = candidates.filter((c) => c.runId === run.id).slice(0, 10);
  const lines = [
    line("Discovered", run.coinsDiscovered ?? pipeline.coinsDiscovered ?? "UNKNOWN"),
    line("Evaluated", run.coinsEvaluated ?? pipeline.deepEvaluated ?? "UNKNOWN"),
    line("Ranked", pipeline.finalCandidates ?? "UNKNOWN"),
    line("High-vol", run.highVolCount ?? pipeline.highVolatilityCandidates ?? "UNKNOWN"),
    line("Watchlist", run.watchlistCount ?? pipeline.watchlistOnlyCandidates ?? "UNKNOWN"),
    line("Bad R:R rejections", rejectionCategories.BAD_RISK_REWARD ?? 0),
    line("Fake-pump watch/rejections", rejectionCategories.FAKE_PUMP ?? 0),
    line("Score too low", rejectionCategories.SCORE_TOO_LOW ?? 0),
    line("Volume too low", rejectionCategories.VOLUME_TOO_LOW ?? 0),
    line("Spread too wide", rejectionCategories.SPREAD_TOO_WIDE ?? 0),
    line("Not tradable", pipeline.removedByExchangeAvailability ?? rejectionCategories.NOT_TRADABLE_ON_EXCHANGE ?? 0),
    "",
    "Top candidates:",
  ];
  if (runCandidates.length === 0) {
    lines.push("No candidates stored for latest run.");
  } else {
    for (const c of runCandidates) {
      lines.push(
        `- ${c.symbol} score ${formatMetric(toNumber(c.opportunityScore))} ${c.action} ${c.reasonCode ?? ""}`,
      );
    }
  }
  return section("SECTION 3 — CURRENT RECORD SCANNER SUMMARY", lines);
}

function buildCurrentRecordOpenTradeReviewSection(data: PaperExportData, markMap: Map<string, number>): string {
  const active = data.activeRecord;
  if (!active) return section("SECTION 6 — CURRENT RECORD OPEN TRADE REVIEW", ["No active record."]);
  const recordTrades = data.trades.filter((t) => t.recordId === active.recordId && t.status === "OPEN");
  if (recordTrades.length === 0) {
    return section("SECTION 6 — CURRENT RECORD OPEN TRADE REVIEW", ["No open trades in this record."]);
  }
  const carriedSnapshots = buildCarriedTradeSnapshots(recordTrades, markMap);
  const lines: string[] = [];
  for (const t of recordTrades) {
    const snap = data.openTradesWithSnaps.find((x) => x.id === t.id)?.snapshots[0];
    const entry = toNumber(t.entryPrice);
    const mark = snap ? toNumber(snap.markPrice) : entry;
    const carried = carriedSnapshots.find((c) => c.tradeId === t.id);
    const thesisReview =
      entry && mark
        ? evaluateOpenTradeThesisReview({
            side: t.side,
            entryPrice: entry,
            markPrice: mark,
            snapshot: {
              symbol: t.symbol,
              ticker: { last: mark, bid: mark, ask: mark, spreadBps: 0 },
              candles5m: [],
              relativeVolume: 1,
            } as NormalizedMarketSnapshot,
            entrySpreadBps: null,
            hasMarketData: false,
          })
        : null;
    lines.push(`--- ${t.symbol} ${t.side} ${isNewRecordTrade(t) ? "(new in record)" : "(carried)"} ---`);
    lines.push(line("Entry price", entry));
    lines.push(line("Current price", mark));
    lines.push(
      line(
        "P&L since record start/carry (SIM)",
        carried?.pnlSinceCarryDisplay ??
          formatMetric(snap ? toNumber(snap.unrealizedPnl) : null),
      ),
    );
    lines.push(line("All-time P&L (SIM)", carried?.allTimeUnrealizedPnl ?? (snap ? toNumber(snap.unrealizedPnl) : null)));
    lines.push(
      line(
        "Distance to TP",
        entry && mark && toNumber(t.plannedTakeProfit)
          ? `${((((toNumber(t.plannedTakeProfit)! - mark) / entry) * 100)).toFixed(2)}%`
          : "UNKNOWN",
      ),
    );
    lines.push(
      line(
        "Distance to SL",
        entry && mark && toNumber(t.plannedStopLoss)
          ? `${((((mark - toNumber(t.plannedStopLoss)!) / entry) * 100)).toFixed(2)}%`
          : "UNKNOWN",
      ),
    );
    lines.push(line("Thesis status", thesisReview?.status ?? "UNKNOWN"));
    lines.push(line("Recommendation", thesisReview?.recommendation ?? "UNKNOWN"));
    lines.push(line("Reason", thesisReview?.reasons.join("; ") || t.reason?.split("|")[0]?.trim() || "UNKNOWN"));
    lines.push("");
  }
  return section("SECTION 6 — CURRENT RECORD OPEN TRADE REVIEW", lines);
}

function buildCurrentRecordRejectionSection(run: PaperEvidenceRun | undefined): string {
  if (!run) {
    return section("SECTION 7 — CURRENT RECORD REJECTION SUMMARY", ["No rejection data in this record yet."]);
  }
  const rejectionSummary = (((run.scanSummary ?? {}) as Record<string, unknown>).rejectionSummary ??
    {}) as Record<string, number>;
  const lines = Object.entries(rejectionSummary).map(([key, count]) => line(key, count));
  return section(
    "SECTION 7 — CURRENT RECORD REJECTION SUMMARY",
    lines.length ? lines : ["No rejections recorded on latest run."],
  );
}

function buildBlueprintExportSection(run: PaperEvidenceRun | undefined): string {
  const summary = (run?.scanSummary ?? {}) as Record<string, unknown>;
  const why = summary.whyNoTradeReport as
    | {
        finalReason?: string;
        exactBlocker?: string;
        blockedBy?: Record<string, number>;
        blueprintStrategyMatchDebug?: {
          vwapReclaimMomentum: { passed: boolean; summary: string; missingConditions: string[] };
          volatilityCompressionBreakout: { passed: boolean; summary: string; missingConditions: string[] };
          trendPullbackContinuation: { passed: boolean; summary: string; missingConditions: string[] };
          missingConditions?: string[];
          finalDecision?: string;
          paperModeSuggestion?: string;
          finalReason?: string;
        };
      }
    | undefined;
  const lines = [
    line("Why no trade opened", why?.finalReason ?? run?.reasonText ?? "—"),
    line("Exact blocker", why?.exactBlocker ?? "—"),
  ];
  if (why?.blockedBy) {
    for (const [k, v] of Object.entries(why.blockedBy)) {
      if (v > 0) lines.push(line(`Blocked ${k}`, v));
    }
  }
  const debug = why?.blueprintStrategyMatchDebug;
  if (debug) {
    lines.push("", "Blueprint Strategy Match Debug:");
    lines.push(...formatBlueprintStrategyMatchDebugLines(debug as never));
  }
  lines.push(line("Paper broker realism", "See dashboard — partial fills/latency NOT_IMPLEMENTED"));
  return section("SECTION 7B — BLUEPRINT ALIGNMENT (SIMULATED)", lines);
}

function buildTradeFrequencyHealthSection(
  recordRuns: PaperEvidenceRun[],
  accounting: CurrentRecordAccounting | null,
): string {
  if (!accounting) {
    return section("SECTION 1C — TRADE FREQUENCY HEALTH", ["No active record accounting."]);
  }
  const scopedRuns = recordRuns;
  const candidatesScanned = scopedRuns.reduce((sum, r) => sum + (r.candidatesStored ?? 0), 0);
  const runsCompleted = scopedRuns.filter((r) => r.status === "COMPLETED").length;
  const health = evaluateTradeFrequencyHealth({
    runsCompleted,
    candidatesScanned,
    candidatesEvaluated: candidatesScanned,
    tradesOpened: accounting.newTradesOpened,
    tradesClosed: accounting.newClosedTrades,
    rejections: sumRecordRejectionCounts(scopedRuns),
    noTradeRuns: scopedRuns.filter((r) => (r.tradesOpened ?? 0) === 0).length,
    averageHoldingHours: null,
    openSlotsUsed: accounting.totalOpenTrades,
    maxOpenSlots: 5,
  });
  const cpo =
    health.candidatesPerOpenedTrade !== null
      ? health.candidatesPerOpenedTrade.toFixed(0)
      : "UNKNOWN";
  return section("SECTION 1C — TRADE FREQUENCY HEALTH (SIMULATED)", [
    line("Candidates scanned in record", candidatesScanned),
    line("Trades opened in record", accounting.newTradesOpened),
    line("Candidates per opened trade", cpo),
    line("Too strict warning", health.tooStrict ? "YES" : "NO"),
    line("Recommendation", health.recommendation),
  ]);
}

function buildCurrentRecordActivitySection(
  runs: PaperEvidenceRun[],
  accounting: CurrentRecordAccounting | null,
): string {
  const feed = buildRecordActivityFeed(
    runs.map((run) => ({
      startedAt: run.startedAt,
      status: run.status,
      reasonCode: run.reasonCode,
      tradesOpened: run.tradesOpened ?? 0,
      tradesUpdated: run.tradesUpdated ?? 0,
      tradesClosed: run.tradesClosed ?? 0,
      scanSummary: run.scanSummary,
    })),
    10,
    accounting
      ? {
          newTradesClosedInRecord: accounting.newClosedTrades,
          carriedTradesClosedInRecord: accounting.carriedClosedTrades,
        }
      : undefined,
  );
  return section(
    "SECTION 8 — CURRENT RECORD ACTIVITY FEED",
    feed.length
      ? feed.map((event) => `[${event.timestamp}] ${event.type}: ${event.summary}`)
      : ["No record-scoped activity yet."],
  );
}

function buildCurrentRecordSection(data: PaperExportData): string {
  const active = data.activeRecord;
  if (!active) {
    return section("SECTION 1 — CURRENT RECORD SUMMARY", ["No active paper record."]);
  }
  const accounting = data.currentRecordAccounting;
  if (!accounting) {
    return section("SECTION 1 — CURRENT RECORD SUMMARY (SIMULATED)", ["Current record accounting unavailable."]);
  }
  const historyRow = data.recordHistory.find((r) => r.recordId === active.recordId);
  const recordRuns = data.runs.filter(
    (run) =>
      run.recordId === active.recordId ||
      (!run.recordId && run.startedAt >= new Date(active.startedAt)),
  );
  const activityCounts = {
    runsCompletedInRecord: recordRuns.filter((r) => r.status === "COMPLETED").length,
    tradesUpdatedInRecord: recordRuns.reduce((sum, r) => sum + (r.tradesUpdated ?? 0), 0),
    candidatesScannedInRecord: recordRuns.reduce((sum, r) => sum + (r.candidatesStored ?? 0), 0),
    rejectionsInRecord: sumRecordRejectionCounts(recordRuns),
    carriedTradesMonitored: accounting.carriedOpenTrades,
  };
  return section("SECTION 1 — CURRENT RECORD SUMMARY (SIMULATED)", [
    line("Record name", active.recordName),
    line("Record number", active.recordNumber),
    line("Strategy version", active.strategyVersion),
    line("Started at", active.startedAt),
    ...buildRecordSummaryLines(active, {
      recordPnl: accounting.totalRecordPnl,
      closedTrades: accounting.newClosedTrades,
      winRate: historyRow?.winRate ?? null,
      profitFactor: historyRow?.profitFactor ?? null,
      newTradesOpened: accounting.newTradesOpened,
      newOpenTrades: accounting.newOpenTrades,
      carriedOpenTrades: accounting.carriedOpenTrades,
      newRecordRealizedPnl: accounting.newRealizedPnl,
      newRecordUnrealizedPnl: accounting.newUnrealizedPnl,
      carriedPnlSinceCarry: accounting.carriedTotalPnl,
      startingEquity: accounting.startingEquity,
      currentEquity: accounting.currentEquity,
      cashBalance: accounting.cashBalance,
      activityCounts,
    }).slice(1),
    "Current equity = starting equity + total record P&L (includes unrealized open-trade P&L).",
    line("Clean Fresh Start available", accounting.cleanFreshStart.available ? "YES" : "NO"),
    accounting.cleanFreshStart.available
      ? accounting.cleanFreshStart.message
      : line(
          "Blocking open trades",
          `${accounting.cleanFreshStart.blockingOpenTradeCount} (${accounting.cleanFreshStart.blockingSymbols.join(", ") || "none"})`,
        ),
  ]);
}

function buildNewRecordTradeLogSection(
  record: SerializedPaperRecord,
  accounting: CurrentRecordAccounting | null,
): string {
  const lines: string[] = [];
  const openTrades = accounting?.newOpenTradeDetails ?? [];
  const closedTrades = accounting?.newClosedTradeDetails ?? [];
  const allTrades = [...openTrades, ...closedTrades];
  if (allTrades.length === 0) {
    lines.push("No new trades opened in this record yet.");
  } else {
    allTrades.forEach((t, i) => {
      lines.push(`--- Trade #${i + 1} ${t.symbol} ${t.side} ${t.status} ---`);
      lines.push(line("Entry time", t.entryTime ?? "UNKNOWN"));
      lines.push(line("Entry price", formatMetric(t.entryPrice)));
      lines.push(line("Current price", formatMetric(t.currentPrice)));
      lines.push(line("Quantity", formatMetric(t.quantity)));
      lines.push(line("Unrealized P&L (SIM)", formatMetric(t.unrealizedPnl)));
      lines.push(line("Realized P&L (SIM)", formatMetric(t.realizedPnl)));
      lines.push(line("P&L since record start (SIM)", formatMetric(t.recordPnlSinceStart)));
      lines.push(line("Strategy", t.strategyName));
      lines.push(line("Thesis status", t.thesisStatus));
      lines.push(line("Distance to TP", t.distanceToTpPct !== null ? `${t.distanceToTpPct}%` : "UNKNOWN"));
      lines.push(line("Distance to SL", t.distanceToSlPct !== null ? `${t.distanceToSlPct}%` : "UNKNOWN"));
      if (t.exitReason) lines.push(line("Exit reason", t.exitReason));
      lines.push("");
    });
  }
  return section("SECTION 4 — NEW TRADES IN THIS RECORD", lines);
}

function buildCarriedTradesExportSection(
  record: SerializedPaperRecord,
  trades: DbPaperTrade[],
  markMap: Map<string, number>,
): string {
  const carried = buildCarriedTradeSnapshots(
    trades.filter((t) => t.recordId === record.recordId),
    markMap,
  );
  if (carried.length === 0) {
    return section("SECTION 5 — CARRIED OPEN TRADES", ["No carried open trades in this record."]);
  }
  const lines: string[] = [];
  for (const t of carried) {
    lines.push(`--- ${t.symbol} ${t.side} ---`);
    lines.push(line("Original entry time", t.originalEntryTime));
    lines.push(line("Carried into record", t.carriedIntoRecordTime));
    lines.push(line("Entry price", formatMetric(t.entryPrice)));
    lines.push(line("Current price", formatMetric(t.currentPrice)));
    lines.push(line("P&L since carried into this record (SIM)", t.pnlSinceCarryDisplay));
    if (t.legacyBaselineMissing) {
      lines.push(line("Data quality", LEGACY_CARRY_BASELINE_MISSING_MESSAGE));
    }
    lines.push(line("All-time P&L from this trade (SIM)", formatMetric(t.allTimeUnrealizedPnl)));
    lines.push(line("Status", t.status));
    lines.push("");
  }
  return section("SECTION 5 — CARRIED OPEN TRADES", lines);
}

function buildCarriedClosedTradesExportSection(
  record: SerializedPaperRecord,
  trades: DbPaperTrade[],
  markMap: Map<string, number>,
): string {
  const carried = splitRecordTrades(trades.filter((t) => t.recordId === record.recordId)).carried;
  const closed = buildCarriedClosedTradeSnapshots(carried, markMap);
  if (closed.length === 0) {
    return section("SECTION 5b — CARRIED CLOSED TRADES", ["No carried closed trades in this record."]);
  }
  const lines: string[] = [];
  for (const t of closed) {
    lines.push(`--- ${t.symbol} ${t.side} ---`);
    lines.push(line("Original entry time", t.originalEntryTime));
    lines.push(line("Carried into record", t.carriedIntoRecordTime));
    lines.push(line("Exit time", t.exitTime));
    lines.push(line("P&L since carry (SIM)", t.pnlSinceCarryDisplay));
    lines.push(line("All-time P&L (SIM)", formatMetric(t.allTimePnl)));
    lines.push(line("Exit reason", t.exitReason ?? "UNKNOWN"));
    lines.push(line("Thesis status", t.thesisStatus));
    lines.push(line("Counts toward total record P&L", t.countsTowardRecordPnl ? "YES" : "NO"));
    lines.push("");
  }
  lines.push("CARRIED TRADE P&L SUMMARY:");
  const totalSinceCarry = closed.reduce((s, t) => s + (t.pnlSinceCarry ?? 0), 0);
  lines.push(line("Total carried closed P&L since carry (SIM)", formatMetric(totalSinceCarry)));
  return section("SECTION 5b — CARRIED CLOSED TRADES", lines);
}

function buildRecordComparisonSection(data: PaperExportData): string {
  const c = data.recordComparison;
  return section("SECTION 5 — RECORD COMPARISON", [
    line("Best record by P&L", c.bestByPnl ? `#${c.bestByPnl.recordNumber} ${c.bestByPnl.recordName}` : "UNKNOWN"),
    line("Best record by profit factor", c.bestByProfitFactor ? `#${c.bestByProfitFactor.recordNumber}` : "UNKNOWN"),
    line("Best win rate", c.bestWinRate ? `#${c.bestWinRate.recordNumber}` : "UNKNOWN"),
    "",
    "VERDICT:",
    c.plainEnglishVerdict,
  ]);
}

function buildRecordTradeLogSection(
  record: SerializedPaperRecord,
  trades: DbPaperTrade[],
): string {
  const newTrades = trades.filter((t) => t.recordId === record.recordId && isNewRecordTrade(t));
  const lines: string[] = [recordHeading(record)];
  if (newTrades.length === 0) {
    lines.push("No new trades opened in this record yet.");
  } else {
    newTrades.forEach((t, i) => {
      const row = buildTradeHistoryRow(t, i + 1);
      lines.push(`Trade #${i + 1} ${row.coin} ${row.finalResult} ${row.netPnl ?? "UNKNOWN"} SIM`);
    });
  }
  return section(`TRADE LOG — RECORD #${record.recordNumber}`, lines);
}

function buildSafePathExportSection(data: PaperExportData): string {
  return section("SECTION 8 — SAFE PATH / SAME-DAY REALITY CHECK", [
    "These are safety checks — not current record performance.",
    line("Same-day proof available", "NOT_ENOUGH_DATA"),
    line("Paper-forward evidence available", data.unlock.autoExecutionEnabled ? "PASS" : "NOT_CONFIGURED"),
    line("Shadow evidence available", "NOT_CONFIGURED"),
    line("Backtest evidence", "NOT_ENOUGH_DATA"),
    line("Tiny-live canary evidence", "NOT_CONFIGURED"),
    line("Reconciled live sample", "NOT_CONFIGURED"),
    line("DO_NOT_TRADE_LIVE status", "DO_NOT_TRADE_LIVE"),
    line("Live trading locked", data.safety.liveTradingLocked ? "YES" : "UNKNOWN"),
    line("Auto execution locked", data.safety.autoExecutionLocked ? "YES" : "UNKNOWN"),
  ]);
}

function buildDataQualitySection(data: PaperExportData): string {
  const riskCfg = serializePaperRiskConfig();
  const active = data.activeRecord;
  const carriedMissingBaseline = data.trades.some(
    (t) =>
      t.recordId === active?.recordId &&
      t.status === "OPEN" &&
      t.reason.includes(CARRIED_FROM_PREVIOUS_RECORD) &&
      (t.carriedBaselineUnrealizedPnl === null || t.carriedBaselineUnrealizedPnl === undefined),
  );
  return section("SECTION 9 — DATA QUALITY NOTES", [
    line("Active record", active ? `#${active.recordNumber} ${active.recordName}` : "UNKNOWN"),
    line("Real market data", DATA_TRUTH.realMarketData().detail),
    line("Simulated paper trades", DATA_TRUTH.simulatedPaperTrade().detail),
    line("Simulated P&L", DATA_TRUTH.simulatedPnl().detail),
    line("Max allowed risk-at-stop %", riskCfg.maxTotalExposurePercent),
    line("Max allowed daily risk used %", riskCfg.maxDailyLossPercent),
    carriedMissingBaseline ? LEGACY_CARRY_BASELINE_MISSING_MESSAGE : "Carried trade baselines present.",
    "No API secrets are included in this export.",
    "Live trading remains LOCKED. Auto remains LOCKED.",
    data.safety.checks
      .filter((c) => !c.passed)
      .map((c) => `Check failed: ${c.id} — ${c.note}`)
      .join("\n") || "All safety checks passed.",
  ]);
}

function buildImprovementSection(data: PaperExportData): string {
  const { performance } = data;
  const weakness =
    performance.losses > performance.wins
      ? "Win rate below 50% — review entry filters and stop placement."
      : performance.totalClosedTrades < 10
        ? "Insufficient closed trade sample — keep collecting paper evidence."
        : "Monitor drawdown and correlation exposure.";
  const strength =
    performance.totalNetPnl > 0
      ? "Positive simulated net P&L so far (not proof of live edge)."
      : "Disciplined paper-only execution with live trading locked.";

  return section("SECTION 10 — NEXT IMPROVEMENT QUESTIONS", [
    line("Biggest current weakness", weakness),
    line("Biggest current strength", strength),
    line("Needs more data", performance.totalClosedTrades < 30 ? "yes — more closed trades" : "moderate"),
    line("Tune next", "Entry score thresholds, stop/take-profit tiers, capacity limits"),
    line("Do not change yet", "Live trading lock, Auto lock, real order wiring"),
  ]);
}

function buildPaperDiagnosticsExportSection(runs: PaperEvidenceRun[]): string {
  const latest = [...runs].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  )[0];
  if (!latest) {
    return section("PAPER RUN DIAGNOSTICS (SIMULATED)", ["No paper runs available."]);
  }
  const summary = (latest.scanSummary ?? {}) as Record<string, unknown>;
  const diagnostics = summary.paperRunDiagnostics as PaperRunDiagnostics | undefined;
  if (!diagnostics) {
    return section("PAPER RUN DIAGNOSTICS (SIMULATED)", [
      "Diagnostics not stored for latest run — execute a new paper scan after upgrade.",
    ]);
  }
  return section("PAPER RUN DIAGNOSTICS (SIMULATED)", formatDiagnosticsExportLines(diagnostics));
}

function buildExportSections(data: PaperExportData): string[] {
  const parts: string[] = [];
  parts.push("ALPHA AUTOPILOT PAPER RECORD EXPORT");
  parts.push(...buildExportHeader(data));

  if (data.recordId) {
    const record =
      data.recordHistory.find((r) => r.recordId === data.recordId) ??
      (data.activeRecord?.recordId === data.recordId ? data.activeRecord : null);
    if (record) {
      const historyMetrics = data.recordHistory.find((r) => r.recordId === record.recordId);
      const accounting =
        data.currentRecordAccounting?.recordId === record.recordId
          ? data.currentRecordAccounting
          : null;
      const metrics = accounting
        ? {
            recordPnl: accounting.totalRecordPnl,
            closedTrades: accounting.newClosedTrades,
            winRate: historyMetrics?.winRate ?? null,
            profitFactor: historyMetrics?.profitFactor ?? null,
            newTradesOpened: accounting.newTradesOpened,
            newOpenTrades: accounting.newOpenTrades,
            carriedOpenTrades: accounting.carriedOpenTrades,
            startingEquity: accounting.startingEquity,
            currentEquity: accounting.currentEquity,
          }
        : (historyMetrics ?? {
            recordPnl: 0,
            closedTrades: 0,
            winRate: null,
            profitFactor: null,
          });
      parts.push(
        section(`RECORD #${record.recordNumber} — ${record.recordName}`, [
          ...buildRecordSummaryLines(record, metrics),
        ]),
      );
      parts.push(buildRecordTradeLogSection(record, data.trades));
      parts.push(buildDataQualitySection(data));
      parts.push("\n--- END OF REPORT ---\nREMINDER: SIMULATED PAPER ONLY");
      return parts;
    }
  }

  if (data.mode === "CURRENT_RECORD_EXPORT") {
    const activeRecordRow = data.activeRecord;
    const recordRuns = activeRecordRow
      ? data.runs.filter(
          (run) =>
            run.recordId === activeRecordRow.recordId ||
            (!run.recordId && run.startedAt >= new Date(activeRecordRow.startedAt)),
        )
      : data.runs;
    const latestRecordRun = recordRuns.at(-1);
    parts.push(buildCurrentRecordSection(data));
    if (data.activeRecord) {
      const markMap = new Map<string, number>();
      for (const t of data.openTradesWithSnaps) {
        const snap = t.snapshots[0];
        const mark = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
        if (mark !== null) markMap.set(t.id, mark);
      }
      parts.push(buildCurrentRecordBotHealthSection(recordRuns, data.activeRecord, data.trades));
      parts.push(buildTradeFrequencyHealthSection(recordRuns, data.currentRecordAccounting));
      parts.push(buildCurrentRecordLatestRunSection(latestRecordRun));
      parts.push(buildCurrentRecordScannerSection(latestRecordRun, data.latestCandidates));
      parts.push(buildCurrentRecordRejectionSection(latestRecordRun));
      parts.push(buildBlueprintExportSection(latestRecordRun));
      parts.push(buildNewRecordTradeLogSection(data.activeRecord, data.currentRecordAccounting));
      parts.push(buildCarriedTradesExportSection(data.activeRecord, data.trades, markMap));
      parts.push(buildCarriedClosedTradesExportSection(data.activeRecord, data.trades, markMap));
      parts.push(buildCurrentRecordOpenTradeReviewSection(data, markMap));
      parts.push(buildCurrentRecordActivitySection(recordRuns, data.currentRecordAccounting));
      parts.push(buildSystemStatusSection(data));
      parts.push(buildSafePathExportSection(data));
    }
    parts.push(buildDataQualitySection(data));
    parts.push("\n--- END OF REPORT ---\nREMINDER: SIMULATED PAPER ONLY");
    return parts;
  }

  if (data.mode === "ARCHIVED_RECORDS_EXPORT") {
    parts.push(buildArchivedRecordsSection(data));
    const archived = data.recordHistory.filter((r) => r.status === "ARCHIVED");
    for (const record of archived) {
      parts.push(buildRecordTradeLogSection(record, data.trades));
    }
    parts.push(buildDataQualitySection(data));
    parts.push("\n--- END OF REPORT ---\nREMINDER: SIMULATED PAPER ONLY");
    return parts;
  }

  if (data.mode === "ALL_RECORDS_EXPORT") {
    parts.push(buildCurrentRecordSection(data));
    parts.push(buildArchivedRecordsSection(data));
    if (data.activeRecord) {
      parts.push(buildRecordTradeLogSection(data.activeRecord, data.trades));
    }
    for (const record of data.recordHistory.filter((r) => r.status === "ARCHIVED")) {
      parts.push(buildRecordTradeLogSection(record, data.trades));
    }
    parts.push(buildRecordComparisonSection(data));
    parts.push(buildDataQualitySection(data));
    parts.push("\n--- END OF REPORT ---\nREMINDER: SIMULATED PAPER ONLY");
    return parts;
  }

  parts.push(simpleSummaryLines(data.performance).join("\n"));
  parts.push(buildSystemStatusSection(data));
  parts.push(buildCurrentRecordSection(data));
  parts.push(buildPaperDiagnosticsExportSection(data.runs));
  parts.push(buildArchivedRecordsSection(data));

  if (data.mode !== "SUMMARY_EXPORT") {
    parts.push(
      section(
        "SECTION 3 — RUN HISTORY",
        buildRunHistorySection(data.runs, data.mode),
      ),
    );
    parts.push(buildTradeHistorySection(data.trades));
    parts.push(buildOpenTradeSection(data));
  }

  if (data.mode === "FULL_DEBUG_EXPORT") {
    parts.push(buildLossDiagnosisSection(data));
    parts.push(buildCandidateSection(data, data.latestCandidates.length > 0 ? DEFAULT_MAX_CANDIDATES : 0));

    const ruleLines: string[] = [];
    for (const g of data.activeRules.groups) {
      ruleLines.push(`[${g.title}]`);
      for (const r of g.rules) ruleLines.push(`  - ${r}`);
    }
    ruleLines.push(`Deep evaluation limit: SCANNER_MAX_EVALUATED_COINS=${SCANNER_CONFIG.maxEvaluatedCoins}`);
    ruleLines.push(...data.activeRules.safetyCaps.map((c) => `Safety: ${c}`));
    parts.push(section("SECTION 8 — ACTIVE RULES SNAPSHOT", ruleLines));
    parts.push(buildImprovementSection(data));
  }

  parts.push(buildDataQualitySection(data));
  parts.push(
    "\n--- END OF REPORT ---",
    "REMINDER: SIMULATED PAPER ONLY — NOT REAL TRADING PROFIT",
  );
  return parts;
}

export async function buildPaperExportLog(ctx: PaperExportContext): Promise<string> {
  const data = await loadPaperExportData(ctx);
  return buildExportSections(data).join("\n");
}

export async function* streamPaperExportLog(ctx: PaperExportContext): AsyncGenerator<string> {
  const data = await loadPaperExportData(ctx);
  for (const part of buildExportSections(data)) {
    yield part.endsWith("\n") ? part : `${part}\n`;
  }
}

export function paperExportFilename(date = new Date(), mode: PaperExportMode = DEFAULT_PAPER_EXPORT_MODE): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const modeSlug = mode === DEFAULT_PAPER_EXPORT_MODE ? "trade-log" : mode.toLowerCase().replace(/_/g, "-");
  return `alpha-autopilot-paper-${modeSlug}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}.txt`;
}
