import type {
  PaperTradeResult,
  PaperTradeSide,
  PaperTrade as DbPaperTrade,
} from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { resolveUserId } from "@/lib/security/auth";
import { getMarketSnapshot } from "@/lib/trading/data";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import {
  applyEntryCosts,
  applyExitCosts,
  grossPnl,
} from "@/lib/trading/research/cost-model";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { getMarketDataProviderStatus } from "@/lib/trading/paper/safe-check";
import { evaluatePaperForwardEvidence } from "@/lib/trading/paper/evidence-requirements";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import {
  buildPaperSymbolUniverse,
  type UniverseTickerRow,
} from "@/lib/trading/paper/kraken-universe";
import { buildWideUniverse, type WideUniverseResult } from "@/lib/trading/paper/wide-universe";
import { SCANNER_CONFIG, validateScannerConfig } from "@/lib/trading/paper/scanner-config";
import {
  buildScanCandidate,
  buildScanCandidateFromTiered,
  dedupeScanCandidates,
  mapWithConcurrency,
  quickScoreFromTiered,
  rankCandidates,
  splitCandidates,
  summarizeRejections,
  type ScanCandidate,
} from "@/lib/trading/paper/opportunity-scanner";
import {
  evaluateControlledActiveStrategy,
  PAPER_TRADE_EXPIRY_HOURS,
} from "@/lib/trading/paper/controlled-active-strategy";
import {
  checkPaperPrismaClientHealth,
  confirmPaperModelsAccessible,
  isPrismaStaleError,
  recordPaperDbWriteError,
  recordPaperSuccessfulWrite,
  STALE_PRISMA_MESSAGE,
  getLastSuccessfulDbWriteAt,
} from "@/lib/trading/paper/prisma-health";
import {
  classifyRunStatus,
  computePaperEvidenceCountTotal,
  detectRunContradiction,
  resolveRunReasonCode,
  type PaperEvidenceCountSnapshot,
} from "@/lib/trading/paper/run-diagnostics";
import {
  prepareCandidateWriteData,
  classifyCandidateWriteError,
} from "@/lib/trading/paper/candidate-write";
import {
  computeOpenTradeCapacityView,
  decideCapacityForCandidate,
  type OpenTradeCapacityView,
} from "@/lib/trading/paper/paper-capacity";
import { PAPER_ROTATION_CONFIG, rotationWarning, serializeRotationConfig } from "@/lib/trading/paper/paper-rotation-config";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import { buildFinalCandidateOutput } from "@/lib/trading/paper/candidate-output";
import {
  enrichRankedCandidates,
  buildRunProviderContributions,
  emptyProviderContribution,
} from "@/lib/trading/paper/provider-contribution";
import { buildScannerProviderStatus, vaultHintsFromCredentials } from "@/lib/trading/paper/scanner-provider-status";
import { listProviderCredentials } from "@/lib/vault/store";
import { buildPaperTradeHistory } from "@/lib/trading/paper/trade-history";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import {
  evaluateThesisInvalidation,
  evaluateOpenTradeThesisReview,
  mapLegacyCloseReason,
  formatThesisExitLabel,
  type PaperExitReason,
} from "@/lib/trading/paper/thesis-invalidation";
import { evaluateBlueprintExit, type BlueprintExitReason } from "@/lib/trading/paper/blueprint-exit-engine";
import { evaluateProfitLockState, evaluateRecordProfitLock } from "@/lib/trading/paper/profit-lock-engine";
import { evaluateOpportunityCost } from "@/lib/trading/paper/opportunity-cost-engine";
import { buildWhyNoTradeReport } from "@/lib/trading/paper/why-no-trade-report";
import { buildPaperRunDiagnostics } from "@/lib/trading/paper/paper-diagnostics";
import {
  buildNoTradeDiagnosticRow,
  emptyTinyBExecutionSummary,
  finalizeTinyBExecutionNote,
  mapStrategyLayerBlockToTinyBReason,
  resolveTinyBExecutionBlocker,
  type TinyBExecutionSummary,
} from "@/lib/trading/paper/tiny-b-execution";
import { evaluateTradeFrequencyHealth } from "@/lib/trading/paper/trade-frequency-health";
import { buildPaperBrokerRealismStatus } from "@/lib/trading/paper/paper-broker-realism";
import { mapStrategyForCandidate } from "@/lib/trading/paper/strategy-mapping";
import {
  canOpenPaperTrade,
  evaluatePaperDecision,
  passedHardSafetyFilters,
  summarizePipelineCounts,
} from "@/lib/trading/paper/paper-decision-pipeline";
import { minScoreForTier, resolveCandidateBlockReason } from "@/lib/trading/paper/trade-selection";
import { explainLosingTrade } from "@/lib/trading/paper/risk-explanation";
import { PAPER_RISK_CONFIG, serializePaperRiskConfig } from "@/lib/trading/paper/paper-risk-config";
import { buildActiveTradingRules } from "@/lib/trading/paper/active-trading-rules";
import { analyzeLosingTrades, buildTradeLossAuditReport } from "@/lib/trading/paper/loss-analysis";
import { DATA_TRUTH } from "@/lib/trading/paper/data-truth";
import {
  resolveEffectiveMaxOpenTrades,
  countCorrelatedTrades,
} from "@/lib/trading/paper/dynamic-capacity";
import {
  buildPaperPerformanceSummary,
  computePortfolioSnapshot,
  computeRunPnlDelta,
  buildDeepEvaluationExplanation,
} from "@/lib/trading/paper/performance-summary";
import {
  buildProfitQualitySummary,
  diagnoseTradeHistory,
  evaluateRecordCautionMode,
  noTradeBestDecisionMessage,
} from "@/lib/trading/paper/profit-protection";
import {
  mapCandidateRecommendationLabel,
  mapCandidateRunDisplayLabel,
  mapPaperRunActionToExecution,
  summarizeRejectionCategories,
} from "@/lib/trading/paper/paper-labels";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { computeOpenExposureMetrics } from "@/lib/trading/paper/exposure-metrics";
import {
  buildCarriedTradeSnapshots,
  buildRecordActivityFeed,
  buildRecordBotHealthCheck,
  buildRecordComparison,
  buildRecordHistoryRows,
  buildRecordMetrics,
  buildRecordScopedCandidateWhere,
  buildRecordScopedRunWhere,
  ensurePaperRecords,
  getActivePaperRecord,
  isCarriedTrade,
  recordHeading,
  serializePaperRecord,
  splitRecordTrades,
  sumRecordRejectionCounts,
  type RecordScopedEntity,
} from "@/lib/trading/paper/paper-record";
import { computeCarriedTradeStats } from "@/lib/trading/paper/record-accounting";

export type PaperRunAction =
  | "PAPER_TRADE_OPENED"
  | "PAPER_TRADE_UPDATED"
  | "PAPER_TRADE_CLOSED"
  | "PAPER_TRADE_SKIPPED_MAX_OPEN"
  | "PAPER_TRADE_SKIPPED_NO_SLOT"
  | "PAPER_TRADE_SKIPPED_RISK"
  | "TRADE_OPENED"
  | "TRADE_UPDATED"
  | "TRADE_CLOSED"
  | "TRADE_UPDATED_MAX_OPEN_REACHED"
  | "PAPER_ROTATION_EXIT"
  | "MISSED_OPPORTUNITY"
  | "NO_TRADE"
  | "MARKET_DATA_FAILED"
  | "MARKET_DATA_PARTIAL";

export type MarketSnapshotFetcher = (symbol: string) => Promise<NormalizedMarketSnapshot>;

async function resolvePaperUserId(): Promise<string> {
  try {
    return await resolveUserId();
  } catch {
    const { getOrCreateSystemUser } = await import("@/lib/trading/mode-service");
    return getOrCreateSystemUser();
  }
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

async function resolveLatestRunPnlFromDb(
  userId: string,
  run: { startedAt: Date; completedAt: Date | null },
  scanSummary: Record<string, unknown>,
): Promise<{
  realizedPnlThisRun: number | null;
  unrealizedPnlChangeThisRun: number | null;
  netChangeThisRun: number | null;
  pnlSource: "scan_summary" | "computed_from_snapshots" | "unavailable";
}> {
  const existingRealized = toNumber(scanSummary.realizedPnlThisRun as never);
  const existingUnrealized = toNumber(scanSummary.unrealizedPnlChangeThisRun as never);
  const existingNet =
    toNumber(scanSummary.currentRunPnlDelta as never) ??
    toNumber(scanSummary.netPnlDeltaThisRun as never);
  if (
    existingRealized !== null &&
    existingUnrealized !== null &&
    existingNet !== null
  ) {
    return {
      realizedPnlThisRun: existingRealized,
      unrealizedPnlChangeThisRun: existingUnrealized,
      netChangeThisRun: existingNet,
      pnlSource: "scan_summary",
    };
  }

  const runEnd = run.completedAt ?? run.startedAt;
  const allTrades = await prisma.paperTrade.findMany({ where: { userId } });
  const snapsBefore = await prisma.paperTradeSnapshot.findMany({
    where: { trade: { userId }, capturedAt: { lt: run.startedAt } },
    orderBy: { capturedAt: "desc" },
  });
  const marksBefore = new Map<string, number>();
  for (const snap of snapsBefore) {
    if (!marksBefore.has(snap.tradeId)) {
      const mark = toNumber(snap.markPrice);
      if (mark !== null) marksBefore.set(snap.tradeId, mark);
    }
  }
  for (const trade of allTrades) {
    if (trade.status === "OPEN" && !marksBefore.has(trade.id)) {
      const mark = toNumber(trade.entryPrice);
      if (mark !== null) marksBefore.set(trade.id, mark);
    }
  }

  const snapsDuring = await prisma.paperTradeSnapshot.findMany({
    where: {
      trade: { userId },
      capturedAt: { gte: run.startedAt, lte: runEnd },
    },
    orderBy: { capturedAt: "desc" },
  });
  const marksAfter = new Map(marksBefore);
  for (const snap of snapsDuring) {
    const mark = toNumber(snap.markPrice);
    if (mark !== null) marksAfter.set(snap.tradeId, mark);
  }
  const openWithSnaps = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  for (const trade of openWithSnaps) {
    const snap = trade.snapshots[0];
    if (snap && snap.capturedAt >= run.startedAt && snap.capturedAt <= runEnd) {
      const mark = toNumber(snap.markPrice);
      if (mark !== null) marksAfter.set(trade.id, mark);
    }
  }

  const portfolioBefore = computePortfolioSnapshot(allTrades, marksBefore);
  const portfolioAfter = computePortfolioSnapshot(allTrades, marksAfter);
  const closedThisRun = allTrades.filter(
    (t) =>
      (t.status === "CLOSED" || t.status === "EXPIRED") &&
      t.closedAt &&
      t.closedAt >= run.startedAt &&
      t.closedAt <= runEnd,
  );
  const realizedPnlThisRun = closedThisRun.reduce(
    (sum, t) => sum + (toNumber(t.netPaperPnl) ?? 0),
    0,
  );
  const runPnlDelta = computeRunPnlDelta(portfolioBefore, portfolioAfter, realizedPnlThisRun);
  return {
    realizedPnlThisRun: runPnlDelta.realizedPnlThisRun,
    unrealizedPnlChangeThisRun: runPnlDelta.unrealizedPnlChangeThisRun,
    netChangeThisRun: runPnlDelta.netPnlDeltaThisRun,
    pnlSource: "computed_from_snapshots",
  };
}

function parseSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
  const [baseAsset, quoteAsset] = symbol.split("/");
  return { baseAsset: baseAsset ?? symbol, quoteAsset: quoteAsset ?? "USD" };
}

function directionFromSide(side: PaperTradeSide): "long" | "short" {
  return side === "SHORT" ? "short" : "long";
}

function computeClosePnl(input: {
  side: PaperTradeSide;
  entryPrice: number;
  exitPrice: number;
  size: number;
}): { gross: number; fees: number; slippage: number; net: number; fillExit: number } {
  const dir = directionFromSide(input.side);
  const entry = applyEntryCosts(input.entryPrice, dir, input.size, DEFAULT_FEE_MODEL);
  const exit = applyExitCosts(input.exitPrice, dir, input.size, DEFAULT_FEE_MODEL, true);
  const gross = grossPnl(dir, entry.fillPrice, exit.fillPrice, input.size);
  const fees = entry.fee + exit.fee;
  const slippage = entry.slippage + exit.slippage;
  return { gross, fees, slippage, net: gross - fees - slippage, fillExit: exit.fillPrice };
}

function classifyResult(net: number): PaperTradeResult {
  if (net > 0.0001) return "WIN";
  if (net < -0.0001) return "LOSS";
  return "BREAKEVEN";
}

function momentumFromSnapshot(snapshot: NormalizedMarketSnapshot): number {
  const candles = snapshot.candles5m;
  if (candles.length < 6) return 0;
  const recent = candles.slice(-6);
  const first = recent.slice(0, 3).reduce((s, c) => s + c.close, 0) / 3;
  const second = recent.slice(3).reduce((s, c) => s + c.close, 0) / 3;
  if (first <= 0) return 0;
  return ((second - first) / first) * 100;
}

async function updateOpenTrade(
  trade: DbPaperTrade,
  markPrice: number,
  now: Date,
  snapshot?: NormalizedMarketSnapshot,
  options?: {
    runsHeld?: number;
    peakUnrealizedPnl?: number;
    bestCandidate?: ScanCandidate | null;
  },
): Promise<{
  action: PaperRunAction;
  trade: DbPaperTrade;
  snapshotStored: boolean;
  snapshotError?: string;
  exitReason?: PaperExitReason;
}> {
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  const stop = toNumber(trade.plannedStopLoss);
  const tp = toNumber(trade.plannedTakeProfit);

  if (entry === null || size === null || size <= 0) {
    return { action: "TRADE_UPDATED", trade, snapshotStored: false };
  }

  const dir = directionFromSide(trade.side);
  const unrealized =
    dir === "long" ? (markPrice - entry) * size : (entry - markPrice) * size;

  try {
    await prisma.paperTradeSnapshot.create({
      data: {
        tradeId: trade.id,
        recordId: trade.recordId,
        strategyVersion: trade.strategyVersion ?? CURRENT_PAPER_STRATEGY_VERSION,
        markPrice,
        unrealizedPnl: unrealized,
        capturedAt: now,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
    return {
      action: "TRADE_UPDATED",
      trade,
      snapshotStored: false,
      snapshotError: isPrismaStaleError(msg) ? STALE_PRISMA_MESSAGE : msg,
    };
  }

  let shouldClose = false;
  let exitPrice = markPrice;
  let closeReason: PaperExitReason | "TRADE_UPDATED" = "TRADE_UPDATED";

  if (trade.openedAt) {
    const ageHours = (now.getTime() - trade.openedAt.getTime()) / 3_600_000;
    if (ageHours >= PAPER_TRADE_EXPIRY_HOURS) {
      shouldClose = true;
      closeReason = "EXPIRY_EXIT";
    }
  }

  if (!shouldClose && stop !== null && tp !== null) {
    if (trade.side === "LONG") {
      if (markPrice <= stop) {
        shouldClose = true;
        exitPrice = stop;
        closeReason = "STOP_LOSS_HIT";
      } else if (markPrice >= tp) {
        shouldClose = true;
        exitPrice = tp;
        closeReason = "TAKE_PROFIT_HIT";
      }
    } else if (trade.side === "SHORT") {
      if (markPrice >= stop) {
        shouldClose = true;
        exitPrice = stop;
        closeReason = "STOP_LOSS_HIT";
      } else if (markPrice <= tp) {
        shouldClose = true;
        exitPrice = tp;
        closeReason = "TAKE_PROFIT_HIT";
      }
    }
  }

  let riskExplanation: string | null = null;

  const hasMarketData = Boolean(snapshot && snapshot.candles5m.length >= 3);
  const thesisReview =
    snapshot && entry !== null
      ? evaluateOpenTradeThesisReview({
          side: trade.side,
          entryPrice: entry,
          markPrice,
          snapshot,
          hasMarketData,
          dataSource: snapshot.source ?? "kraken",
        })
      : null;

  const profitLock = evaluateProfitLockState({
    side: trade.side === "SHORT" ? "SHORT" : "LONG",
    entryPrice: entry,
    markPrice,
    plannedTakeProfit: tp,
    currentUnrealizedPnl: unrealized,
    peakUnrealizedPnl: options?.peakUnrealizedPnl,
  });

  const blueprintExit = evaluateBlueprintExit({
    side: trade.side,
    entryPrice: entry,
    markPrice,
    plannedStopLoss: stop,
    plannedTakeProfit: tp,
    openedAt: trade.openedAt ?? now,
    now,
    runsHeld: options?.runsHeld ?? 1,
    snapshot: snapshot ?? null,
    hasMarketData,
    thesisStatus: thesisReview?.status ?? "UNKNOWN_NEEDS_DATA",
    thesisRecommendation: thesisReview?.recommendation ?? "NEEDS_MORE_DATA",
    unrealizedPnl: unrealized,
    peakUnrealizedPnl: profitLock.peakUnrealizedPnl,
    profitLock,
  });

  const oppCost = evaluateOpportunityCost({
    openTrade: {
      symbol: trade.symbol,
      side: trade.side === "SHORT" ? "SHORT" : "LONG",
      entryPrice: entry,
      markPrice,
      unrealizedPnl: unrealized,
      tpProgressPct: blueprintExit.distanceToTpPct,
      thesisStatus: thesisReview?.status ?? "UNKNOWN_NEEDS_DATA",
      staleTrade: blueprintExit.staleTrade,
      ageHours: trade.openedAt
        ? (now.getTime() - trade.openedAt.getTime()) / 3_600_000
        : 0,
      capitalLockedUsd: Math.abs(entry * size),
      opportunityScoreAtEntry: null,
    },
    bestCandidate: options?.bestCandidate ?? null,
  });

  if (!shouldClose && (blueprintExit.shouldExit || oppCost.shouldExitForBetterSetup)) {
    shouldClose = true;
    exitPrice = blueprintExit.exitPrice ?? markPrice;
    closeReason = (oppCost.shouldExitForBetterSetup
      ? "OPPORTUNITY_COST_EXIT"
      : blueprintExit.exitReason ?? "TRUE_INVALIDATION_EXIT") as PaperExitReason;
    riskExplanation = oppCost.shouldExitForBetterSetup
      ? oppCost.summary
      : blueprintExit.summary;
  } else if (!shouldClose && snapshot && entry !== null) {
    const thesis = evaluateThesisInvalidation({
      side: trade.side,
      entryPrice: entry,
      markPrice,
      snapshot,
      earlyLossCutBps: PAPER_RISK_CONFIG.earlyLossCutBps,
      invalidationThreshold: PAPER_RISK_CONFIG.thesisInvalidationThreshold,
    });

    const explanation = explainLosingTrade({
      side: trade.side,
      entryPrice: entry,
      markPrice,
      snapshot,
      thesisResult: thesis,
      exchangeTradable: snapshot.providerHealth === "ok",
    });

    if (thesis.shouldExit && thesis.exitReason) {
      shouldClose = true;
      exitPrice = markPrice;
      closeReason = thesis.exitReason;
      riskExplanation = explanation.summary;
    } else {
      const pnlBps =
        trade.side === "LONG"
          ? ((markPrice - entry) / entry) * 10_000
          : ((entry - markPrice) / entry) * 10_000;
      if (pnlBps < -5) {
        riskExplanation = explanation.summary;
      } else if (profitLock.profitLockLabel !== "NONE") {
        riskExplanation = profitLock.summary;
      } else if (thesisReview?.recommendation === "NEEDS_MORE_DATA") {
        riskExplanation = thesisReview.reasons.join("; ");
      }
    }
  }

  if (!shouldClose) {
    const updated = await prisma.paperTrade.update({
      where: { id: trade.id },
      data: { updatedAt: now },
    });
    return { action: "TRADE_UPDATED", trade: updated, snapshotStored: true };
  }

  const pnl = computeClosePnl({ side: trade.side, entryPrice: entry, exitPrice, size });
  const mappedReason = closeReason === "TRADE_UPDATED" ? closeReason : mapLegacyCloseReason(closeReason);
  const result =
    mappedReason === "EXPIRY_EXIT"
      ? classifyResult(pnl.net)
      : mappedReason === "STOP_LOSS_HIT" || mappedReason === "EARLY_LOSS_CUT"
        ? "LOSS"
        : mappedReason === "TAKE_PROFIT_HIT"
          ? "WIN"
          : [
                "THESIS_INVALIDATED",
                "MOMENTUM_REVERSAL",
                "VOLUME_COLLAPSE",
                "LIQUIDITY_WEAKENING",
                "SELL_PRESSURE_INCREASED",
                "MARKET_RISK_INCREASED",
                "TRUE_INVALIDATION_EXIT",
                "WEAK_THESIS_EXIT",
                "STALE_TRADE_EXIT",
                "NEAR_STOP_EXIT",
                "STOP_DANGER_EXIT",
                "MARKET_TURNED_EXIT",
                "VOLUME_FADE_EXIT",
                "SPREAD_WIDEN_EXIT",
                "LIQUIDITY_DROP_EXIT",
                "UNKNOWN_THESIS_EXIT",
                "STALE_DATA_EXIT",
                "TRADE_PROFIT_GIVEBACK_EXIT",
                "OPPORTUNITY_COST_EXIT",
                "BETTER_SETUP_ROTATION_EXIT",
                "CAPITAL_LOCKUP_EXIT",
                "LOW_PROFIT_DENSITY_EXIT",
              ].includes(mappedReason)
            ? "LOSS"
            : classifyResult(pnl.net);

  const closeNote = riskExplanation
    ? `${trade.reason} | closed: ${formatThesisExitLabel(closeReason === "TRADE_UPDATED" ? null : closeReason)} | risk: ${riskExplanation}`
    : `${trade.reason} | closed: ${formatThesisExitLabel(closeReason === "TRADE_UPDATED" ? null : closeReason)}`;

  const updated = await prisma.paperTrade.update({
    where: { id: trade.id },
    data: {
      status: mappedReason === "EXPIRY_EXIT" ? "EXPIRED" : "CLOSED",
      closedAt: now,
      exitPrice: pnl.fillExit,
      grossPaperPnl: pnl.gross,
      estimatedFees: pnl.fees,
      estimatedSlippage: pnl.slippage,
      netPaperPnl: pnl.net,
      result,
      reason: closeNote,
      isRealTrade: false,
      isVerifiedLivePnl: false,
    },
  });

  return { action: "TRADE_CLOSED", trade: updated, snapshotStored: true, exitReason: mappedReason };
}

async function getPaperEvidenceCountSnapshot(
  userId: string,
  record?: RecordScopedEntity,
): Promise<PaperEvidenceCountSnapshot> {
  const runWhere = record ? buildRecordScopedRunWhere(userId, record) : { userId };
  const candidateWhere = record ? buildRecordScopedCandidateWhere(userId, record) : { run: { userId } };
  const signalWhere = record
    ? {
        userId,
        OR: [{ recordId: record.id }, { recordId: null, createdAt: { gte: record.startedAt } }],
      }
    : { userId };
  const snapshotWhere = record
    ? {
        OR: [{ recordId: record.id }, { recordId: null, capturedAt: { gte: record.startedAt } }],
        trade: { userId },
      }
    : { trade: { userId } };

  const [paperRuns, candidatesStored, signalsStored, snapshotsStored] = await Promise.all([
    prisma.paperEvidenceRun.count({ where: runWhere }),
    prisma.paperScanCandidate.count({ where: candidateWhere }),
    prisma.paperSignal.count({ where: signalWhere }),
    prisma.paperTradeSnapshot.count({ where: snapshotWhere }),
  ]);
  return { paperRuns, candidatesStored, signalsStored, snapshotsStored };
}

async function storeCandidateSafe(
  runId: string,
  userId: string,
  recordId: string,
  c: ScanCandidate,
): Promise<{
  ok: boolean;
  reasonCode?: string;
  reasonText?: string;
  displayMessage?: string;
  fieldErrors?: Record<string, string>;
  fieldWarnings?: Record<string, string>;
}> {
  try {
    const prepared = prepareCandidateWriteData(runId, userId, c, recordId);
    if (!prepared.ok) {
      return {
        ok: false,
        reasonCode: prepared.reasonCode,
        reasonText: prepared.reasonText,
        displayMessage: prepared.displayMessage,
        fieldErrors: prepared.fieldErrors,
      };
    }
    await prisma.paperScanCandidate.create({ data: prepared.data });
    return { ok: true, fieldWarnings: prepared.fieldWarnings };
  } catch (err) {
    const classified = classifyCandidateWriteError(err, c.symbol);
    recordPaperDbWriteError(classified.reasonText);
    return {
      ok: false,
      reasonCode: classified.reasonCode,
      reasonText: classified.reasonText,
      displayMessage: classified.displayMessage,
      fieldErrors: classified.fieldErrors,
    };
  }
}

async function storeMissedOpportunity(
  runId: string,
  userId: string,
  input: {
    candidate: ScanCandidate;
    blockedByOpenTradeIds: string[];
    reason: string;
  },
): Promise<boolean> {
  try {
    await prisma.paperMissedOpportunity.create({
      data: {
        runId,
        userId,
        symbol: input.candidate.symbol,
        score: Number.isFinite(input.candidate.opportunityScore)
          ? input.candidate.opportunityScore
          : null,
        riskTier: input.candidate.riskTier,
        price: Number.isFinite(input.candidate.price) ? input.candidate.price : null,
        reason: input.reason,
        wouldHaveOpened: true,
        blockedByOpenTradeIds: input.blockedByOpenTradeIds,
        isRealTrade: false,
        isVerifiedLivePnl: false,
      },
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
    return false;
  }
}

async function closeTradeForRotation(
  trade: DbPaperTrade,
  markPrice: number,
  now: Date,
): Promise<{ trade: DbPaperTrade; netPnl: number; snapshotStored: boolean }> {
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  if (entry === null || size === null || size <= 0) {
    return { trade, netPnl: 0, snapshotStored: false };
  }

  const dir = directionFromSide(trade.side);
  const unrealized =
    dir === "long" ? (markPrice - entry) * size : (entry - markPrice) * size;

  let snapshotStored = false;
  try {
    await prisma.paperTradeSnapshot.create({
      data: {
        tradeId: trade.id,
        recordId: trade.recordId,
        strategyVersion: trade.strategyVersion ?? CURRENT_PAPER_STRATEGY_VERSION,
        markPrice,
        unrealizedPnl: unrealized,
        capturedAt: now,
      },
    });
    snapshotStored = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
  }

  const pnl = computeClosePnl({ side: trade.side, entryPrice: entry, exitPrice: markPrice, size });
  const updated = await prisma.paperTrade.update({
    where: { id: trade.id },
    data: {
      status: "CLOSED",
      closedAt: now,
      exitPrice: pnl.fillExit,
      grossPaperPnl: pnl.gross,
      estimatedFees: pnl.fees,
      estimatedSlippage: pnl.slippage,
      netPaperPnl: pnl.net,
      result: classifyResult(pnl.net),
      reason: `${trade.reason} | closed: PAPER_ROTATION_EXIT`,
      isRealTrade: false,
      isVerifiedLivePnl: false,
    },
  });

  return { trade: updated, netPnl: pnl.net, snapshotStored };
}

async function storeRotationEvent(
  runId: string,
  userId: string,
  input: {
    rotatedOutTradeId: string;
    rotatedOutSymbol: string;
    rotatedInSymbol: string;
    exitSimulatedPnl: number;
    scoreAdvantage: number;
    exitPnlBps: number;
    reason: string;
  },
): Promise<boolean> {
  try {
    await prisma.paperRotationEvent.create({
      data: {
        runId,
        userId,
        rotatedOutTradeId: input.rotatedOutTradeId,
        rotatedOutSymbol: input.rotatedOutSymbol,
        rotatedInSymbol: input.rotatedInSymbol,
        exitSimulatedPnl: input.exitSimulatedPnl,
        scoreAdvantage: input.scoreAdvantage,
        exitPnlBps: input.exitPnlBps,
        reason: input.reason,
        isRealTrade: false,
        isVerifiedLivePnl: false,
      },
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
    return false;
  }
}

function dedupeBySymbol<T extends { symbol: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    out.push(item);
  }
  return out;
}

function serializeCandidate(
  c: ScanCandidate,
  tradeReadyNotOpened = false,
  tradesOpenedThisRun = 0,
) {
  const recommendationLabel = mapCandidateRecommendationLabel({
    action: c.action,
    actionType: c.actionType,
    reasonCode: c.reasonCode,
    tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
    tradeReadyButNotOpened: tradeReadyNotOpened,
  });
  const runDisplayLabel = mapCandidateRunDisplayLabel({
    action: c.action,
    actionType: c.actionType,
    reasonCode: c.reasonCode,
    tradesOpenedThisRun,
    openedThisRun:
      !tradeReadyNotOpened &&
      tradesOpenedThisRun > 0 &&
      (c.action === "OPEN_TRADE" || c.actionType === "OPEN_PAPER_TRADE"),
  });
  return {
    symbol: c.symbol,
    coinName: c.coinName,
    source: c.source,
    price: c.price,
    spreadBps: c.spreadBps,
    volume24hUsd: c.volume24hUsd,
    change24hPct: c.change24hPct,
    change7dPct: c.change7dPct,
    marketCapUsd: c.marketCapUsd,
    riskTier: c.riskTier,
    opportunityScore: c.opportunityScore,
    scoreBreakdown: c.scoreBreakdown,
    liquidityScore: c.liquidityScore,
    momentumScore: c.momentumScore,
    volatilityScore: c.volatilityScore,
    tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
    availability: c.availability,
    action: c.action,
    actionType: c.actionType,
    reasonCode: c.reasonCode,
    reasonText: c.reasonText,
    recommendationLabel,
    runDisplayLabel,
    rank: c.rank,
  };
}

export async function getLastRunScannerSummary(userId: string, record?: RecordScopedEntity) {
  const lastRun = await prisma.paperEvidenceRun.findFirst({
    where: record ? buildRecordScopedRunWhere(userId, record) : { userId },
    orderBy: { startedAt: "desc" },
    include: {
      candidates: { orderBy: { opportunityScore: "desc" }, take: 50 },
    },
  });

  if (!lastRun) return null;

  const summary = (lastRun.scanSummary ?? {}) as Record<string, unknown>;
  const rejectionSummary = (summary.rejectionSummary ?? {}) as Record<string, number>;

  const allCandidates = lastRun.candidates.map((c) => {
    const score = toNumber(c.opportunityScore);
    const tier = c.riskTier as ScanCandidate["riskTier"];
    const reason = resolveCandidateBlockReason({
      score,
      tier,
      reasonCode: c.reasonCode ?? "",
      reasonText: c.reasonText ?? "",
    });
    return {
      symbol: c.symbol,
      source: c.source,
      price: toNumber(c.price),
      score,
      spreadBps: toNumber(c.spreadBps),
      volume24hUsd: toNumber(c.volume24hUsd),
      change24hPct: toNumber(c.change24hPct),
      riskTier: c.riskTier,
      tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
      action: c.action,
      reason,
      reasonCode:
        score >= minScoreForTier(tier) && c.reasonCode === "SCORE_TOO_LOW"
          ? "WATCH_ONLY"
          : c.reasonCode,
    };
  });

  const tradesOpenedThisRun = lastRun.tradesOpened ?? 0;
  const topCandidates = dedupeBySymbol(allCandidates).slice(0, 5).map((c) => ({
    ...c,
    runDisplayLabel: mapCandidateRunDisplayLabel({
      action: c.action,
      reasonCode: c.reasonCode,
      tradesOpenedThisRun,
    }),
  }));
  const highVolatilityOpportunities = dedupeBySymbol(
    allCandidates.filter(
      (c) => c.riskTier === "HIGH_VOLATILITY" || c.riskTier === "EXTREME_RISK",
    ),
  ).slice(0, 10);
  const tradablePaperCandidates = dedupeBySymbol(
    allCandidates.filter(
      (c) => c.tradableOnConfiguredExchange && c.action === "OPEN_PAPER_TRADE",
    ),
  ).slice(0, 10);
  const watchlistOnlyMovers = dedupeBySymbol(
    allCandidates.filter(
      (c) => !c.tradableOnConfiguredExchange || c.action === "WATCHLIST_ONLY",
    ),
  ).slice(0, 10);
  const rejectedExamples = dedupeBySymbol(
    allCandidates.filter((c) => c.action === "REJECTED" || c.action === "SKIPPED"),
  ).slice(0, 10);

  const finalCandidateOutputs = topCandidates
    .filter((c) => c.score !== null)
    .slice(0, 10)
    .map((c) => {
      const dbCand = lastRun.candidates.find((x) => x.symbol === c.symbol);
      const breakdown = emptyScoreBreakdown({
        finalScore: c.score ?? 0,
        momentumScore: toNumber(dbCand?.momentumScore) ?? 0,
        volumeScore: toNumber(dbCand?.volumeSpikeScore) ?? 0,
        liquidityScore: toNumber(dbCand?.liquidityScore) ?? 0,
        socialHypeScore: 0,
        riskScore: toNumber(dbCand?.riskPenalty) ?? 0,
        confidenceLevel: "MEDIUM",
        riskLevel: "MEDIUM",
        pumpRiskPenalty: toNumber(dbCand?.pumpRiskPenalty) ?? 0,
        volatilityScore: toNumber(dbCand?.volatilityScore) ?? 0,
      });
      return buildFinalCandidateOutput({
        name: c.symbol.split("/")[0] ?? c.symbol,
        symbol: c.symbol,
        baseAsset: c.symbol.split("/")[0] ?? c.symbol,
        currentPrice: c.price ?? 0,
        volume24hUsd: c.volume24hUsd ?? 0,
        marketCapUsd: null,
        liquidityUsd: null,
        change24hPct: c.change24hPct ?? 0,
        availability: {
          listedOnKraken: "YES",
          krakenSpotAvailable: c.tradableOnConfiguredExchange ? "YES" : "UNKNOWN",
          krakenMarginAvailable: "UNKNOWN",
          krakenFuturesAvailable: "UNKNOWN",
          usLeverageAvailable: "UNKNOWN",
          availablePairs: [c.symbol],
          bestExchange: c.tradableOnConfiguredExchange ? "kraken" : "unknown",
          recommendedAction: c.tradableOnConfiguredExchange ? "SPOT_ONLY" : "WATCH",
          evidenceSource: "stored_candidate",
          checkedAt: new Date().toISOString(),
          confidence: "medium",
          availabilityNote: null,
        },
        enriched: { providerStatus: {} },
        action: c.action === "OPEN_PAPER_TRADE" ? "OPEN_TRADE" : "WATCHLIST_ONLY",
        scoreBreakdown: breakdown,
        riskTier: (c.riskTier as "MAJOR") ?? "MAJOR",
      });
    });

  const runContributions = summary.providerContributions as
    | import("@/lib/trading/paper/provider-contribution").RunProviderContributions
    | undefined;

  let vaultConnections: ReturnType<typeof vaultHintsFromCredentials> = [];
  try {
    const uid = await resolvePaperUserId();
    const credentials = await listProviderCredentials(uid);
    vaultConnections = vaultHintsFromCredentials(credentials);
  } catch {
    vaultConnections = [];
  }

  const scannerProviderStatus = buildScannerProviderStatus({
    coingeckoStatus: String(summary.coingeckoStatus ?? "unknown"),
    krakenStatus: String(summary.krakenStatus ?? "unknown"),
    dexscreenerStatus: String(summary.dexscreenerStatus ?? "unknown"),
    defillamaStatus: String(summary.defillamaStatus ?? "unknown"),
    lunarcrushStatus: String(summary.lunarcrushStatus ?? "unknown"),
    runContributions: runContributions ?? null,
    vaultConnections,
  });

  return {
    runId: lastRun.id,
    scannerMode: lastRun.scannerMode ?? "WIDE",
    dataSources: lastRun.dataSources ?? [],
    coinsDiscovered: lastRun.coinsDiscovered ?? 0,
    coinsEvaluated: lastRun.coinsEvaluated ?? 0,
    scannerHealth: {
      universeSize: lastRun.universeSize ?? 0,
      symbolsScanned: lastRun.scannedSymbolCount ?? 0,
      successfulFetches: lastRun.successfulFetches ?? 0,
      failedFetches: lastRun.failedFetches ?? 0,
      averageSpreadBps: toNumber(lastRun.averageSpreadBps),
      staleSymbols: lastRun.staleSymbolCount ?? 0,
      watchlistCount: lastRun.watchlistCount ?? 0,
      highVolCount: lastRun.highVolCount ?? 0,
    },
    topGainers: (summary.topGainers as typeof allCandidates) ?? [],
    topVolumeMovers: (summary.topVolumeMovers as typeof allCandidates) ?? [],
    highVolatilityOpportunities,
    tradablePaperCandidates,
    watchlistOnlyMovers,
    rejectedExamples,
    topCandidates,
    rejectionSummary,
    rejectionCategories: summarizeRejectionCategories(rejectionSummary),
    pipeline: (summary.pipeline as Record<string, unknown>) ?? null,
    finalCandidateOutputs:
      (summary.finalCandidateOutputs as typeof finalCandidateOutputs) ?? finalCandidateOutputs,
    providerContributions: runContributions ?? null,
    scannerProviderStatus,
    whyNoTrade:
      (lastRun.tradesOpened ?? 0) === 0
        ? {
            topReasons: Object.entries(rejectionSummary)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([reason, count]) => ({ reason, count })),
            examples: topCandidates.filter((c) => c.action !== "OPEN_PAPER_TRADE").slice(0, 3),
          }
        : null,
  };
}

export async function getPaperEvidenceStats(userId: string, record?: RecordScopedEntity) {
  const tradeWhere = record ? { userId, recordId: record.id } : { userId };
  const runWhere = record ? buildRecordScopedRunWhere(userId, record) : { userId };
  const [
    countSnapshot,
    totalTrades,
    openTrades,
    closedTrades,
    noTradeSignals,
    missedOpportunitiesTotal,
    runs,
  ] = await Promise.all([
    getPaperEvidenceCountSnapshot(userId, record),
    prisma.paperTrade.count({ where: tradeWhere }),
    prisma.paperTrade.count({ where: { ...tradeWhere, status: "OPEN" } }),
    prisma.paperTrade.count({
      where: { ...tradeWhere, status: { in: ["CLOSED", "EXPIRED"] } },
    }),
    prisma.paperSignal.count({
      where: record
        ? {
            userId,
            noTrade: true,
            OR: [{ recordId: record.id }, { recordId: null, createdAt: { gte: record.startedAt } }],
          }
        : { userId, noTrade: true },
    }),
    prisma.paperMissedOpportunity.count({ where: { userId } }),
    prisma.paperEvidenceRun.findMany({
      where: runWhere,
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, errorCount: true },
    }),
  ]);

  const { paperRuns, candidatesStored, signalsStored, snapshotsStored } = countSnapshot;
  const paperEvidenceCountTotal = computePaperEvidenceCountTotal(countSnapshot);

  const closed = await prisma.paperTrade.findMany({
    where: {
      ...(record ? { userId, recordId: record.id } : { userId }),
      status: { in: ["CLOSED", "EXPIRED"] },
    },
    select: { netPaperPnl: true, result: true, closedAt: true },
  });

  const wins = closed.filter((t) => t.result === "WIN").length;
  const losses = closed.filter((t) => t.result === "LOSS").length;
  const breakevens = closed.filter((t) => t.result === "BREAKEVEN").length;
  const simulatedNetPnl = closed.reduce((s, t) => s + (toNumber(t.netPaperPnl) ?? 0), 0);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of [...closed].sort(
    (a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0),
  )) {
    equity += toNumber(t.netPaperPnl) ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const firstRun = runs[0]?.startedAt;
  const lastRun = runs.at(-1)?.startedAt ?? null;
  const calendarDays =
    firstRun && lastRun
      ? Math.max(1, Math.ceil((lastRun.getTime() - firstRun.getTime()) / 86_400_000) + 1)
      : runs.length > 0
        ? 1
        : 0;

  const unresolvedDataErrors = runs.reduce((s, r) => s + r.errorCount, 0);
  const evidenceEval = evaluatePaperForwardEvidence({
    totalRuns: paperRuns,
    closedTrades: closed.length,
    calendarDays,
    unresolvedDataErrors,
    systemAvailable: true,
  });

  return {
    paperRuns,
    candidatesStored,
    signalsStored,
    snapshotsStored,
    paperEvidenceCountTotal,
    totalRuns: paperRuns,
    totalSignals: signalsStored,
    totalTrades,
    openTrades,
    closedTrades,
    noTradeSignals,
    wins,
    losses,
    breakevens,
    simulatedNetPnl,
    maxDrawdown,
    missedOpportunitiesTotal,
    lastRunAt: lastRun?.toISOString() ?? null,
    calendarDays,
    unresolvedDataErrors,
    evidenceStatus: evidenceEval.status,
    evidenceNote: evidenceEval.note,
    evidenceProgress: evidenceEval.progress,
  };
}

export async function getOpenTradesCapacityDetail(userId: string) {
  const maxOpenTrades = SCANNER_CONFIG.maxOpenTrades;
  const openTradesRaw = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    orderBy: { openedAt: "asc" },
  });

  const scoreBySymbol = new Map<string, number>();
  const riskTierBySymbol = new Map<string, string>();
  const lastRunCandidates = await prisma.paperScanCandidate.findMany({
    where: { run: { userId } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { symbol: true, opportunityScore: true, riskTier: true },
  });
  for (const c of lastRunCandidates) {
    if (!scoreBySymbol.has(c.symbol)) {
      scoreBySymbol.set(c.symbol, toNumber(c.opportunityScore) ?? 0);
      if (c.riskTier) riskTierBySymbol.set(c.symbol, c.riskTier);
    }
  }

  const now = Date.now();
  const openTrades = openTradesRaw.map((trade) => {
    const base = serializePaperTrade(trade);
    const latestSnapshot = trade.snapshots[0];
    const currentPrice = latestSnapshot ? toNumber(latestSnapshot.markPrice) : base.entryPrice;
    const view = computeOpenTradeCapacityView({
      trade,
      currentPrice,
      candidateScoreBySymbol: scoreBySymbol,
      riskTierBySymbol,
    });
    const openedMs = trade.openedAt?.getTime() ?? trade.createdAt.getTime();
    const expiresAt = new Date(openedMs + PAPER_TRADE_EXPIRY_HOURS * 3_600_000);

    return {
      ...base,
      currentPrice,
      unrealizedSimulatedPnl: latestSnapshot ? toNumber(latestSnapshot.unrealizedPnl) : null,
      ageHours: Math.round(((now - openedMs) / 3_600_000) * 10) / 10,
      expiresAt: expiresAt.toISOString(),
      opportunityScore: scoreBySymbol.get(trade.symbol) ?? view.originalOpportunityScore,
      riskTier: riskTierBySymbol.get(trade.symbol) ?? view.riskTier,
      distanceToStop: view.distanceToStop,
      distanceToTarget: view.distanceToTarget,
      distanceToTargetBps: view.distanceToTargetBps,
      unrealizedPnlBps: view.unrealizedPnlBps,
      capacityScore: view.score,
      weaknessScore: view.weaknessScore,
      rotationEligibility: view.rotationEligibility,
      rotationEligibilityReason: view.rotationEligibilityReason,
      nearTakeProfit: view.nearTakeProfit,
      simulatedPnlLabel: "SIMULATED" as const,
    };
  });

  const openCount = openTrades.length;
  const dailyBudgetUsd =
    PAPER_RISK_CONFIG.manualDailyBudgetUsd > 0
      ? PAPER_RISK_CONFIG.manualDailyBudgetUsd
      : SCANNER_CONFIG.simulatedAccountUsd;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayClosed = await prisma.paperTrade.findMany({
    where: {
      userId,
      status: { in: ["CLOSED", "EXPIRED"] },
      closedAt: { gte: todayStart },
    },
    select: { netPaperPnl: true },
  });
  const riskUsedTodayUsd = todayClosed.reduce(
    (s, t) => s + Math.abs(Math.min(0, toNumber(t.netPaperPnl) ?? 0)),
    0,
  );

  const exposureMetrics = computeOpenExposureMetrics({
    openTrades: openTradesRaw,
    accountUsd: SCANNER_CONFIG.simulatedAccountUsd,
    riskUsedTodayUsd,
    dailyBudgetUsd,
  });

  const avgConf =
    openTradesRaw.length > 0
      ? openTradesRaw.reduce((s, t) => s + (toNumber(t.confidence) ?? 0.5), 0) / openTradesRaw.length
      : 0.7;

  const capacityState = resolveEffectiveMaxOpenTrades({
    openTradeCount: openCount,
    totalExposurePct: exposureMetrics.riskAtStopPct,
    averageConfidence: avgConf,
    highQualityOpportunityCount: [...scoreBySymbol.values()].filter((s) => s >= 75).length,
  });
  const effectiveMax = capacityState.effectiveMaxOpenTrades;
  const availableSlots = capacityState.slotsAvailable;

  return {
    maxOpenTrades: effectiveMax,
    fixedMaxOpenTrades: maxOpenTrades,
    baseMaxOpenTrades: maxOpenTrades,
    effectiveMaxOpenTrades: effectiveMax,
    dynamicMaxOpenTrades: effectiveMax,
    dynamicModeEnabled: capacityState.dynamicModeEnabled,
    capacityFactors: capacityState.factors,
    totalExposurePct: exposureMetrics.capitalExposurePct,
    capitalExposurePct: exposureMetrics.capitalExposurePct,
    riskAtStopPct: exposureMetrics.riskAtStopPct,
    currentExposureUsd: exposureMetrics.capitalExposureUsd,
    riskAtStopUsd: exposureMetrics.riskAtStopUsd,
    maxTotalExposurePct: exposureMetrics.maxAllowedRiskAtStopPct,
    maxAllowedRiskAtStopPct: exposureMetrics.maxAllowedRiskAtStopPct,
    maxAllowedDailyRiskPct: exposureMetrics.maxAllowedDailyRiskPct,
    exposureAuditNote: exposureMetrics.auditNote,
    dailyRiskBudgetUsd: dailyBudgetUsd,
    dailyRiskBudgetPct: PAPER_RISK_CONFIG.maxDailyLossPercent,
    riskUsedTodayUsd,
    riskUsedTodayPct: exposureMetrics.dailyRiskUsedPct,
    capacityLimitedBy:
      capacityState.blockedReason?.includes("EXPOSURE")
        ? "risk_at_stop"
        : capacityState.blockedReason?.includes("CORRELATED")
          ? "correlation"
          : capacityState.blockedReason?.includes("CAPACITY")
            ? "trade_count"
            : exposureMetrics.riskAtStopPct >= PAPER_RISK_CONFIG.maxTotalExposurePercent
              ? "risk_at_stop"
              : availableSlots === 0
                ? "trade_count"
                : null,
    newTradeAllowedReason:
      availableSlots > 0
        ? "Capacity available — new paper trade may open if candidate passes filters."
        : capacityState.blockedReason ?? "MAX_OPEN_TRADES_REACHED",
    openTrades: openCount,
    availableSlots,
    newTradeOpening: availableSlots > 0 ? ("ALLOWED" as const) : ("BLOCKED" as const),
    maxOpenTradesBlockReason: capacityState.blockedReason,
    rotationEnabled: PAPER_ROTATION_CONFIG.enabled,
    rotationMode: PAPER_ROTATION_CONFIG.mode,
    rotationWarning: rotationWarning(),
    rotationConfig: serializeRotationConfig(),
    openTradeDetails: openTrades,
  };
}

export async function getRotationSummary(userId: string, runId?: string) {
  const where = runId ? { userId, runId } : { userId };
  const [total, thisRun, events] = await Promise.all([
    prisma.paperRotationEvent.count({ where: { userId } }),
    runId ? prisma.paperRotationEvent.count({ where: { userId, runId } }) : Promise.resolve(0),
    prisma.paperRotationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const missedNoSafeExit = await prisma.paperMissedOpportunity.count({
    where: {
      userId,
      ...(runId ? { runId } : {}),
      reason: { in: ["EXIT_NOT_PROFITABLE", "OPEN_TRADE_NEAR_TAKE_PROFIT"] },
    },
  });

  const missedScoreTooSmall = await prisma.paperMissedOpportunity.count({
    where: {
      userId,
      ...(runId ? { runId } : {}),
      reason: "SCORE_ADVANTAGE_TOO_SMALL",
    },
  });

  return {
    rotationConfig: serializeRotationConfig(),
    rotationsTotal: total,
    rotationsThisRun: thisRun,
    rotationEvents: events.map((e) => ({
      rotatedOut: e.rotatedOutSymbol,
      rotatedIn: e.rotatedInSymbol,
      exitSimulatedPnl: toNumber(e.exitSimulatedPnl),
      scoreAdvantage: toNumber(e.scoreAdvantage),
      exitPnlBps: toNumber(e.exitPnlBps),
      reason: e.reason,
      isRealTrade: false,
      simulatedPnlLabel: "SIMULATED" as const,
      createdAt: e.createdAt.toISOString(),
    })),
    missedDueToNoSafeExit: missedNoSafeExit,
    missedDueToScoreTooSmall: missedScoreTooSmall,
  };
}

export async function getMissedOpportunitiesSummary(userId: string, runId?: string) {
  const where = runId ? { userId, runId } : { userId };
  const [total, thisRun, top] = await Promise.all([
    prisma.paperMissedOpportunity.count({ where: { userId } }),
    runId ? prisma.paperMissedOpportunity.count({ where: { userId, runId } }) : Promise.resolve(0),
    prisma.paperMissedOpportunity.findMany({
      where,
      orderBy: { score: "desc" },
      take: 10,
      select: {
        id: true,
        symbol: true,
        score: true,
        riskTier: true,
        price: true,
        reason: true,
        wouldHaveOpened: true,
        blockedByOpenTradeIds: true,
        followUpPrice: true,
        simulatedMissedPnl: true,
        isRealTrade: true,
        isVerifiedLivePnl: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    missedOpportunitiesTotal: total,
    missedOpportunitiesThisRun: thisRun,
    topMissedOpportunities: top.map((m) => ({
      symbol: m.symbol,
      score: toNumber(m.score),
      riskTier: m.riskTier,
      price: toNumber(m.price),
      reason: m.reason,
      wouldHaveOpened: m.wouldHaveOpened,
      blockedByMaxOpenTrades: m.reason.includes("MAX_OPEN") || m.reason.includes("max open"),
      blockedByOpenTradeIds: m.blockedByOpenTradeIds,
      followUpPrice: toNumber(m.followUpPrice),
      simulatedMissedPnl: toNumber(m.simulatedMissedPnl),
      isRealTrade: false,
      isVerifiedLivePnl: false,
      createdAt: m.createdAt.toISOString(),
    })),
    rotationHint:
      rotationWarning() ??
      (PAPER_ROTATION_CONFIG.manualReview
        ? "Rotation is in manual review mode — missed opportunities recorded, no auto-rotate."
        : !PAPER_ROTATION_CONFIG.enabled
          ? "Max open trades full — quality selection prioritized over rotation. No forced trades."
          : top.some((m) => m.reason === "EXIT_NOT_PROFITABLE")
            ? "Rotation rejected — closing current trade was not profitable/safe."
            : null),
    rotationWarning: rotationWarning(),
    rotationMode: PAPER_ROTATION_CONFIG.mode,
  };
}

export const DEFAULT_DASHBOARD_VIEW = "current_record" as const;

export async function getPaperStatus() {
  const userId = await resolvePaperUserId();
  const activeRecord = await ensurePaperRecords(userId);
  const recordScope: RecordScopedEntity = { id: activeRecord.id, startedAt: activeRecord.startedAt };
  const recordId = activeRecord.id;
  const marketData = getMarketDataProviderStatus();
  const stats = await getPaperEvidenceStats(userId);
  const recordStats = await getPaperEvidenceStats(userId, recordScope);
  const allTimeScanner = await getLastRunScannerSummary(userId);
  const recordScanner = await getLastRunScannerSummary(userId, recordScope);
  const modelAccess = await confirmPaperModelsAccessible();
  const latestRun = await prisma.paperEvidenceRun.findFirst({
    where: buildRecordScopedRunWhere(userId, recordScope),
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      reasonCode: true,
      reasonText: true,
      candidatesStored: true,
      snapshotsStored: true,
      signalsStored: true,
      tradesOpened: true,
      tradesUpdated: true,
      tradesClosed: true,
      coinsDiscovered: true,
      coinsEvaluated: true,
      startedAt: true,
      completedAt: true,
      scanSummary: true,
      actions: true,
    },
  });
  const recordScopedRuns = await prisma.paperEvidenceRun.findMany({
    where: buildRecordScopedRunWhere(userId, recordScope),
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      startedAt: true,
      status: true,
      reasonCode: true,
      tradesOpened: true,
      tradesUpdated: true,
      tradesClosed: true,
      scanSummary: true,
      candidatesStored: true,
    },
  });
  const recentWritesSucceeded =
    stats.candidatesStored > 0 ||
    stats.snapshotsStored > 0 ||
    (latestRun?.candidatesStored ?? 0) > 0 ||
    (latestRun?.snapshotsStored ?? 0) > 0;
  const prismaClientStale =
    modelAccess.stalePrismaDetectedNow && !recentWritesSucceeded;
  const maxOpenTrades = SCANNER_CONFIG.maxOpenTrades;
  const capacity = await getOpenTradesCapacityDetail(userId);
  const missed = await getMissedOpportunitiesSummary(userId);
  const rotation = await getRotationSummary(userId);
  const tradeHistory = await getPaperTradeHistory(userId);
  const allUserTrades = await prisma.paperTrade.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const allTrades = await prisma.paperTrade.findMany({
    where: { userId, recordId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const { carried, newTrades } = splitRecordTrades(allTrades);
  const recordNewTradeHistory = buildPaperTradeHistory(
    newTrades.filter((t) => t.status !== "NO_TRADE" && t.side !== "NO_TRADE"),
  );
  const candidateScoreMap = new Map(
    (await prisma.paperScanCandidate.findMany({
      where: { userId, recordId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { symbol: true, opportunityScore: true },
    })).map((c) => [c.symbol, toNumber(c.opportunityScore) ?? 0]),
  );
  const markMap = new Map<string, number>();
  const openTradesForMarks = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN", recordId },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  for (const t of openTradesForMarks) {
    const snap = t.snapshots[0];
    const mark = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (mark !== null) markMap.set(t.id, mark);
  }
  const performanceSummary = buildPaperPerformanceSummary({
    trades: allTrades,
    latestMarkByTradeId: markMap,
    maxDrawdown: stats.maxDrawdown,
  });
  const recordMetrics = await buildRecordMetrics({
    record: activeRecord,
    trades: allTrades,
    allTrades: allUserTrades,
    latestMarkByTradeId: markMap,
    latestRunAt: latestRun?.startedAt ?? null,
  });
  const carriedOpenTradesDetail = buildCarriedTradeSnapshots(allTrades, markMap);
  const newTradesClosedCount = newTrades.filter(
    (t) => t.status === "CLOSED" || t.status === "EXPIRED",
  ).length;
  const carriedTradesClosedCount = carried.filter(
    (t) => t.status === "CLOSED" || t.status === "EXPIRED",
  ).length;
  const recordActivityCounts = {
    runsCompletedInRecord: recordScopedRuns.filter((r) => r.status === "COMPLETED").length,
    tradesUpdatedInRecord: recordScopedRuns.reduce((sum, r) => sum + (r.tradesUpdated ?? 0), 0),
    candidatesScannedInRecord: recordStats.candidatesStored,
    rejectionsInRecord: sumRecordRejectionCounts(recordScopedRuns),
    newTradesOpenedInRecord: recordMetrics.newTradesOpened,
    carriedTradesMonitored: recordMetrics.carriedOpenTrades,
  };
  const recordActivityFeed = buildRecordActivityFeed(recordScopedRuns, 10, {
    newTradesClosedInRecord: newTradesClosedCount,
    carriedTradesClosedInRecord: carriedTradesClosedCount,
  });
  const botHealthCheck = buildRecordBotHealthCheck({
    latestRun: latestRun
      ? {
          startedAt: latestRun.startedAt,
          status: latestRun.status,
          reasonCode: latestRun.reasonCode,
          tradesUpdated: latestRun.tradesUpdated,
          candidatesStored: latestRun.candidatesStored,
          coinsDiscovered: latestRun.coinsDiscovered,
        }
      : null,
    activityCounts: recordActivityCounts,
  });
  const recordOpenTrades = await Promise.all(
    [...newTrades, ...carried]
      .filter((t) => t.status === "OPEN")
      .map(async (trade) => {
        const snap = openTradesForMarks.find((t) => t.id === trade.id)?.snapshots[0];
        const entry = toNumber(trade.entryPrice) ?? 0;
        const mark = snap ? toNumber(snap.markPrice) : entry;
        const tp = toNumber(trade.plannedTakeProfit);
        const sl = toNumber(trade.plannedStopLoss);
        const spreadMatch = trade.reason?.match(/spread:\s*([\d.]+)/i);
        const entrySpreadBps = spreadMatch ? parseFloat(spreadMatch[1]) : null;
        const carriedSnapshot = carriedOpenTradesDetail.find((c) => c.tradeId === trade.id);

        let thesisSnapshot: NormalizedMarketSnapshot | null = null;
        try {
          thesisSnapshot = await getMarketSnapshot(trade.symbol);
        } catch {
          thesisSnapshot = null;
        }

        const reviewSnapshot: NormalizedMarketSnapshot =
          thesisSnapshot ??
          ({
            symbol: trade.symbol,
            ticker: { last: mark, bid: mark, ask: mark, spreadBps: entrySpreadBps ?? 0 },
            candles5m: [],
            relativeVolume: 1,
          } as NormalizedMarketSnapshot);

        const thesisReview =
          entry && mark
            ? evaluateOpenTradeThesisReview({
                side: trade.side,
                entryPrice: entry,
                markPrice: mark,
                snapshot: reviewSnapshot,
                entrySpreadBps,
                hasMarketData:
                  thesisSnapshot !== null && thesisSnapshot.candles5m.length >= 3,
                dataSource: thesisSnapshot?.source ?? "kraken",
              })
            : {
                status: "UNKNOWN_NEEDS_DATA" as const,
                recommendation: "NEEDS_MORE_DATA" as const,
                reasons: ["Missing entry or mark price"],
                candleData: {
                  available: false,
                  candleCount: 0,
                  timeframe: "5m",
                  provider: null,
                  missingReason: "Missing entry or mark price",
                },
              };

        const allTimePnl =
          snap && toNumber(snap.unrealizedPnl) !== null
            ? toNumber(snap.unrealizedPnl)
            : carriedSnapshot?.allTimeUnrealizedPnl ?? null;
        return {
          tradeId: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          isCarried: isCarriedTrade(trade),
          entryPrice: entry,
          currentPrice: mark,
          allTimePnl,
          recordPnlDisplay: isCarriedTrade(trade)
            ? carriedSnapshot?.pnlSinceCarryDisplay ?? "UNKNOWN"
            : allTimePnl !== null
              ? allTimePnl.toFixed(4)
              : "UNKNOWN",
          distanceToTpPct:
            entry && tp && mark ? (((tp - mark) / entry) * 100).toFixed(2) : null,
          distanceToSlPct:
            entry && sl && mark ? (((mark - sl) / entry) * 100).toFixed(2) : null,
          thesisStatus: thesisReview.status,
          recommendation: thesisReview.recommendation,
          reasons: thesisReview.reasons,
          candleData: thesisReview.candleData,
          simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
        };
      }),
  );
  const recordHistory = await buildRecordHistoryRows(userId);
  const recordComparison = buildRecordComparison(recordHistory);
  const archivedRecords = recordHistory.filter((r) => r.status === "ARCHIVED");
  const profitQuality = buildProfitQualitySummary(recordMetrics, {
    performanceScope: "baseline",
  });
  const historyDiagnostic = diagnoseTradeHistory(allTrades);
  const lossAnalysis = analyzeLosingTrades(allTrades, {
    candidateScores: candidateScoreMap,
    averageWinningTrade: performanceSummary.averageWinningTrade,
    averageLosingTrade: performanceSummary.averageLosingTrade,
    limit: null,
  });
  const recordStartingBalance =
    recordMetrics.startingPaperBalance ??
    toNumber(activeRecord.startingPaperBalance) ??
    SCANNER_CONFIG.simulatedAccountUsd;
  const newTradesPerformanceSummary = buildPaperPerformanceSummary({
    trades: newTrades,
    latestMarkByTradeId: markMap,
    maxDrawdown: stats.maxDrawdown,
  });
  const recordCautionMode = evaluateRecordCautionMode(newTradesPerformanceSummary, recordStartingBalance, {
    recordPnl: recordMetrics.recordPnl,
    newTradeLosses: recordMetrics.losses,
    carriedTradeLosses: recordMetrics.carriedTradeStats.losses,
    allRecordLosses: recordMetrics.losses + recordMetrics.carriedTradeStats.losses,
    carriedPnlSinceCarry: recordMetrics.carriedPnlSinceCarry,
  });
  const closedNewLosers = newTrades.filter(
    (t) => t.status === "CLOSED" && (t.result === "LOSS" || (toNumber(t.netPaperPnl) ?? 0) < 0),
  );
  const recordLossAudits = closedNewLosers.map((t) => buildTradeLossAuditReport(t));
  const activeTradingRules = buildActiveTradingRules();
  const safetyVerification = verifyPaperSafetyGates();
  const evidenceCollectionMessage =
    recordStats.paperRuns > 0
      ? "Paper evidence collecting in this record."
      : "No paper evidence runs in this record yet.";
  const capacityRiskLevel =
    capacity.riskAtStopPct >= PAPER_RISK_CONFIG.maxTotalExposurePercent
      ? "HIGH"
      : capacity.riskAtStopPct >= PAPER_RISK_CONFIG.maxTotalExposurePercent * 0.6
        ? "MEDIUM"
        : "LOW";
  const riskLevel = recordCautionMode.active
    ? recordCautionMode.dashboardLabel
    : capacityRiskLevel;

  const latestRunSummary = (latestRun?.scanSummary ?? {}) as Record<string, unknown>;
  const latestRunRejectionSummary =
    ((latestRun?.scanSummary as Record<string, unknown> | null)?.rejectionSummary as Record<
      string,
      number
    >) ?? {};
  const latestRunRejectionCategories = summarizeRejectionCategories(latestRunRejectionSummary);
  const whyNoTradeReport =
    (latestRunSummary.whyNoTradeReport as ReturnType<typeof buildWhyNoTradeReport> | undefined) ??
    null;
  const paperRunDiagnostics =
    (latestRunSummary.paperRunDiagnostics as ReturnType<typeof buildPaperRunDiagnostics> | undefined) ??
    null;
  const tinyBExecution =
    (latestRunSummary.tinyBExecution as import("@/lib/trading/paper/tiny-b-execution").TinyBExecutionSummary | undefined) ??
    null;
  const tradeFrequencyHealth = evaluateTradeFrequencyHealth({
    runsCompleted: recordScopedRuns.filter((r) => r.status === "COMPLETED").length,
    candidatesScanned: recordStats.candidatesStored,
    candidatesEvaluated: recordStats.candidatesStored,
    tradesOpened: recordMetrics.newTradesOpened,
    tradesClosed: recordMetrics.closedTradesInRecord,
    rejections: sumRecordRejectionCounts(recordScopedRuns),
    noTradeRuns: recordScopedRuns.filter((r) => r.tradesOpened === 0).length,
    averageHoldingHours: performanceSummary.averageTradeDurationHours,
    openSlotsUsed: recordMetrics.totalOpenTrades,
    maxOpenSlots: maxOpenTrades,
  });
  const paperBrokerRealism = buildPaperBrokerRealismStatus();
  const recordProfitLock = evaluateRecordProfitLock({
    openTradesUnrealized: recordOpenTrades.map((t) => t.allTimePnl ?? 0),
  });
  const latestRunPnl = latestRun
    ? await resolveLatestRunPnlFromDb(userId, latestRun, latestRunSummary)
    : null;
  const latestRecordRun = latestRun
    ? {
        runId: latestRun.id,
        startedAt: latestRun.startedAt.toISOString(),
        completedAt: latestRun.completedAt?.toISOString() ?? null,
        status: latestRun.status,
        reasonCode: latestRun.reasonCode,
        reasonText: latestRun.reasonText,
        latestAction: Array.isArray(latestRun.actions)
          ? ((latestRun.actions as string[]).at(-1) ?? latestRun.reasonCode ?? "UNKNOWN")
          : (latestRun.reasonCode ?? "UNKNOWN"),
        durationMs:
          latestRun.completedAt && latestRun.startedAt
            ? latestRun.completedAt.getTime() - latestRun.startedAt.getTime()
            : null,
        candidatesStored: latestRun.candidatesStored,
        signalsStored: latestRun.signalsStored,
        snapshotsStored: latestRun.snapshotsStored,
        coinsDiscovered: latestRun.coinsDiscovered,
        coinsEvaluated: latestRun.coinsEvaluated,
        rankedCount:
          ((latestRunSummary.pipeline as Record<string, unknown> | undefined)?.finalCandidates as
            | number
            | undefined) ?? null,
        tradesOpened: latestRun.tradesOpened,
        tradesUpdated: latestRun.tradesUpdated,
        tradesClosed: latestRun.tradesClosed,
        realizedPnlThisRun: latestRunPnl?.realizedPnlThisRun ?? null,
        unrealizedPnlChangeThisRun: latestRunPnl?.unrealizedPnlChangeThisRun ?? null,
        netChangeThisRun: latestRunPnl?.netChangeThisRun ?? null,
        pnlSource: latestRunPnl?.pnlSource ?? "unavailable",
        pnlUnavailableMessage:
          latestRunPnl?.pnlSource === "unavailable"
            ? "P&L unavailable for this run — check record-scoped P&L mapping."
            : null,
        rejectionSummary: latestRunRejectionSummary,
        rejectionCategories: latestRunRejectionCategories,
        bestDecision:
          whyNoTradeReport?.finalReason ??
          recordScanner?.whyNoTrade?.topReasons?.[0]?.reason ??
          (latestRun.tradesOpened > 0 ? "OPEN_PAPER_TRADE" : "NO_TRADE_BEST_DECISION"),
        emptyMessage: null as string | null,
        simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
      }
    : {
        runId: null,
        startedAt: null,
        completedAt: null,
        status: null,
        reasonCode: null,
        reasonText: null,
        latestAction: null,
        durationMs: null,
        candidatesStored: 0,
        signalsStored: 0,
        snapshotsStored: 0,
        coinsDiscovered: 0,
        coinsEvaluated: 0,
        rankedCount: null,
        tradesOpened: 0,
        tradesUpdated: 0,
        tradesClosed: 0,
        realizedPnlThisRun: null,
        unrealizedPnlChangeThisRun: null,
        netChangeThisRun: null,
        pnlSource: "unavailable" as const,
        pnlUnavailableMessage: "P&L unavailable for this run — check record-scoped P&L mapping.",
        rejectionSummary: {} as Record<string, number>,
        rejectionCategories: summarizeRejectionCategories({}),
        bestDecision: null,
        emptyMessage: "No paper evidence run has completed inside this record yet.",
        simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
      };

  return {
    paperModeReady: true,
    marketDataReady: marketData.configured,
    paperRuns: recordStats.paperRuns,
    candidatesStored: recordStats.candidatesStored,
    signalsStored: recordStats.signalsStored,
    snapshotsStored: recordStats.snapshotsStored,
    paperEvidenceCountTotal: recordStats.paperEvidenceCountTotal,
    paperEvidenceCount: recordStats.paperEvidenceCountTotal,
    openPaperTrades: recordMetrics.totalOpenTrades,
    closedPaperTrades: recordMetrics.closedTradesInRecord,
    noTradeSignals: recordStats.noTradeSignals,
    missedOpportunitiesTotal: stats.missedOpportunitiesTotal,
    maxOpenTrades,
    maxOpenTradesReached: capacity.newTradeOpening === "BLOCKED",
    availableSlots: capacity.availableSlots,
    newTradeOpening: capacity.newTradeOpening,
    maxOpenTradesBlockReason: capacity.maxOpenTradesBlockReason,
    rotationEnabled: capacity.rotationEnabled,
    openTradeCapacity: capacity,
    missedOpportunities: missed,
    paperRotation: rotation,
    lastRunAt: latestRun?.startedAt?.toISOString() ?? recordStats.lastRunAt,
    latestRunStatus: latestRun?.status ?? null,
    latestRunReasonCode: latestRun?.reasonCode ?? null,
    currentStatus: stats.evidenceStatus,
    nextAction:
      stats.evidenceStatus === "PASS"
        ? "Continue collecting paper evidence — does not unlock live trading"
        : stats.paperRuns === 0
          ? "Run first paper evidence step"
          : "Keep running paper evidence steps daily",
    simulatedNetPnl: recordMetrics.recordPnl,
    wins: recordMetrics.wins,
    losses: recordMetrics.losses,
    breakevens: recordMetrics.breakevens,
    riskLevel,
    recordCautionMode,
    recordLossAudits,
    tradeFrequencyHealth,
    whyNoTradeReport,
    paperRunDiagnostics,
    tinyBExecution,
    paperBrokerRealism,
    recordProfitLock,
    riskConfig: serializePaperRiskConfig(),
    dataTruth: {
      marketData: DATA_TRUTH.realMarketData(),
      paperTrades: DATA_TRUTH.simulatedPaperTrade(),
      pnl: DATA_TRUTH.simulatedPnl(),
    },
    activeTradingRules,
    lossAnalysis,
    warning: "Paper P&L is simulated — not live proof",
    prismaClientStale,
    prismaStaleMessage: prismaClientStale ? STALE_PRISMA_MESSAGE : null,
    historicalPrismaWarning:
      modelAccess.stalePrismaDetectedNow && recentWritesSucceeded
        ? "Previous Prisma health check reported stale client, but recent DB writes succeeded."
        : null,
    scanner: allTimeScanner,
    recordScanner,
    latestRecordRun,
    defaultDashboardView: DEFAULT_DASHBOARD_VIEW,
    dashboardDataSource: {
      label: `Current Record #${activeRecord.recordNumber} — ${activeRecord.recordName}`,
      recordId: activeRecord.id,
      recordNumber: activeRecord.recordNumber,
      recordName: activeRecord.recordName,
      startedAt: activeRecord.startedAt.toISOString(),
      scopeNote: "Showing current record only — all-time data available in All-Time / Debug",
      simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
    },
    recordWarnings: [
      "Paper P&L is simulated — not live proof",
      "Live trading: LOCKED",
      "Auto execution: LOCKED",
      ...(recordCautionMode.active ? [recordCautionMode.dashboardMessage] : []),
      ...(carriedOpenTradesDetail.some((t) => t.legacyBaselineMissing)
        ? [
            "Legacy carry baseline missing. Run db:generate + db:push, then start a new record for accurate carry delta.",
          ]
        : []),
      ...(prismaClientStale ? [STALE_PRISMA_MESSAGE] : []),
    ],
    tradeHistory,
    performanceSummary: recordMetrics,
    currentRecord: recordMetrics,
    recordHistory,
    archivedRecords,
    recordComparison,
    carriedOpenTradesCount: recordMetrics.carriedOpenTrades,
    carriedOpenTradesDetail,
    carriedClosedTradesDetail: recordMetrics.carriedClosedTradesDetail,
    carriedTradeStats: recordMetrics.carriedTradeStats,
    recordVerdicts: recordMetrics.recordVerdicts,
    cleanFreshStart: recordMetrics.cleanFreshStart,
    recordActivityCounts,
    recordActivityFeed,
    botHealthCheck,
    recordOpenTrades,
    recordNewTradeHistory,
    allTimeDebug: {
      paperRuns: stats.paperRuns,
      candidatesStored: stats.candidatesStored,
      signalsStored: stats.signalsStored,
      snapshotsStored: stats.snapshotsStored,
      paperEvidenceCountTotal: stats.paperEvidenceCountTotal,
      openPaperTrades: stats.openTrades,
      closedPaperTrades: stats.closedTrades,
      simulatedNetPnl: stats.simulatedNetPnl,
      wins: stats.wins,
      losses: stats.losses,
      breakevens: stats.breakevens,
      lastRunAt: stats.lastRunAt,
      simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
    },
    activeRecord: {
      recordId: activeRecord.id,
      recordNumber: activeRecord.recordNumber,
      recordName: activeRecord.recordName,
      strategyVersion: activeRecord.strategyVersion,
      startedAt: activeRecord.startedAt.toISOString(),
    },
    currentStrategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    riskPerformanceScope: "baseline" as const,
    profitQuality,
    historyDiagnostic,
    evidenceCollectionMessage,
    hasPaperRuns: stats.paperRuns > 0,
    safetyVerification,
    liveTradingLocked: true as const,
    autoExecutionLocked: safetyVerification.autoExecutionLocked,
    nextSafeAction:
      safetyVerification.checks.find((c) => !c.passed)?.note ??
      (stats.evidenceStatus === "PASS"
        ? "Continue paper evidence — does not unlock live trading"
        : "Run paper evidence step and review scan pipeline"),
  };
}

export async function runPaperEvidenceStep(options?: {
  fetchSnapshot?: MarketSnapshotFetcher;
  buildUniverse?: typeof buildPaperSymbolUniverse;
  buildWide?: typeof buildWideUniverse;
  now?: Date;
}) {
  const userId = await resolvePaperUserId();
  const activeRecord = await ensurePaperRecords(userId);
  const recordId = activeRecord.id;
  const startedAt = options?.now ?? new Date();
  const fetchSnapshot = options?.fetchSnapshot ?? getMarketSnapshot;
  const buildWide = options?.buildWide ?? buildWideUniverse;

  const recordTradesForCaution = await prisma.paperTrade.findMany({
    where: { userId, recordId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const { newTrades: cautionNewTrades, carried: cautionCarried } = splitRecordTrades(recordTradesForCaution);
  const recordPerfForCaution = buildPaperPerformanceSummary({
    trades: cautionNewTrades,
    latestMarkByTradeId: new Map(),
    maxDrawdown: null,
  });
  const carriedStatsForCaution = computeCarriedTradeStats(cautionCarried, new Map());
  const recordCaution = evaluateRecordCautionMode(
    recordPerfForCaution,
    toNumber(activeRecord.startingPaperBalance) ?? SCANNER_CONFIG.simulatedAccountUsd,
    {
      newTradeLosses: recordPerfForCaution.losses,
      carriedTradeLosses: carriedStatsForCaution.losses,
      allRecordLosses: recordPerfForCaution.losses + carriedStatsForCaution.losses,
      carriedPnlSinceCarry: carriedStatsForCaution.totalPnlSinceCarry,
    },
  );
  const recordCautionSelection = recordCaution.active
    ? {
        active: true,
        minScoreBoost: recordCaution.minScoreBoost,
        blockHighVolAlts: recordCaution.blockHighVolAlts,
      }
    : undefined;

  const countsBefore = await getPaperEvidenceCountSnapshot(userId);
  const evidenceCountBefore = computePaperEvidenceCountTotal(countsBefore);
  const openTradesBefore = await prisma.paperTrade.count({ where: { userId, status: "OPEN" } });
  const closedTradesBefore = await prisma.paperTrade.count({
    where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
  });
  const paperRunsBefore = countsBefore.paperRuns;

  const prismaHealth = await checkPaperPrismaClientHealth();
  if (!prismaHealth.prismaClientLooksCurrent && countsBefore.paperRuns === 0 && countsBefore.candidatesStored === 0) {
    return buildFailedRunResponse(userId, startedAt, "PRISMA_CLIENT_STALE", STALE_PRISMA_MESSAGE, {
      countsBefore,
      evidenceCountBefore,
      openTradesBefore,
      closedTradesBefore,
      paperRunsBefore,
    });
  }

  const configCheck = validateScannerConfig();
  if (!configCheck.valid) {
    return buildFailedRunResponse(
      userId,
      startedAt,
      configCheck.reasonCode,
      configCheck.errors.join("; "),
      { countsBefore, evidenceCountBefore, openTradesBefore, closedTradesBefore, paperRunsBefore },
    );
  }

  let universeSize = 0;
  let symbols: string[] = [];
  let wideResult: WideUniverseResult | null = null;

  try {
    wideResult = await buildWide();
    universeSize = wideResult.coinsDiscovered;
    symbols = [
      ...wideResult.tradablePaperCandidates.map((c) => c.symbol),
      ...wideResult.watchlistOnlyCandidates.map((c) => c.symbol),
    ];
    symbols = [...new Set(symbols)];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reasonCode = msg.startsWith("MARKET_DATA_FAILED")
      ? "MARKET_DATA_FAILED"
      : msg.startsWith("KRAKEN_UNAVAILABLE")
        ? "KRAKEN_UNAVAILABLE"
        : msg.startsWith("UNIVERSE_EMPTY")
          ? "UNIVERSE_EMPTY"
          : "MARKET_DATA_FAILED";
    return buildFailedRunResponse(userId, startedAt, reasonCode, msg, {
      countsBefore,
      evidenceCountBefore,
      openTradesBefore,
      closedTradesBefore,
      paperRunsBefore,
    });
  }

  if (wideResult.coinsDiscovered === 0) {
    return buildFailedRunResponse(userId, startedAt, "UNIVERSE_EMPTY", "No candidates passed universe filters", {
      countsBefore,
      evidenceCountBefore,
      openTradesBefore,
      closedTradesBefore,
      paperRunsBefore,
    });
  }

  let run;
  try {
    run = await prisma.paperEvidenceRun.create({
      data: {
        userId,
        recordId,
        strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
        status: "RUNNING",
        symbols,
        marketDataReady: getMarketDataProviderStatus().configured,
        universeSize,
        scannedSymbolCount: symbols.length,
        scannerMode: wideResult.scannerModeLabel,
        dataSources: wideResult.activeDataSources,
        coinsDiscovered: wideResult.coinsDiscovered,
        coinsEvaluated: 0,
        maxOpenTrades: SCANNER_CONFIG.maxOpenTrades,
        startedAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
    const reasonCode = isPrismaStaleError(msg) ? "PRISMA_CLIENT_STALE" : "DATABASE_WRITE_FAILED";
    return buildFailedRunResponse(userId, startedAt, reasonCode, msg, {
      countsBefore,
      evidenceCountBefore,
      openTradesBefore,
      closedTradesBefore,
      paperRunsBefore,
    });
  }

  const now = startedAt;
  const runErrors: string[] = [];
  const actions: PaperRunAction[] = [];
  let errorCount = 0;
  let tradesUpdated = 0;
  let newTradesUpdated = 0;
  let carriedTradesUpdated = 0;
  let tradesClosed = 0;
  let tradesOpened = 0;
  let noTradeCount = 0;
  let candidatesStored = 0;
  let signalsStored = 0;
  let snapshotsStored = 0;
  let candidateWriteFailures = 0;
  let signalWriteFailures = 0;
  let snapshotWriteFailures = 0;
  let tradeWriteFailures = 0;
  let missedOpportunitiesStored = 0;
  let rotationsPerformed = 0;
  const capacityRunWarnings: string[] = [];
  let successfulFetches = 0;
  let failedFetches = 0;
  let staleSymbolCount = 0;
  let maxOpenTradesReached = openTradesBefore >= SCANNER_CONFIG.maxOpenTrades;
  let latestAction: PaperRunAction = "NO_TRADE";
  const openedTrades: ReturnType<typeof serializePaperTrade>[] = [];

  const openTrades = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: {
      snapshots: {
        select: { unrealizedPnl: true },
        orderBy: { capturedAt: "asc" },
      },
    },
  });

  const allTradesBeforeRun = await prisma.paperTrade.findMany({ where: { userId } });
  const openWithSnapsBefore = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const marksBefore = new Map<string, number>();
  for (const t of openWithSnapsBefore) {
    const snap = t.snapshots[0];
    const m = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (m !== null) marksBefore.set(t.id, m);
  }
  const portfolioBeforeRun = computePortfolioSnapshot(allTradesBeforeRun, marksBefore);
  const tradeReadyNotOpenedSymbols = new Set<string>();

  for (const trade of openTrades) {
    try {
      const snapshot = await fetchSnapshot(trade.symbol);
      successfulFetches++;
      const mark = (snapshot.ticker.bid + snapshot.ticker.ask) / 2;
      const peakUnrealized = trade.snapshots.reduce((max, s) => {
        const v = toNumber(s.unrealizedPnl) ?? 0;
        return Math.max(max, v);
      }, 0);
      const { action, snapshotStored, snapshotError } = await updateOpenTrade(
        trade,
        mark,
        now,
        snapshot,
        {
          runsHeld: trade.snapshots.length + 1,
          peakUnrealizedPnl: peakUnrealized,
          bestCandidate: null,
        },
      );
      actions.push(mapPaperRunActionToExecution(action) as PaperRunAction);
      latestAction = mapPaperRunActionToExecution(action) as PaperRunAction;
      if (snapshotStored) {
        snapshotsStored++;
      } else {
        snapshotWriteFailures++;
        if (snapshotError) runErrors.push(snapshotError);
      }
      if (action === "TRADE_UPDATED") {
        tradesUpdated++;
        if (isCarriedTrade(trade)) carriedTradesUpdated++;
        else newTradesUpdated++;
      }
      if (action === "TRADE_CLOSED") tradesClosed++;
    } catch {
      errorCount++;
      failedFetches++;
      actions.push("MARKET_DATA_FAILED");
      latestAction = "MARKET_DATA_FAILED";
      runErrors.push(`MARKET_DATA_FAILED: ${trade.symbol}`);
    }
  }

  const tickerBySymbol = new Map(
    wideResult.tradablePaperCandidates
      .filter((c) => c.tickerRow)
      .map((c) => [c.symbol, c.tickerRow!]),
  );

  const evalPool =
    wideResult.tradablePaperCandidates.length > 0
      ? wideResult.tradablePaperCandidates
      : wideResult.watchlistOnlyCandidates;

  const quickRanked = dedupeBySymbol(
    [...evalPool].sort((a, b) => quickScoreFromTiered(b) - quickScoreFromTiered(a)),
  ).slice(0, SCANNER_CONFIG.maxEvaluatedCoins);

  const evalStartedAt = Date.now();
  const scanResults = await mapWithConcurrency(quickRanked, SCANNER_CONFIG.evalConcurrency, async (tiered) => {
    if (Date.now() - evalStartedAt > SCANNER_CONFIG.evalTimeoutMs) {
      return {
        symbol: tiered.symbol,
        candidate: {
          symbol: tiered.symbol,
          price: tiered.price,
          spreadBps: tiered.spreadBps ?? 0,
          volume24hUsd: tiered.volume24hUsd,
          change24hPct: tiered.change24hPct,
          change1hPct: tiered.change1hPct,
          marketCapUsd: tiered.marketCapUsd,
          momentumScore: 0,
          volumeSpikeScore: 0,
          volatilityScore: 0,
          liquidityScore: 0,
          spreadScore: 0,
          trendScore: 0,
          dataQualityScore: 0,
          riskPenalty: 0,
          pumpRiskPenalty: 0,
          opportunityScore: 0,
          scoreBreakdown: emptyScoreBreakdown(),
          riskTier: tiered.riskTier,
          shortTermReturnPct: 0,
          breakoutScore: 0,
          source: tiered.source,
          tradableOnConfiguredExchange: tiered.tradableOnConfiguredExchange,
          availability: tiered.availability,
          action: "SKIPPED" as const,
          actionType: "SKIPPED" as const,
          reasonCode: "EVAL_TIMEOUT",
          reasonText: "Evaluation time budget exceeded",
        } satisfies ScanCandidate,
        fetchOk: false,
        spreadBps: tiered.spreadBps ?? 0,
        stale: false,
      };
    }

    try {
      const snapshot = await fetchSnapshot(tiered.symbol);
      const spreadBps = snapshot.ticker.spreadBps;
      const stale = Date.now() - new Date(snapshot.ticker.timestamp).getTime() > 120_000;
      const candidate = buildScanCandidate({
        snapshot,
        tickerRow: tiered.tickerRow ?? tickerBySymbol.get(tiered.symbol),
        tiered,
        recordCaution: recordCautionSelection,
      });
      return { symbol: tiered.symbol, candidate, fetchOk: true, spreadBps, stale };
    } catch {
      return {
        symbol: tiered.symbol,
        candidate: {
          symbol: tiered.symbol,
          price: tiered.price,
          spreadBps: tiered.spreadBps ?? 0,
          volume24hUsd: tiered.volume24hUsd,
          change24hPct: tiered.change24hPct,
          change1hPct: tiered.change1hPct,
          marketCapUsd: tiered.marketCapUsd,
          momentumScore: 0,
          volumeSpikeScore: 0,
          volatilityScore: 0,
          liquidityScore: 0,
          spreadScore: 0,
          trendScore: 0,
          dataQualityScore: 0,
          riskPenalty: 0,
          pumpRiskPenalty: 0,
          opportunityScore: 0,
          scoreBreakdown: emptyScoreBreakdown(),
          riskTier: tiered.riskTier,
          shortTermReturnPct: 0,
          breakoutScore: 0,
          source: tiered.source,
          tradableOnConfiguredExchange: tiered.tradableOnConfiguredExchange,
          availability: tiered.availability,
          action: "SKIPPED" as const,
          actionType: "SKIPPED" as const,
          reasonCode: "MARKET_DATA_FAILED",
          reasonText: "Failed to fetch market snapshot",
        } satisfies ScanCandidate,
        fetchOk: false,
        spreadBps: tiered.spreadBps ?? 0,
        stale: false,
      };
    }
  });

  const scanSymbols = quickRanked.map((r) => r.symbol);
  const allCandidates: ScanCandidate[] = [];
  const spreadSamples: number[] = [];

  for (const result of scanResults) {
    allCandidates.push(result.candidate);
    if (result.fetchOk) {
      successfulFetches++;
      spreadSamples.push(result.spreadBps);
      if (result.stale) staleSymbolCount++;
    } else {
      failedFetches++;
      if (result.candidate.reasonCode !== "EVAL_TIMEOUT") errorCount++;
    }
  }

  for (const tiered of wideResult.watchlistOnlyCandidates.slice(0, SCANNER_CONFIG.topCandidates)) {
    allCandidates.push(buildScanCandidateFromTiered({ tiered, snapshot: null }));
  }

  const dedupedCandidates = dedupeScanCandidates(allCandidates);
  const ranked = rankCandidates(dedupedCandidates);

  const enrichSymbols = ranked.slice(0, SCANNER_CONFIG.topCandidates).map((c) => c.symbol);
  const providerContributionBySymbol = await enrichRankedCandidates(
    enrichSymbols,
    wideResult.defiGlobalSummary,
  );
  const runProviderContributions = buildRunProviderContributions({
    coingeckoStatus: wideResult.coingeckoStatus,
    krakenStatus: wideResult.krakenStatus,
    dexscreenerStatus: wideResult.dexscreenerStatus,
    defillamaStatus: wideResult.defillamaStatus,
    lunarcrushStatus: wideResult.lunarcrushStatus,
    candidateContributions: providerContributionBySymbol.values(),
  });

  let dbFailureReason: string | undefined;
  let prismaStaleCandidateFailures = 0;
  const candidateWriteWarnings: string[] = [];

  for (const c of ranked) {
    const stored = await storeCandidateSafe(run.id, userId, recordId, c);
    if (stored.ok) {
      candidatesStored++;
      if (stored.fieldWarnings && Object.keys(stored.fieldWarnings).length > 0) {
        for (const [field, warn] of Object.entries(stored.fieldWarnings)) {
          candidateWriteWarnings.push(`${c.symbol}: ${field} ${warn}`);
        }
      }
    } else {
      candidateWriteFailures++;
      dbFailureReason = stored.displayMessage ?? stored.reasonText;
      if (stored.reasonCode === "PRISMA_CLIENT_STALE") prismaStaleCandidateFailures++;
      errorCount++;
      runErrors.push(stored.displayMessage ?? `CANDIDATE_WRITE_FAILED: ${c.symbol} candidate could not be stored.`);
    }
  }

  const split = splitCandidates(ranked);
  const topToEvaluate = ranked
    .filter((c) => passedHardSafetyFilters(c))
    .slice(0, SCANNER_CONFIG.topCandidates);
  const rejectedCandidates = ranked.filter((c) => c.action !== "OPEN_TRADE");
  const rejectionSummary = summarizeRejections(ranked);

  let currentOpenCount = openTrades.length - tradesClosed;
  let newTradesThisRun = 0;
  let activeOpenTrades = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
  });

  const highQualityCount = topToEvaluate.filter((c) => c.opportunityScore >= 75).length;
  const avgConfidence =
    topToEvaluate.length > 0
      ? topToEvaluate.reduce((s, c) => {
          const conf =
            c.scoreBreakdown.confidenceLevel === "HIGH"
              ? 0.9
              : c.scoreBreakdown.confidenceLevel === "MEDIUM"
                ? 0.75
                : 0.5;
          return s + conf;
        }, 0) / topToEvaluate.length
      : 0.7;

  const capacityState = resolveEffectiveMaxOpenTrades({
    openTradeCount: currentOpenCount,
    highQualityOpportunityCount: highQualityCount,
    averageConfidence: avgConfidence,
  });
  const effectiveMaxOpenTrades = capacityState.effectiveMaxOpenTrades;
  if (PAPER_RISK_CONFIG.dynamicTradeLimit) {
    capacityRunWarnings.push(...capacityState.factors.map((f) => `Dynamic capacity: ${f}`));
  }

  const candidateScoreBySymbol = new Map(ranked.map((c) => [c.symbol, c.opportunityScore]));
  const candidateRiskBySymbol = new Map(ranked.map((c) => [c.symbol, c.riskTier]));
  const rotationDecisions: Array<{
    action: string;
    candidateSymbol: string;
    weakestSymbol?: string;
    reason: string;
    missedReasonCode?: string;
    scoreAdvantage?: number;
    exitPnlBps?: number;
    rotatedOut?: string;
    rotatedIn?: string;
    exitSimulatedPnl?: number;
  }> = [];
  const tinyBExecution: TinyBExecutionSummary = emptyTinyBExecutionSummary();

  async function buildOpenViews(trades: DbPaperTrade[]): Promise<OpenTradeCapacityView[]> {
    const views: OpenTradeCapacityView[] = [];
    for (const t of trades) {
      let mark: number | null = toNumber(t.entryPrice);
      try {
        const snap = await fetchSnapshot(t.symbol);
        mark = (snap.ticker.bid + snap.ticker.ask) / 2;
      } catch {
        /* use entry as fallback */
      }
      views.push(
        computeOpenTradeCapacityView({
          trade: t,
          currentPrice: mark,
          candidateScoreBySymbol,
          riskTierBySymbol: candidateRiskBySymbol,
          now,
        }),
      );
    }
    return views;
  }

  for (const candidate of topToEvaluate) {
    if (newTradesThisRun >= SCANNER_CONFIG.maxNewTradesPerRun) break;

    const paperDecision = evaluatePaperDecision(candidate, { recordCaution });
    if (paperDecision.decision === "TINY_B_SETUP_PAPER_ONLY") {
      tinyBExecution.tinyBEligibleCount++;
    }

  if (recordCaution.pauseNewEntries && canOpenPaperTrade(paperDecision.decision)) {
      const pauseBlock = {
        symbol: candidate.symbol,
        reasonCode:
          paperDecision.decision === "TINY_B_SETUP_PAPER_ONLY"
            ? ("TINY_B_BLOCKED_CAUTION_CRITICAL" as const)
            : ("TINY_B_BLOCKED_CAUTION_CRITICAL" as const),
        reasonText: `Blocked by caution pauseNewEntries — ${recordCaution.dashboardMessage}`,
        simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
      };
      if (paperDecision.decision === "TINY_B_SETUP_PAPER_ONLY") {
        tinyBExecution.blockers.push(pauseBlock);
      }
      tinyBExecution.noTradeDiagnostics.push(
        buildNoTradeDiagnosticRow({
          candidate,
          paperDecision,
          blocker: pauseBlock.reasonText,
          timestamp: now.toISOString(),
        }),
      );
      tradeReadyNotOpenedSymbols.add(candidate.symbol);
      noTradeCount++;
      continue;
    }

    if (!canOpenPaperTrade(paperDecision.decision)) {
      tradeReadyNotOpenedSymbols.add(candidate.symbol);
      noTradeCount++;
      tinyBExecution.noTradeDiagnostics.push(
        buildNoTradeDiagnosticRow({
          candidate,
          paperDecision,
          blocker: paperDecision.blockedReason ?? candidate.reasonCode,
          timestamp: now.toISOString(),
        }),
      );
      continue;
    }

    const execBlock = resolveTinyBExecutionBlocker({
      candidate,
      paperDecision,
      recordCaution,
      openSlotsAvailable: currentOpenCount < effectiveMaxOpenTrades,
      maxOpenTradesReached: currentOpenCount >= effectiveMaxOpenTrades,
      symbolAlreadyOpen: activeOpenTrades.some((t) => t.symbol === candidate.symbol),
    });
    if (execBlock) {
      tinyBExecution.blockers.push(execBlock);
      tinyBExecution.noTradeDiagnostics.push(
        buildNoTradeDiagnosticRow({
          candidate,
          paperDecision,
          blocker: execBlock.reasonText,
          timestamp: now.toISOString(),
        }),
      );
      tradeReadyNotOpenedSymbols.add(candidate.symbol);
      noTradeCount++;
      continue;
    }

    const blueprintStrategy = {
      mapping: paperDecision.mapping,
      debug: paperDecision.blueprint,
    };

    const existingOpen = activeOpenTrades.find((t) => t.symbol === candidate.symbol);
    if (existingOpen) {
      noTradeCount++;
      continue;
    }

    let isRotationEntry = false;

    const { baseAsset: candidateBase } = parseSymbol(candidate.symbol);
    const correlatedCount = countCorrelatedTrades(
      activeOpenTrades.map((t) => t.symbol),
      candidateBase,
    );
    if (
      PAPER_RISK_CONFIG.dynamicTradeLimit &&
      correlatedCount >= PAPER_RISK_CONFIG.maxCorrelatedTrades
    ) {
      noTradeCount++;
      continue;
    }

    if (currentOpenCount >= effectiveMaxOpenTrades) {
      maxOpenTradesReached = true;
      const openViews = await buildOpenViews(activeOpenTrades);
      const capacityDecision = decideCapacityForCandidate({
        candidate,
        openViews,
        maxOpenTrades: effectiveMaxOpenTrades,
        currentOpenCount,
      });

      if (capacityDecision.action === "PAPER_ROTATE_OUT_WEAKEST" && capacityDecision.weakestTrade) {
        const weakestId = capacityDecision.weakestTrade.tradeId;
        const weakestTrade = activeOpenTrades.find((t) => t.id === weakestId);
        if (weakestTrade) {
          let mark = toNumber(weakestTrade.entryPrice) ?? candidate.price;
          try {
            const snap = await fetchSnapshot(weakestTrade.symbol);
            mark = (snap.ticker.bid + snap.ticker.ask) / 2;
          } catch {
            errorCount++;
          }
          const closed = await closeTradeForRotation(weakestTrade, mark, now);
          if (closed.snapshotStored) snapshotsStored++;
          await storeRotationEvent(run.id, userId, {
            rotatedOutTradeId: weakestTrade.id,
            rotatedOutSymbol: weakestTrade.symbol,
            rotatedInSymbol: candidate.symbol,
            exitSimulatedPnl: closed.netPnl,
            scoreAdvantage: capacityDecision.scoreAdvantage ?? 0,
            exitPnlBps: capacityDecision.exitPnlBps ?? 0,
            reason: capacityDecision.reason,
          });
          rotationDecisions.push({
            action: "PAPER_ROTATE_OUT_WEAKEST",
            candidateSymbol: candidate.symbol,
            weakestSymbol: weakestTrade.symbol,
            reason: capacityDecision.reason,
            scoreAdvantage: capacityDecision.scoreAdvantage,
            exitPnlBps: capacityDecision.exitPnlBps,
            rotatedOut: weakestTrade.symbol,
            rotatedIn: candidate.symbol,
            exitSimulatedPnl: closed.netPnl,
          });
          actions.push("PAPER_TRADE_CLOSED");
          latestAction = "PAPER_TRADE_CLOSED";
          tradesClosed++;
          rotationsPerformed++;
          activeOpenTrades = activeOpenTrades.filter((t) => t.id !== weakestId);
          currentOpenCount--;
          isRotationEntry = true;
          capacityRunWarnings.push(
            `PAPER_ROTATION_EXIT: closed ${weakestTrade.symbol} (simulated P&L ${closed.netPnl.toFixed(4)}) to open ${candidate.symbol}`,
          );
        } else {
          const stored = await storeMissedOpportunity(run.id, userId, {
            candidate,
            blockedByOpenTradeIds: capacityDecision.blockedByOpenTradeIds,
            reason: "MAX_OPEN_TRADES_REACHED",
          });
          if (stored) {
            missedOpportunitiesStored++;
            actions.push("PAPER_TRADE_SKIPPED_MAX_OPEN");
            tradeReadyNotOpenedSymbols.add(candidate.symbol);
          }
          noTradeCount++;
          continue;
        }
      } else if (capacityDecision.action === "MARK_MISSED_OPPORTUNITY") {
        const missedCode =
          capacityDecision.missedReasonCode ??
          (capacityDecision.reason.includes("MAX_OPEN") ? "MAX_OPEN_TRADES_REACHED" : capacityDecision.reason);
        rotationDecisions.push({
          action: "MARK_MISSED_OPPORTUNITY",
          candidateSymbol: candidate.symbol,
          weakestSymbol: capacityDecision.weakestTrade?.symbol,
          reason: capacityDecision.reason,
          missedReasonCode: missedCode,
          scoreAdvantage: capacityDecision.scoreAdvantage,
          exitPnlBps: capacityDecision.exitPnlBps,
        });
        const stored = await storeMissedOpportunity(run.id, userId, {
          candidate,
          blockedByOpenTradeIds: capacityDecision.blockedByOpenTradeIds,
          reason: missedCode,
        });
        if (stored) {
          missedOpportunitiesStored++;
          actions.push("PAPER_TRADE_SKIPPED_MAX_OPEN");
          tradeReadyNotOpenedSymbols.add(candidate.symbol);
          latestAction = "MISSED_OPPORTUNITY";
        }
        noTradeCount++;
        continue;
      } else {
        noTradeCount++;
        continue;
      }
    }

    let snapshot: NormalizedMarketSnapshot;
    try {
      snapshot = await fetchSnapshot(candidate.symbol);
    } catch {
      errorCount++;
      failedFetches++;
      continue;
    }

    const momentum = momentumFromSnapshot(snapshot);
    const isTinyBOpen = paperDecision.decision === "TINY_B_SETUP_PAPER_ONLY";
    const decisionAllocation = isTinyBOpen
      ? paperDecision.allocationMultiplier
      : recordCaution.active
        ? recordCaution.allocationMultiplier
        : 1;
    const strategy = evaluateControlledActiveStrategy(candidate, momentum, {
      allocationMultiplier: decisionAllocation,
      paperExecutionMode: isTinyBOpen ? "TINY_B_SETUP_PAPER_ONLY" : "OPEN_PAPER_TRADE",
    });
    const { baseAsset, quoteAsset } = parseSymbol(candidate.symbol);
    const mappedStrategy = blueprintStrategy.mapping;

    const signal = await prisma.paperSignal.create({
      data: {
        runId: run.id,
        userId,
        recordId,
        strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
        symbol: candidate.symbol,
        side: (strategy.decision === "NO_TRADE" ? "NO_TRADE" : strategy.decision) as PaperTradeSide,
        strategyName: mappedStrategy.strategyName,
        confidence: strategy.confidence,
        reason: isRotationEntry
          ? `PAPER_ROTATION_ENTRY: ${strategy.reasonCode}: ${strategy.reason} | ${mappedStrategy.strategyId}`
          : `${strategy.reasonCode}: ${strategy.reason} | ${mappedStrategy.strategyId}`,
        noTrade: strategy.decision === "NO_TRADE",
        marketPrice: candidate.price,
      },
    });
    signalsStored++;

    if (strategy.decision === "NO_TRADE") {
      const layerBlock =
        isTinyBOpen
          ? {
              symbol: candidate.symbol,
              reasonCode: mapStrategyLayerBlockToTinyBReason(strategy.reasonCode, paperDecision.decision),
              reasonText: `Tiny B eligible but strategy layer blocked — ${strategy.reason}`,
              simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
            }
          : null;
      if (layerBlock) tinyBExecution.blockers.push(layerBlock);
      tinyBExecution.noTradeDiagnostics.push(
        buildNoTradeDiagnosticRow({
          candidate,
          paperDecision,
          blocker: strategy.reason,
          timestamp: now.toISOString(),
        }),
      );
      actions.push("NO_TRADE");
      noTradeCount++;
      latestAction = "NO_TRADE";
      continue;
    }

    const trade = await prisma.paperTrade.create({
      data: {
        userId,
        signalId: signal.id,
        recordId,
        strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
        symbol: candidate.symbol,
        baseAsset,
        quoteAsset,
        side: strategy.decision as PaperTradeSide,
        strategyName: mappedStrategy.strategyName,
        entryPrice: strategy.entryPrice,
        plannedStopLoss: strategy.plannedStopLoss,
        plannedTakeProfit: strategy.plannedTakeProfit,
        simulatedSize: strategy.simulatedSize,
        riskAmount: strategy.riskAmount,
        riskPercent: strategy.riskPercent,
        status: "OPEN",
        openedAt: now,
        result: "OPEN",
        confidence: strategy.confidence,
        reason: isTinyBOpen
          ? `TINY B PAPER-ONLY TEST — reduced size, strict stop, no live, no Auto. | ${mappedStrategy.strategyName} — ${strategy.reason} | score: ${candidate.opportunityScore.toFixed(0)} | spread: ${candidate.spreadBps.toFixed(1)} bps | leverage: ${strategy.simulatedLeverage ?? 1}x (${strategy.leverageReason ?? "spot"}) | alloc: ${strategy.capitalAllocationPct?.toFixed(2) ?? "?"}% | missing: ${paperDecision.blueprint.missingConditions.slice(0, 3).join("; ") || "none"}`
          : strategy.warning
          ? `${strategy.warning}: ${mappedStrategy.strategyName} — ${strategy.reason} | score: ${candidate.opportunityScore.toFixed(0)} | spread: ${candidate.spreadBps.toFixed(1)} bps | leverage: ${strategy.simulatedLeverage ?? 1}x (${strategy.leverageReason ?? "spot"}) | alloc: ${strategy.capitalAllocationPct?.toFixed(2) ?? "?"}%`
          : `${mappedStrategy.strategyName} — ${strategy.reason} | score: ${candidate.opportunityScore.toFixed(0)} | spread: ${candidate.spreadBps.toFixed(1)} bps | leverage: ${strategy.simulatedLeverage ?? 1}x (${strategy.leverageReason ?? "spot"}) | alloc: ${strategy.capitalAllocationPct?.toFixed(2) ?? "?"}%`,
        dataSource: "kraken",
        isRealTrade: false,
        isVerifiedLivePnl: false,
      },
    });

    openedTrades.push({
      ...serializePaperTrade(trade),
      riskTier: strategy.riskTier ?? candidateRiskBySymbol.get(candidate.symbol),
      riskPercent: strategy.riskPercent,
      warning: strategy.warning,
      simulatedLeverage: strategy.simulatedLeverage ?? 1,
      leverageReason: strategy.leverageReason,
      capitalAllocationPct: strategy.capitalAllocationPct,
      leverageAvailable: strategy.leverageAvailable,
      usLeverageAvailable: strategy.usLeverageAvailable,
      marketType: strategy.marketType,
    });
    actions.push(isTinyBOpen ? "TINY_B_OPENED_PAPER_ONLY" : "PAPER_TRADE_OPENED");
    latestAction = isTinyBOpen ? "TINY_B_OPENED_PAPER_ONLY" : "PAPER_TRADE_OPENED";
    if (isTinyBOpen) tinyBExecution.tinyBOpenedCount++;
    tradesOpened++;
    newTradesThisRun++;
    currentOpenCount++;
    activeOpenTrades.push(trade);
  }

  tinyBExecution.executionNote = finalizeTinyBExecutionNote(tinyBExecution);

  if (tradesUpdated > 0 && tradesOpened === 0 && maxOpenTradesReached) {
    latestAction = "TRADE_UPDATED_MAX_OPEN_REACHED";
  }

  if (candidatesStored > 0 || signalsStored > 0 || snapshotsStored > 0 || tradesOpened > 0 || tradesClosed > 0) {
    recordPaperSuccessfulWrite();
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const averageSpreadBps =
    spreadSamples.length > 0 ? spreadSamples.reduce((s, v) => s + v, 0) / spreadSamples.length : null;

  const marketDataStatus =
    successfulFetches === 0 && scanSymbols.length > 0
      ? "MARKET_DATA_FAILED"
      : wideResult.krakenStatus === "unavailable" && wideResult.coingeckoStatus === "ok"
        ? "MARKET_DATA_PARTIAL"
        : failedFetches > 0 || candidateWriteFailures > 0
          ? "MARKET_DATA_PARTIAL"
          : "OK";

  const runWarnings = [
    "Paper P&L is simulated.",
    "This does not unlock live trading.",
    "Auto remains locked.",
    "Do not treat paper results as real profit.",
    "EXTREME_RISK candidates are paper-only watchlist/trades.",
    ...capacityRunWarnings,
  ];
  if (wideResult.coingeckoStatus === "unavailable") {
    runWarnings.push(`COINGECKO_UNAVAILABLE: ${wideResult.coingeckoError ?? "fallback to Kraken only"}`);
  }
  if (wideResult.krakenStatus === "unavailable") {
    runWarnings.push(
      `KRAKEN_UNAVAILABLE: ${wideResult.krakenError ?? "Kraken public data unavailable"} — Kraken tradability UNKNOWN for candidates`,
    );
    if (wideResult.coingeckoStatus === "ok") {
      runWarnings.push("KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED: discovery continued via CoinGecko");
    }
  }
  if (candidateWriteFailures > 0) {
    runWarnings.push(dbFailureReason ?? "CANDIDATE_WRITE_FAILED: one or more candidates not stored");
  }
  for (const w of candidateWriteWarnings.slice(0, 5)) {
    runWarnings.push(`Candidate field warning: ${w}`);
  }
  if (snapshotWriteFailures > 0) {
    runWarnings.push("SNAPSHOT_WRITE_FAILED: some trade snapshots not stored");
  }
  if (maxOpenTradesReached && tradesOpened === 0) {
    runWarnings.push(
      `MAX_OPEN_TRADES_REACHED: ${openTradesBefore}/${SCANNER_CONFIG.maxOpenTrades} open — new trades blocked`,
    );
  }
  if (missedOpportunitiesStored > 0) {
    runWarnings.push(
      `Missed ${missedOpportunitiesStored} strong candidate(s) due to max open trades (${SCANNER_CONFIG.maxOpenTrades}).`,
    );
  }
  if (rotationsPerformed > 0) {
    runWarnings.push(
      `Paper rotation performed ${rotationsPerformed} time(s) — simulated exits only, no live orders.`,
    );
  }
  if (marketDataStatus === "MARKET_DATA_PARTIAL") {
    runWarnings.push("MARKET_DATA_PARTIAL: some symbols failed to fetch or Kraken availability unavailable");
    if (latestAction === "NO_TRADE" || latestAction === "TRADE_UPDATED") {
      latestAction = "MARKET_DATA_PARTIAL";
    }
  }

  const countsAfter = await getPaperEvidenceCountSnapshot(userId);
  const evidenceCountAfter = computePaperEvidenceCountTotal(countsAfter);
  const countDelta = evidenceCountAfter - evidenceCountBefore;
  const paperRunsAfter = countsAfter.paperRuns;
  const openTradesAfter = await prisma.paperTrade.count({ where: { userId, status: "OPEN" } });
  const closedTradesAfter = await prisma.paperTrade.count({
    where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
  });

  const pipelineCounts = summarizePipelineCounts(ranked, {
    recordCaution,
    discovered: wideResult.pipeline.coinsDiscovered,
    evaluated: scanSymbols.length,
  });

  const whyNoTradeReport = buildWhyNoTradeReport({
    tradesOpenedThisRun: tradesOpened,
    ranked,
    rejectionSummary,
    openTradesCount: openTradesAfter,
    availableSlots: Math.max(0, effectiveMaxOpenTrades - openTradesAfter),
    riskMode: recordCaution.dashboardLabel,
    recordCaution,
    totalCandidates: ranked.length,
    pipelineCounts,
    discovered: wideResult.pipeline.coinsDiscovered,
    evaluated: scanSymbols.length,
  });

  const paperRunDiagnostics = buildPaperRunDiagnostics({
    ranked,
    pipelineCounts,
    tradesOpenedThisRun: tradesOpened,
    providerSource: wideResult.activeDataSources?.join(", ") ?? undefined,
    marketDataStatus,
    timestamp: finishedAt.toISOString(),
    tinyBExecution,
  });

  const databaseWriteFailed =
    candidateWriteFailures > 0 && candidatesStored === 0 && ranked.length > 0;
  const snapshotWriteFailed = snapshotWriteFailures > 0 && snapshotsStored === 0 && tradesUpdated > 0;
  const prismaCriticalFailure =
    prismaStaleCandidateFailures > 0 && candidatesStored === 0 && ranked.length > 0;

  const runStatus = classifyRunStatus({
    runRecordCreated: true,
    countDelta,
    candidatesStored,
    signalsStored,
    snapshotsStored,
    tradesOpened,
    tradesUpdated,
    tradesClosed,
    candidateWriteFailures,
    snapshotWriteFailures,
    failedFetches,
    errorCount,
    marketDataStatus,
    prismaCriticalFailure,
  });

  let reasonCode = resolveRunReasonCode({
    status: runStatus,
    countDelta,
    tradesOpened,
    tradesUpdated,
    snapshotsStored,
    candidatesStored,
    signalsStored,
    paperRunsDelta: paperRunsAfter - paperRunsBefore,
    maxOpenTradesReached,
    prismaCriticalFailure,
    databaseWriteFailed,
    snapshotWriteFailed,
    candidateWriteFailures,
    explicitReasonCode:
      wideResult.krakenStatus === "unavailable" && wideResult.coingeckoStatus === "ok"
        ? "KRAKEN_UNAVAILABLE_COINGECKO_FALLBACK_USED"
        : marketDataStatus === "MARKET_DATA_PARTIAL"
          ? "MARKET_DATA_PARTIAL"
          : candidateWriteFailures > 0 && candidatesStored > 0
            ? "CANDIDATE_WRITE_FAILED"
            : undefined,
  });

  if (
    runStatus === "COMPLETED" &&
    tradesOpened === 0 &&
    noTradeCount > 0 &&
    reasonCode !== "MAX_OPEN_TRADES_REACHED" &&
    reasonCode !== "ONLY_UPDATED_EXISTING_TRADES"
  ) {
    reasonCode = "NO_TRADE_BEST_DECISION";
  }

  const reasonText =
    whyNoTradeReport && reasonCode === "NO_TRADE_BEST_DECISION"
      ? whyNoTradeReport.finalReason
      : runStatus === "NOOP"
      ? `Run completed but no new evidence was stored beyond the run record.`
      : runStatus === "PARTIAL"
        ? candidateWriteFailures > 0
          ? `Run completed with warnings. ${candidateWriteFailures} candidate write(s) failed. Paper evidence total ${countDelta >= 0 ? "+" : ""}${countDelta} (${evidenceCountBefore} → ${evidenceCountAfter}). Stored ${candidatesStored} candidates, ${signalsStored} signals, ${snapshotsStored} snapshots.`
          : `Run completed with warnings. Paper evidence total ${countDelta >= 0 ? "+" : ""}${countDelta} (${evidenceCountBefore} → ${evidenceCountAfter}). Stored ${candidatesStored} candidates, ${signalsStored} signals, ${snapshotsStored} snapshots.`
        : reasonCode === "MAX_OPEN_TRADES_REACHED" || reasonCode === "ONLY_UPDATED_EXISTING_TRADES"
          ? `Updated ${tradesUpdated} open trade(s); stored ${candidatesStored} candidate(s) and ${snapshotsStored} snapshot(s). Paper evidence total ${countDelta >= 0 ? "+" : ""}${countDelta} (${evidenceCountBefore} → ${evidenceCountAfter}). New trades blocked at max ${SCANNER_CONFIG.maxOpenTrades} open.`
          : reasonCode === "PRISMA_CLIENT_STALE"
            ? STALE_PRISMA_MESSAGE
            : runStatus === "FAILED"
              ? "No useful evidence was saved."
              : `Paper evidence total ${countDelta >= 0 ? "+" : ""}${countDelta} (${evidenceCountBefore} → ${evidenceCountAfter}).`;

  const allTradesAfterRun = await prisma.paperTrade.findMany({ where: { userId } });
  const openWithSnapsAfter = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const marksAfter = new Map<string, number>();
  for (const t of openWithSnapsAfter) {
    const snap = t.snapshots[0];
    const m = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (m !== null) marksAfter.set(t.id, m);
  }
  const portfolioAfterRun = computePortfolioSnapshot(allTradesAfterRun, marksAfter);
  const closedThisRun = allTradesAfterRun.filter(
    (t) =>
      (t.status === "CLOSED" || t.status === "EXPIRED") &&
      t.closedAt &&
      t.closedAt >= startedAt &&
      t.closedAt <= finishedAt,
  );
  const realizedPnlThisRun = closedThisRun.reduce(
    (s, t) => s + (toNumber(t.netPaperPnl) ?? 0),
    0,
  );
  const runPnlDelta = computeRunPnlDelta(
    portfolioBeforeRun,
    portfolioAfterRun,
    realizedPnlThisRun,
  );
  const currentRunPnlDelta = runPnlDelta.netPnlDeltaThisRun;

  await prisma.paperEvidenceRun.update({
    where: { id: run.id },
    data: {
      status: runStatus,
      reasonCode,
      reasonText,
      actions,
      errorCount: errorCount + candidateWriteFailures + snapshotWriteFailures,
      completedAt: finishedAt,
      rankedCandidateCount: ranked.length,
      evaluatedCandidateCount: topToEvaluate.length,
      coinsEvaluated: scanSymbols.length,
      watchlistCount: split.watchlistOnlyCandidates.length,
      highVolCount: split.highVolatilityCandidates.length,
      tradesOpened,
      tradesUpdated,
      tradesClosed,
      noTradeCount,
      candidatesStored,
      signalsStored,
      snapshotsStored,
      maxOpenTrades: SCANNER_CONFIG.maxOpenTrades,
      maxOpenTradesReached,
      missedOpportunitiesStored,
      rotationsPerformed,
      runWarnings,
      runErrors,
      successfulFetches,
      failedFetches,
      averageSpreadBps,
      staleSymbolCount,
      scanSummary: {
        rejectionSummary,
        tradeUpdateBreakdown: {
          newTradesUpdated,
          carriedTradesUpdated,
        },
        whyNoTradeReport,
        paperRunDiagnostics,
        tinyBExecution,
        pipelineCounts,
        marketDataStatus,
        coingeckoStatus: wideResult.coingeckoStatus,
        krakenStatus: wideResult.krakenStatus,
        dexscreenerStatus: wideResult.dexscreenerStatus,
        defillamaStatus: wideResult.defillamaStatus,
        lunarcrushStatus: wideResult.lunarcrushStatus,
        providerContributions: runProviderContributions,
        pipeline: {
          ...wideResult.pipeline,
          deepEvaluated: scanSymbols.length,
          finalCandidates: ranked.length,
          finalPaperTradeCandidates: split.tradablePaperCandidates.length,
          watchOnlyCandidates: split.watchlistOnlyCandidates.length,
          selectionExplanation: `Selected ${split.tradablePaperCandidates.length} trade-ready from ${ranked.length} ranked after deep-evaluating ${scanSymbols.length} of ${wideResult.pipeline.coinsDiscovered} discovered coins`,
        },
        candidateWriteFailures,
        snapshotWriteFailures,
        signalWriteFailures,
        tradeWriteFailures,
        missedOpportunitiesStored,
        rotationsPerformed,
        rotationEnabled: PAPER_ROTATION_CONFIG.enabled,
        rotationDecisions,
        scannerMode: wideResult.scannerModeLabel,
        dataSources: wideResult.activeDataSources,
        topGainers: wideResult.topGainers.slice(0, 10).map((g) => ({
          symbol: g.symbol,
          change24hPct: g.change24hPct,
          volume24hUsd: g.volume24hUsd,
          riskTier: g.riskTier,
          tradableOnConfiguredExchange: g.tradableOnConfiguredExchange,
        })),
        topVolumeMovers: wideResult.topVolumeMovers.slice(0, 10).map((g) => ({
          symbol: g.symbol,
          change24hPct: g.change24hPct,
          volume24hUsd: g.volume24hUsd,
          riskTier: g.riskTier,
        })),
        topCandidates: dedupeBySymbol(ranked.slice(0, 10).map(serializeCandidate)),
        finalCandidateOutputs: ranked.slice(0, 5).map((c) => {
          const contrib =
            providerContributionBySymbol.get(c.symbol) ??
            emptyProviderContribution({
              coingeckoUsed: c.source === "coingecko",
              krakenUsed: c.source === "kraken" || c.source === "kraken_ticker",
            });
          return buildFinalCandidateOutput({
            name: c.coinName ?? c.symbol,
            symbol: c.symbol,
            baseAsset: c.symbol.split("/")[0],
            currentPrice: c.price,
            volume24hUsd: c.volume24hUsd,
            marketCapUsd: c.marketCapUsd,
            liquidityUsd: contrib.dexscreenerLiquidity ?? c.volume24hUsd,
            change24hPct: c.change24hPct,
            change7dPct: c.change7dPct,
            availability: c.availability,
            enriched: {
              providerStatus: {
                dexscreener: contrib.dexscreenerUsed
                  ? "ok"
                  : contrib.dexscreenerSkipReason ?? "skipped",
                defillama: contrib.defillamaTvl != null ? "ok" : contrib.defillamaSkipReason ?? "skipped",
              },
            },
            providerContribution: contrib,
            action: c.action,
            scoreBreakdown: c.scoreBreakdown,
            riskTier: c.riskTier,
          });
        }),
        highVolatilityOpportunities: dedupeBySymbol(
          split.highVolatilityCandidates.slice(0, 10).map(serializeCandidate),
        ),
        tradablePaperCandidates: dedupeBySymbol(
          split.tradablePaperCandidates.slice(0, 10).map(serializeCandidate),
        ),
        watchlistOnlyMovers: dedupeBySymbol(
          split.watchlistOnlyCandidates.slice(0, 10).map(serializeCandidate),
        ),
        realizedPnlThisRun: runPnlDelta.realizedPnlThisRun,
        unrealizedPnlChangeThisRun: runPnlDelta.unrealizedPnlChangeThisRun,
        currentRunPnlDelta: runPnlDelta.netPnlDeltaThisRun,
        netPnlDeltaThisRun: runPnlDelta.netPnlDeltaThisRun,
        portfolioPnlBeforeRun: runPnlDelta.portfolioPnlBeforeRun,
        portfolioPnlAfterRun: runPnlDelta.portfolioPnlAfterRun,
      },
    },
  });

  const stats = await getPaperEvidenceStats(userId);

  const deepEvaluationExplanation = buildDeepEvaluationExplanation({
    coinsDiscovered: wideResult.coinsDiscovered,
    coinsScanned: wideResult.pipeline.coinsScanned,
    passedFilters: wideResult.pipeline.passedBasicFilters,
    deepEvaluated: scanSymbols.length,
    limit: SCANNER_CONFIG.maxEvaluatedCoins,
  });
  const skippedFromDeepEvaluation = Math.max(
    0,
    wideResult.pipeline.passedBasicFilters - scanSymbols.length,
  );

  const serializeWithLabels = (c: ScanCandidate) =>
    serializeCandidate(c, tradeReadyNotOpenedSymbols.has(c.symbol), tradesOpened);

  return {
    runId: run.id,
    status: runStatus,
    reasonCode,
    reasonText,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    paperRunsBefore,
    paperRunsAfter,
    evidenceCountBefore,
    evidenceCountAfter,
    countDelta,
    candidatesStored,
    signalsStored,
    snapshotsStored,
    latestAction,
    scannerMode: wideResult.scannerModeLabel,
    dataSources: wideResult.activeDataSources,
    coingeckoStatus: wideResult.coingeckoStatus,
    krakenStatus: wideResult.krakenStatus,
    marketDataStatus,
    coinsDiscovered: wideResult.coinsDiscovered,
    coinsEvaluated: scanSymbols.length,
    universeSize,
    scannedSymbolCount: symbols.length,
    rankedCandidateCount: ranked.length,
    evaluatedCandidateCount: topToEvaluate.length,
    watchlistCount: split.watchlistOnlyCandidates.length,
    highVolCount: split.highVolatilityCandidates.length,
    tradesOpened,
    tradesUpdated,
    tradesClosed,
    noTradeCount,
    openTradesBefore,
    openTradesAfter,
    closedTradesBefore,
    closedTradesAfter,
    maxOpenTrades: SCANNER_CONFIG.maxOpenTrades,
    maxOpenTradesReached,
    missedOpportunitiesStored,
    rotationsPerformed,
    rotationEnabled: PAPER_ROTATION_CONFIG.enabled,
    rotationDecisions,
    rotationConfig: serializeRotationConfig(),
    candidateWriteFailures,
    signalWriteFailures,
    snapshotWriteFailures,
    tradeWriteFailures,
    errors: runErrors,
    topCandidates: dedupeBySymbol(ranked.slice(0, 10).map(serializeWithLabels)),
    highVolatilityOpportunities: dedupeBySymbol(
      split.highVolatilityCandidates.slice(0, 10).map(serializeWithLabels),
    ),
    tradablePaperCandidates: dedupeBySymbol(
      split.tradablePaperCandidates.slice(0, 10).map(serializeWithLabels),
    ),
    watchlistOnlyMovers: dedupeBySymbol(
      split.watchlistOnlyCandidates.slice(0, 10).map(serializeWithLabels),
    ),
    rejectedCandidates: dedupeBySymbol(rejectedCandidates.slice(0, 10).map(serializeWithLabels)),
    openedTrades,
    rejectionSummary,
    actions,
    errorCount: errorCount + candidateWriteFailures + snapshotWriteFailures,
    symbols,
    openPaperTrades: stats.openTrades,
    closedPaperTrades: stats.closedTrades,
    noTradeSignals: stats.noTradeSignals,
    paperRuns: stats.paperRuns,
    paperEvidenceCountTotal: stats.paperEvidenceCountTotal,
    simulatedNetPnl: stats.simulatedNetPnl,
    portfolioSimulatedNetPnl: portfolioAfterRun.totalPnl,
    portfolioPnlBeforeRun: runPnlDelta.portfolioPnlBeforeRun,
    portfolioPnlAfterRun: runPnlDelta.portfolioPnlAfterRun,
    realizedPnlThisRun: runPnlDelta.realizedPnlThisRun,
    unrealizedPnlChangeThisRun: runPnlDelta.unrealizedPnlChangeThisRun,
    currentRunPnlDelta,
    deepEvaluationLimit: SCANNER_CONFIG.maxEvaluatedCoins,
    skippedFromDeepEvaluation,
    deepEvaluationExplanation,
    deepEvaluationCapFromEnv: true,
    passedBasicFilters: wideResult.pipeline.passedBasicFilters,
    dynamicCapacity: {
      baseMaxOpenTrades: SCANNER_CONFIG.maxOpenTrades,
      dynamicMaxOpenTrades: effectiveMaxOpenTrades,
      currentOpenTrades: openTradesAfter,
      availableSlots: Math.max(0, effectiveMaxOpenTrades - openTradesAfter),
      factors: capacityState.factors,
    },
    warnings: runWarnings,
    runOutcomeMessage:
      runStatus === "FAILED"
        ? "No useful evidence was saved."
        : runStatus === "PARTIAL"
          ? "Run completed with warnings."
          : runStatus === "NOOP"
            ? "Run completed but produced no new evidence."
            : "Run completed successfully.",
    autoUnlocked: false,
    liveOrdersPlaced: false,
  };
}

interface FailedRunContext {
  countsBefore: PaperEvidenceCountSnapshot;
  evidenceCountBefore: number;
  openTradesBefore: number;
  closedTradesBefore: number;
  paperRunsBefore: number;
}

async function buildFailedRunResponse(
  userId: string,
  startedAt: Date,
  reasonCode: string,
  reasonText: string,
  context?: FailedRunContext,
) {
  const finishedAt = new Date();
  let runId = "unknown";
  let paperRunsAfter = context?.paperRunsBefore ?? 0;
  let evidenceCountAfter = context?.evidenceCountBefore ?? 0;
  let finalReasonCode = reasonCode;
  let finalReasonText = reasonText;

  try {
    const activeRecord = await ensurePaperRecords(userId);
    const run = await prisma.paperEvidenceRun.create({
      data: {
        userId,
        recordId: activeRecord.id,
        strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
        status: "FAILED",
        reasonCode: finalReasonCode,
        reasonText: finalReasonText,
        symbols: [],
        marketDataReady: getMarketDataProviderStatus().configured,
        universeSize: 0,
        scannedSymbolCount: 0,
        errorCount: 1,
        runWarnings: [`[${finalReasonCode}] ${finalReasonText}`],
        runErrors: [finalReasonText],
        startedAt,
        completedAt: finishedAt,
        scanSummary: { rejectionSummary: { [finalReasonCode]: 1 }, reasonText: finalReasonText, reasonCode: finalReasonCode },
      },
    });
    runId = run.id;
    if (context) {
      paperRunsAfter = context.paperRunsBefore + 1;
      evidenceCountAfter = context.evidenceCountBefore + 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordPaperDbWriteError(msg);
    if (finalReasonCode !== "PRISMA_CLIENT_STALE" && isPrismaStaleError(msg)) {
      finalReasonCode = "PRISMA_CLIENT_STALE";
      finalReasonText = STALE_PRISMA_MESSAGE;
    } else if (runId === "unknown") {
      finalReasonCode = "DATABASE_WRITE_FAILED";
      finalReasonText = `Could not create run record: ${msg.slice(0, 200)}`;
    }
  }

  const countsAfter = context ? await getPaperEvidenceCountSnapshot(userId).catch(() => null) : null;
  if (countsAfter) {
    paperRunsAfter = countsAfter.paperRuns;
    evidenceCountAfter = computePaperEvidenceCountTotal(countsAfter);
  }

  let portfolioSimulatedNetPnl = 0;
  try {
    const closed = await prisma.paperTrade.findMany({
      where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
      select: { netPaperPnl: true },
    });
    portfolioSimulatedNetPnl = closed.reduce((s, t) => s + (toNumber(t.netPaperPnl) ?? 0), 0);
  } catch {
    portfolioSimulatedNetPnl = 0;
  }

  return {
    runId,
    status: "FAILED" as const,
    reasonCode: finalReasonCode,
    reasonText: finalReasonText,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    paperRunsBefore: context?.paperRunsBefore ?? 0,
    paperRunsAfter,
    evidenceCountBefore: context?.evidenceCountBefore ?? 0,
    evidenceCountAfter,
    countDelta: evidenceCountAfter - (context?.evidenceCountBefore ?? 0),
    candidatesStored: 0,
    signalsStored: 0,
    snapshotsStored: 0,
    latestAction: "MARKET_DATA_FAILED" as PaperRunAction,
    universeSize: 0,
    scannedSymbolCount: 0,
    rankedCandidateCount: 0,
    evaluatedCandidateCount: 0,
    tradesOpened: 0,
    tradesUpdated: 0,
    tradesClosed: 0,
    noTradeCount: 1,
    openTradesBefore: context?.openTradesBefore ?? 0,
    openTradesAfter: context?.openTradesBefore ?? 0,
    closedTradesBefore: context?.closedTradesBefore ?? 0,
    closedTradesAfter: context?.closedTradesBefore ?? 0,
    maxOpenTrades: SCANNER_CONFIG.maxOpenTrades,
    maxOpenTradesReached: (context?.openTradesBefore ?? 0) >= SCANNER_CONFIG.maxOpenTrades,
    candidateWriteFailures: 0,
    signalWriteFailures: 0,
    snapshotWriteFailures: 0,
    tradeWriteFailures: 0,
    errors: [finalReasonText],
    topCandidates: [],
    rejectedCandidates: [],
    openedTrades: [],
    rejectionSummary: { [finalReasonCode]: 1 },
    actions: ["MARKET_DATA_FAILED"],
    errorCount: 1,
    symbols: [],
    openPaperTrades: context?.openTradesBefore ?? 0,
    closedPaperTrades: context?.closedTradesBefore ?? 0,
    noTradeSignals: 0,
    paperRuns: paperRunsAfter,
    paperEvidenceCountTotal: evidenceCountAfter,
    simulatedNetPnl: portfolioSimulatedNetPnl,
    portfolioSimulatedNetPnl,
    currentRunPnlDelta: 0,
    warnings: [
      `[${finalReasonCode}] ${finalReasonText}`,
      "Paper P&L is simulated.",
      "Auto remains locked.",
    ],
    autoUnlocked: false,
    liveOrdersPlaced: false,
  };
}

export async function getPaperDebugLastRun(userId?: string) {
  const uid = userId ?? (await resolvePaperUserId());
  const modelAccess = await confirmPaperModelsAccessible();
  const counts = await getPaperEvidenceCountSnapshot(uid);
  const latestRun = await prisma.paperEvidenceRun.findFirst({
    where: { userId: uid },
    orderBy: { startedAt: "desc" },
  });

  const latestRunWarnings = Array.isArray(latestRun?.runWarnings)
    ? (latestRun.runWarnings as string[])
    : [];
  const latestRunErrors = Array.isArray(latestRun?.runErrors)
    ? (latestRun.runErrors as string[])
    : [];

  const countDelta =
    latestRun && latestRun.candidatesStored + latestRun.signalsStored + latestRun.snapshotsStored > 0
      ? latestRun.candidatesStored + latestRun.signalsStored + latestRun.snapshotsStored + 1
      : null;

  const contradiction = detectRunContradiction({
    status: latestRun?.status ?? null,
    countDelta,
    candidatesStored: latestRun?.candidatesStored ?? 0,
    signalsStored: latestRun?.signalsStored ?? 0,
    snapshotsStored: latestRun?.snapshotsStored ?? 0,
    reasonCode: latestRun?.reasonCode ?? null,
    stalePrismaDetectedNow: modelAccess.stalePrismaDetectedNow,
  });

  return {
    prismaClientLooksCurrent: modelAccess.ok,
    newPaperModelsAvailable: modelAccess.ok,
    stalePrismaDetectedNow: modelAccess.stalePrismaDetectedNow,
    stalePrismaReason: modelAccess.stalePrismaReason,
    lastSuccessfulDbWriteAt: getLastSuccessfulDbWriteAt(),
    latestRunExists: latestRun !== null,
    latestRunId: latestRun?.id ?? null,
    latestRunStatus: latestRun?.status ?? null,
    latestRunReasonCode: latestRun?.reasonCode ?? null,
    latestRunWarnings,
    latestRunErrors,
    latestRunCountDelta: countDelta,
    latestRunDbWrites: {
      candidatesStored: latestRun?.candidatesStored ?? 0,
      signalsStored: latestRun?.signalsStored ?? 0,
      snapshotsStored: latestRun?.snapshotsStored ?? 0,
    },
    dashboardDisplayedStatus: latestRun?.status ?? null,
    latestDbWriteError: modelAccess.stalePrismaReason,
    latestModelAccessError: modelAccess.stalePrismaReason,
    contradictionDetected: contradiction.contradictionDetected,
    contradictionExplanation: contradiction.explanation,
    totalEvidenceCounts: counts,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          reasonCode: latestRun.reasonCode,
          reasonText: latestRun.reasonText,
          startedAt: latestRun.startedAt.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
          candidatesStored: latestRun.candidatesStored,
          signalsStored: latestRun.signalsStored,
          snapshotsStored: latestRun.snapshotsStored,
          tradesOpened: latestRun.tradesOpened,
          tradesUpdated: latestRun.tradesUpdated,
          tradesClosed: latestRun.tradesClosed,
          maxOpenTradesReached: latestRun.maxOpenTradesReached,
        }
      : null,
  };
}

export function serializePaperTrade(trade: DbPaperTrade) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    strategyName: trade.strategyName,
    status: trade.status,
    result: trade.result,
    entryPrice: toNumber(trade.entryPrice),
    exitPrice: toNumber(trade.exitPrice),
    plannedStopLoss: toNumber(trade.plannedStopLoss),
    plannedTakeProfit: toNumber(trade.plannedTakeProfit),
    simulatedSize: toNumber(trade.simulatedSize),
    grossPaperPnl: toNumber(trade.grossPaperPnl),
    estimatedFees: toNumber(trade.estimatedFees),
    estimatedSlippage: toNumber(trade.estimatedSlippage),
    netPaperPnl: toNumber(trade.netPaperPnl),
    simulatedPnlLabel: "SIMULATED",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    confidence: toNumber(trade.confidence),
    reason: trade.reason,
    openedAt: trade.openedAt?.toISOString() ?? null,
    closedAt: trade.closedAt?.toISOString() ?? null,
    createdAt: trade.createdAt.toISOString(),
  };
}

export async function getPaperTradeHistory(userId?: string) {
  const uid = userId ?? (await resolvePaperUserId());
  const trades = await prisma.paperTrade.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return buildPaperTradeHistory(trades);
}

export async function getPaperTradesList(userId?: string) {
  const uid = userId ?? (await resolvePaperUserId());
  const trades = await prisma.paperTrade.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });

  const history = buildPaperTradeHistory(trades);

  const now = Date.now();
  const serialized = trades.map((trade) => {
    const base = serializePaperTrade(trade);
    if (trade.status !== "OPEN" || !trade.openedAt) return base;

    const entry = toNumber(trade.entryPrice);
    const stop = toNumber(trade.plannedStopLoss);
    const tp = toNumber(trade.plannedTakeProfit);
    const latestSnapshot = trade.snapshots[0];
    const currentPrice = latestSnapshot ? toNumber(latestSnapshot.markPrice) : entry;
    const size = toNumber(trade.simulatedSize);
    const openedMs = trade.openedAt.getTime();
    const ageHours = (now - openedMs) / 3_600_000;
    const expiresAt = new Date(openedMs + PAPER_TRADE_EXPIRY_HOURS * 3_600_000);

    let unrealizedSimulatedPnl: number | null = null;
    if (entry !== null && currentPrice !== null && size !== null && size > 0) {
      const dir = directionFromSide(trade.side);
      unrealizedSimulatedPnl =
        dir === "long" ? (currentPrice - entry) * size : (entry - currentPrice) * size;
    }

    return {
      ...base,
      currentPrice,
      unrealizedSimulatedPnl,
      ageHours: Math.round(ageHours * 10) / 10,
      expiresAt: expiresAt.toISOString(),
      distanceToStop:
        currentPrice !== null && stop !== null ? Math.abs(currentPrice - stop) : null,
      distanceToTarget:
        currentPrice !== null && tp !== null ? Math.abs(tp - currentPrice) : null,
      simulatedPnlLabel: "SIMULATED" as const,
    };
  });

  return {
    ...history,
    recent: serialized,
    open: serialized.filter((t) => t.status === "OPEN"),
    closed: serialized.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED"),
    noTrade: serialized.filter((t) => t.status === "NO_TRADE"),
    simulatedPnlLabel: "SIMULATED",
    warning: "Paper P&L is simulated — not verified live profit",
  };
}

export async function getPaperEvidenceReport(userId?: string) {
  const uid = userId ?? (await resolvePaperUserId());
  const stats = await getPaperEvidenceStats(uid);
  const scanner = await getLastRunScannerSummary(uid);
  const missed = await getMissedOpportunitiesSummary(uid);
  const capacity = await getOpenTradesCapacityDetail(uid);
  const rotationExits = await prisma.paperTrade.count({
    where: { userId: uid, reason: { contains: "PAPER_ROTATION_EXIT" } },
  });
  return {
    ...stats,
    scanner,
    missedOpportunities: missed,
    openTradeCapacity: capacity,
    rotationExits,
    rotationEnabled: PAPER_ROTATION_CONFIG.enabled,
    warning: "Paper evidence is not live proof",
    simulatedPnlLabel: "SIMULATED",
  };
}
