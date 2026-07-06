import type { PaperRecord, PaperRecordStatus, PaperTrade as DbPaperTrade } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import {
  buildPaperPerformanceSummary,
  computePortfolioSnapshot,
  computeUnrealizedForTrade,
  type PaperPerformanceSummary,
} from "@/lib/trading/paper/performance-summary";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import {
  buildCarriedClosedTradeSnapshots,
  buildCleanFreshStartStatus,
  buildRecordVerdicts,
  computeCarriedTradeStats,
  type CarriedClosedTradeSnapshot,
  type CarriedTradeStats,
  type CleanFreshStartStatus,
  type RecordVerdictBundle,
} from "@/lib/trading/paper/record-accounting";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { evaluateOpenTradeThesisReview } from "@/lib/trading/paper/thesis-invalidation";

export const CARRIED_FROM_PREVIOUS_RECORD = "CARRIED_FROM_PREVIOUS_RECORD";
export const LEGACY_RECORD_NAME = "Legacy Record";
export const DEFAULT_ACTIVE_RECORD_NAME = "Current Paper Record";
export const LEGACY_CARRY_BASELINE_MISSING_MESSAGE =
  "Legacy carry baseline missing — start a new record after db:push for accurate carry delta.";

export type PaperRecordExportScope = "CURRENT_RECORD" | "ALL_RECORDS" | "ARCHIVED_RECORDS";

export interface SerializedPaperRecord {
  recordId: string;
  recordNumber: number;
  recordName: string;
  strategyVersion: string;
  startedAt: string;
  endedAt: string | null;
  status: PaperRecordStatus;
  startingPaperBalance: number;
  endingPaperBalance: number | null;
  startingRealizedPnl: number;
  endingRealizedPnl: number | null;
  startingUnrealizedPnl: number;
  endingUnrealizedPnl: number | null;
  startingTradeCount: number;
  endingTradeCount: number | null;
  notes: string | null;
}

export type PaperRecordStartMode = "soft" | "clean";

export interface CarriedTradeSnapshot {
  tradeId: string;
  symbol: string;
  side: string;
  originalEntryTime: string;
  carriedIntoRecordTime: string;
  entryPrice: number;
  currentPrice: number;
  unrealizedSinceCarry: number | null;
  pnlSinceCarryDisplay: string;
  legacyBaselineMissing: boolean;
  allTimeUnrealizedPnl: number;
  status: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface RecordScopedEntity {
  id: string;
  startedAt: Date;
}

export interface RecordActivityEvent {
  type:
    | "RUN_COMPLETED"
    | "NO_TRADE_BEST_DECISION"
    | "TRADE_OPENED"
    | "TRADE_UPDATED"
    | "TRADE_CLOSED"
    | "REJECTION_SUMMARY"
    | "NEW_TRADE_UPDATED"
    | "CARRIED_TRADE_UPDATED"
    | "THESIS_INVALIDATED"
    | "ACCOUNTING_SYNC"
    | "RECORD_HISTORY_SYNC";
  timestamp: string;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface RecordBotHealthCheck {
  isWorking: boolean;
  latestRunCompleted: boolean;
  latestRunTime: string | null;
  latestRunUpdatedTrades: boolean;
  candidatesScanned: number;
  currentRecordRuns: number;
  currentRecordOpenedTrades: number;
  carriedTradesMonitored: number;
  tradesUpdatedInRecord: number;
  rejectionsInRecord: number;
  currentReason: string | null;
  plainEnglishSummary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface RecordActivityCounts {
  runsCompletedInRecord: number;
  tradesUpdatedInRecord: number;
  candidatesScannedInRecord: number;
  rejectionsInRecord: number;
  newTradesOpenedInRecord: number;
  carriedTradesMonitored: number;
}

export interface RecordPerformanceBreakdown {
  recordPnl: number;
  startingPaperBalance: number;
  currentPaperBalance: number;
  newRecordRealizedPnl: number;
  newRecordUnrealizedPnl: number;
  carriedPnlSinceCarry: number;
  allTimePnl: number;
  newTradesOpened: number;
  carriedOpenTrades: number;
  closedTradesInRecord: number;
  newOpenTrades: number;
}

export interface CurrentRecordTradeDetail {
  tradeId: string;
  symbol: string;
  side: string;
  status: string;
  isCarried: boolean;
  entryTime: string | null;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  recordPnlSinceStart: number;
  strategyName: string;
  exitReason: string | null;
  thesisStatus: string;
  distanceToTpPct: string | null;
  distanceToSlPct: string | null;
  reasonCode: string | null;
  paperExecutionMode: string;
  setupLabel: string | null;
  closestBlueprintStrategy: string;
  thesisRecommendation: string | null;
  strategyVersion: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

/** Single source of truth for current-record dashboard + export accounting. */
export interface CurrentRecordAccounting {
  recordId: string;
  startingEquity: number;
  currentEquity: number;
  cashBalance: number;
  totalRecordPnl: number;
  newRealizedPnl: number;
  newUnrealizedPnl: number;
  carriedRealizedPnl: number;
  carriedUnrealizedPnl: number;
  carriedTotalPnl: number;
  newTradesOpened: number;
  newOpenTrades: number;
  newClosedTrades: number;
  carriedOpenTrades: number;
  carriedClosedTrades: number;
  totalOpenTrades: number;
  totalClosedTrades: number;
  newWins: number;
  newLosses: number;
  newBreakevens: number;
  carriedWins: number;
  carriedLosses: number;
  newOpenTradeDetails: CurrentRecordTradeDetail[];
  newClosedTradeDetails: CurrentRecordTradeDetail[];
  carriedOpenTradeDetails: CurrentRecordTradeDetail[];
  carriedClosedTradeDetails: CarriedClosedTradeSnapshot[];
  cleanFreshStart: CleanFreshStartStatus;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

type OpenTradeWithSnap = DbPaperTrade & {
  snapshots?: Array<{ markPrice: unknown; unrealizedPnl?: unknown }>;
};

export function buildRecordMarkMap(
  recordTrades: DbPaperTrade[],
  openTradesWithSnaps?: OpenTradeWithSnap[],
): Map<string, number> {
  const markMap = new Map<string, number>();
  const snapById = new Map(openTradesWithSnaps?.map((t) => [t.id, t]) ?? []);
  for (const trade of recordTrades) {
    if (trade.status !== "OPEN" || trade.side === "NO_TRADE") continue;
    const withSnap = snapById.get(trade.id);
    const snap = withSnap?.snapshots?.[0];
    const mark = snap ? toNumber(snap.markPrice) : toNumber(trade.entryPrice);
    if (mark > 0) markMap.set(trade.id, mark);
  }
  return markMap;
}

function buildTradeDetail(
  trade: DbPaperTrade,
  markMap: Map<string, number>,
  isCarried: boolean,
): CurrentRecordTradeDetail {
  const entry = toNumber(trade.entryPrice);
  const mark =
    trade.status === "OPEN"
      ? (markMap.get(trade.id) ?? entry)
      : toNumber(trade.exitPrice) ?? entry;
  const quantity = toNumber(trade.simulatedSize);
  const unrealized =
    trade.status === "OPEN" ? computeUnrealizedForTrade(trade, mark > 0 ? mark : null) : 0;
  const realized =
    trade.status === "CLOSED" || trade.status === "EXPIRED" ? toNumber(trade.netPaperPnl) : 0;
  let recordPnlSinceStart = isCarried ? 0 : realized + unrealized;
  if (isCarried) {
    const baseline = carriedBaselineUnrealized(trade);
    if (baseline !== null) {
      recordPnlSinceStart =
        trade.status === "OPEN"
          ? unrealized - baseline
          : toNumber(trade.netPaperPnl) - baseline;
    }
  }
  const tp = toNumber(trade.plannedTakeProfit);
  const sl = toNumber(trade.plannedStopLoss);
  const exitMatch = trade.reason.match(/\|\s*closed:\s*([^|]+)/i);
  const parsedReason = parseTradeReasonMeta(trade.reason);
  const thesisReview =
    trade.status === "OPEN" && entry > 0 && mark > 0
      ? evaluateOpenTradeThesisReview({
          side: trade.side,
          entryPrice: entry,
          markPrice: mark,
          snapshot: {
            symbol: trade.symbol,
            ticker: { last: mark, bid: mark, ask: mark, spreadBps: 0 },
            candles5m: [],
            relativeVolume: 1,
          } as NormalizedMarketSnapshot,
          entrySpreadBps: null,
          hasMarketData: false,
        })
      : null;
  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    status: trade.status,
    isCarried,
    entryTime: (trade.openedAt ?? trade.createdAt)?.toISOString() ?? null,
    entryPrice: entry,
    currentPrice: mark,
    quantity,
    unrealizedPnl: unrealized,
    realizedPnl: realized,
    recordPnlSinceStart,
    strategyName: trade.strategyName,
    exitReason: exitMatch ? exitMatch[1].trim() : null,
    thesisStatus: thesisReview?.status ?? trade.result ?? (trade.status === "OPEN" ? "OPEN" : "UNKNOWN"),
    distanceToTpPct:
      entry > 0 && tp && mark ? (((tp - mark) / entry) * 100).toFixed(2) : null,
    distanceToSlPct:
      entry > 0 && sl && mark ? (((mark - sl) / entry) * 100).toFixed(2) : null,
    reasonCode: parsedReason.reasonCode,
    paperExecutionMode: parsedReason.paperExecutionMode,
    setupLabel: parsedReason.setupLabel,
    closestBlueprintStrategy: trade.strategyName || parsedReason.closestBlueprintStrategy,
    thesisRecommendation: thesisReview?.recommendation ?? null,
    strategyVersion: trade.strategyVersion ?? "legacy",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

function parseTradeReasonMeta(reason: string): {
  reasonCode: string | null;
  paperExecutionMode: string;
  setupLabel: string | null;
  closestBlueprintStrategy: string;
} {
  const base = reason.split("|")[0]?.trim() ?? reason;
  const isTinyB = /TINY B PAPER-ONLY/i.test(reason);
  const strategyMatch = reason.match(/^([^|]+?)\s*—\s*/);
  const closestBlueprintStrategy = strategyMatch?.[1]?.trim() ?? "UNKNOWN";
  const reasonCodeMatch = base.match(/^([A-Z0-9_]+):/);
  return {
    reasonCode: reasonCodeMatch?.[1] ?? (isTinyB ? "TINY_B_SETUP_PAPER_ONLY" : null),
    paperExecutionMode: isTinyB ? "TINY_B_SETUP_PAPER_ONLY" : "OPEN_PAPER_TRADE",
    setupLabel: isTinyB ? "Tiny B" : null,
    closestBlueprintStrategy,
  };
}

export function buildCurrentRecordAccounting(input: {
  record: Pick<PaperRecord, "id" | "startingPaperBalance">;
  recordTrades: DbPaperTrade[];
  allTrades?: DbPaperTrade[];
  openTradesWithSnaps?: OpenTradeWithSnap[];
  markMap?: Map<string, number>;
}): CurrentRecordAccounting {
  const markMap = input.markMap ?? buildRecordMarkMap(input.recordTrades, input.openTradesWithSnaps);
  const breakdown = computeRecordPerformanceBreakdown({
    record: input.record as PaperRecord,
    recordTrades: input.recordTrades,
    allTrades: input.allTrades,
    markMap,
  });
  const { carried, newTrades } = splitRecordTrades(input.recordTrades);
  const newSummary = buildPaperPerformanceSummary({ trades: newTrades, latestMarkByTradeId: markMap });
  const carriedStats = computeCarriedTradeStats(carried, markMap);
  const activeOpenTrades = input.recordTrades.filter(
    (t) => t.status === "OPEN" && t.side !== "NO_TRADE",
  );

  const newOpenTradeDetails = newTrades
    .filter((t) => t.status === "OPEN" && isActionableTrade(t))
    .map((t) => buildTradeDetail(t, markMap, false));
  const newClosedTradeDetails = newTrades
    .filter((t) => (t.status === "CLOSED" || t.status === "EXPIRED") && isActionableTrade(t))
    .map((t) => buildTradeDetail(t, markMap, false));
  const carriedOpenTradeDetails = carried
    .filter((t) => t.status === "OPEN")
    .map((t) => buildTradeDetail(t, markMap, true));

  const cashBalance = breakdown.startingPaperBalance + breakdown.newRecordRealizedPnl + carriedStats.realizedPnlSinceCarry;
  const startingEquity = breakdown.startingPaperBalance;
  const totalRecordPnl = breakdown.recordPnl;
  const currentEquity = startingEquity + totalRecordPnl;

  return {
    recordId: input.record.id,
    startingEquity,
    currentEquity,
    cashBalance,
    totalRecordPnl,
    newRealizedPnl: breakdown.newRecordRealizedPnl,
    newUnrealizedPnl: breakdown.newRecordUnrealizedPnl,
    carriedRealizedPnl: carriedStats.realizedPnlSinceCarry,
    carriedUnrealizedPnl: carriedStats.unrealizedPnlSinceCarry,
    carriedTotalPnl: breakdown.carriedPnlSinceCarry,
    newTradesOpened: breakdown.newTradesOpened,
    newOpenTrades: breakdown.newOpenTrades,
    newClosedTrades: breakdown.closedTradesInRecord,
    carriedOpenTrades: breakdown.carriedOpenTrades,
    carriedClosedTrades: carriedStats.closedCount,
    totalOpenTrades: breakdown.newOpenTrades + breakdown.carriedOpenTrades,
    totalClosedTrades: breakdown.closedTradesInRecord + carriedStats.closedCount,
    newWins: newSummary.wins,
    newLosses: newSummary.losses,
    newBreakevens: newSummary.breakevens,
    carriedWins: carriedStats.wins,
    carriedLosses: carriedStats.losses,
    newOpenTradeDetails,
    newClosedTradeDetails,
    carriedOpenTradeDetails,
    carriedClosedTradeDetails: buildCarriedClosedTradeSnapshots(carried, markMap),
    cleanFreshStart: buildCleanFreshStartStatus(activeOpenTrades),
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export interface PaperRecordMetrics extends PaperPerformanceSummary {
  recordId: string;
  recordNumber: number;
  recordName: string;
  strategyVersion: string;
  startedAt: string;
  endedAt: string | null;
  status: PaperRecordStatus;
  startingPaperBalance: number;
  recordPnl: number;
  recordRealizedPnl: number;
  recordUnrealizedPnl: number;
  newRecordRealizedPnl: number;
  newRecordUnrealizedPnl: number;
  carriedPnlSinceCarry: number;
  allTimePnl: number;
  newTradesOpened: number;
  closedTradesInRecord: number;
  carriedOpenTrades: number;
  latestRunAt: string | null;
  scopeLabel: "CURRENT_RECORD";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
  freshRecordMessage: string | null;
  recordVerdicts: RecordVerdictBundle;
  carriedTradeStats: CarriedTradeStats;
  carriedClosedTradesDetail: CarriedClosedTradeSnapshot[];
  cleanFreshStart: CleanFreshStartStatus;
  newTradeWinRateLabel: string;
  overallRecordStatus: string;
  currentRecordAccounting: CurrentRecordAccounting;
}

export interface PaperRecordHistoryRow extends SerializedPaperRecord {
  recordPnl: number | null;
  openTrades: number;
  closedTrades: number;
  totalOpenedTrades: number;
  newRecordUnrealizedPnl: number;
  winRate: number | null;
  profitFactor: number | null;
}

export interface PaperRecordComparison {
  bestByPnl: { recordNumber: number; recordName: string; value: number } | null;
  bestByProfitFactor: { recordNumber: number; recordName: string; value: number } | null;
  worstByDrawdown: { recordNumber: number; recordName: string; value: number } | null;
  lowestAverageLoss: { recordNumber: number; recordName: string; value: number } | null;
  bestWinRate: { recordNumber: number; recordName: string; value: number } | null;
  plainEnglishVerdict: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export type StartNewRecordResult =
  | {
      ok: true;
      record: SerializedPaperRecord;
      archivedRecord: SerializedPaperRecord | null;
      message: string;
      carriedOpenTrades: number;
      startMode: PaperRecordStartMode;
    }
  | {
      ok: false;
      reason: "OPEN_TRADES_EXIST";
      openTradeCount: number;
      message: string;
      startMode?: PaperRecordStartMode;
    };

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function isActionableTrade(trade: DbPaperTrade): boolean {
  return trade.status !== "NO_TRADE" && trade.side !== "NO_TRADE";
}

export function isActionablePaperTrade(trade: DbPaperTrade): boolean {
  return isActionableTrade(trade);
}

export function isCarriedTrade(trade: DbPaperTrade): boolean {
  return trade.reason.includes(CARRIED_FROM_PREVIOUS_RECORD);
}

export function isNewRecordTrade(trade: DbPaperTrade): boolean {
  return !isCarriedTrade(trade);
}

export function splitRecordTrades(trades: DbPaperTrade[]): {
  carried: DbPaperTrade[];
  newTrades: DbPaperTrade[];
} {
  const carried: DbPaperTrade[] = [];
  const newTrades: DbPaperTrade[] = [];
  for (const trade of trades) {
    if (isCarriedTrade(trade)) carried.push(trade);
    else newTrades.push(trade);
  }
  return { carried, newTrades };
}

function tradeUnrealizedAtMark(trade: DbPaperTrade, markMap: Map<string, number>): number {
  const mark = markMap.get(trade.id) ?? toNumber(trade.entryPrice);
  return computeUnrealizedForTrade(trade, mark > 0 ? mark : null);
}

export function hasCarriedBaseline(trade: DbPaperTrade): boolean {
  return trade.carriedBaselineUnrealizedPnl !== null && trade.carriedBaselineUnrealizedPnl !== undefined;
}

function carriedBaselineUnrealized(trade: DbPaperTrade): number | null {
  if (hasCarriedBaseline(trade)) {
    return toNumber(trade.carriedBaselineUnrealizedPnl);
  }
  return null;
}

export function buildRecordScopedRunWhere(userId: string, record: RecordScopedEntity) {
  return {
    userId,
    OR: [{ recordId: record.id }, { recordId: null, startedAt: { gte: record.startedAt } }],
  };
}

export function buildRecordScopedCandidateWhere(userId: string, record: RecordScopedEntity) {
  return {
    userId,
    OR: [{ recordId: record.id }, { recordId: null, createdAt: { gte: record.startedAt } }],
  };
}

export function formatPnlSinceCarry(unrealizedSinceCarry: number | null, legacyBaselineMissing: boolean): string {
  if (legacyBaselineMissing) return LEGACY_CARRY_BASELINE_MISSING_MESSAGE;
  if (unrealizedSinceCarry === null) return "UNKNOWN";
  return unrealizedSinceCarry.toFixed(4);
}

export function computeRecordPerformanceBreakdown(input: {
  record: PaperRecord;
  recordTrades: DbPaperTrade[];
  allTrades?: DbPaperTrade[];
  markMap: Map<string, number>;
}): RecordPerformanceBreakdown {
  const { carried, newTrades } = splitRecordTrades(input.recordTrades);
  const newPortfolio = computePortfolioSnapshot(newTrades, input.markMap);

  let carriedPnlSinceCarry = 0;
  for (const trade of carried) {
    const baseline = carriedBaselineUnrealized(trade);
    if (baseline === null) continue;
    if (trade.status === "OPEN") {
      const currentUnrealized = tradeUnrealizedAtMark(trade, input.markMap);
      carriedPnlSinceCarry += currentUnrealized - baseline;
    } else if (trade.status === "CLOSED" || trade.status === "EXPIRED") {
      carriedPnlSinceCarry += toNumber(trade.netPaperPnl) - baseline;
    }
  }

  const startBalance = toNumber(input.record.startingPaperBalance);
  const recordPnl = newPortfolio.totalPnl + carriedPnlSinceCarry;
  const allTrades = input.allTrades ?? input.recordTrades;
  const allTimePortfolio = computePortfolioSnapshot(allTrades, input.markMap);

  return {
    recordPnl,
    startingPaperBalance: startBalance,
    currentPaperBalance: startBalance + recordPnl,
    newRecordRealizedPnl: newPortfolio.realizedPnl,
    newRecordUnrealizedPnl: newPortfolio.unrealizedPnl,
    carriedPnlSinceCarry,
    allTimePnl: allTimePortfolio.totalPnl,
    newTradesOpened: newTrades.filter(isActionableTrade).length,
    carriedOpenTrades: carried.filter((t) => t.status === "OPEN").length,
    closedTradesInRecord: newTrades.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED").length,
    newOpenTrades: newTrades.filter((t) => t.status === "OPEN").length,
  };
}

export function buildCarriedTradeSnapshots(
  recordTrades: DbPaperTrade[],
  markMap: Map<string, number>,
): CarriedTradeSnapshot[] {
  return splitRecordTrades(recordTrades)
    .carried.filter((t) => t.status === "OPEN")
    .map((trade) => {
      const currentPrice = markMap.get(trade.id) ?? toNumber(trade.entryPrice);
      const allTimeUnrealizedPnl = tradeUnrealizedAtMark(trade, markMap);
      const baseline = carriedBaselineUnrealized(trade);
      const legacyBaselineMissing = baseline === null;
      const unrealizedSinceCarry = legacyBaselineMissing ? null : allTimeUnrealizedPnl - baseline;
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        originalEntryTime: (trade.openedAt ?? trade.createdAt).toISOString(),
        carriedIntoRecordTime: (trade.carriedAt ?? trade.updatedAt).toISOString(),
        entryPrice: toNumber(trade.entryPrice),
        currentPrice,
        unrealizedSinceCarry,
        pnlSinceCarryDisplay: formatPnlSinceCarry(unrealizedSinceCarry, legacyBaselineMissing),
        legacyBaselineMissing,
        allTimeUnrealizedPnl,
        status: trade.status,
        simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
      };
    });
}

export function serializePaperRecord(record: PaperRecord): SerializedPaperRecord {
  return {
    recordId: record.id,
    recordNumber: record.recordNumber,
    recordName: record.recordName,
    strategyVersion: record.strategyVersion,
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt?.toISOString() ?? null,
    status: record.status,
    startingPaperBalance: toNumber(record.startingPaperBalance),
    endingPaperBalance: record.endingPaperBalance ? toNumber(record.endingPaperBalance) : null,
    startingRealizedPnl: toNumber(record.startingRealizedPnl),
    endingRealizedPnl: record.endingRealizedPnl ? toNumber(record.endingRealizedPnl) : null,
    startingUnrealizedPnl: toNumber(record.startingUnrealizedPnl),
    endingUnrealizedPnl: record.endingUnrealizedPnl ? toNumber(record.endingUnrealizedPnl) : null,
    startingTradeCount: record.startingTradeCount,
    endingTradeCount: record.endingTradeCount,
    notes: record.notes,
  };
}

export async function buildMarkMap(userId: string): Promise<Map<string, number>> {
  const openTrades = await prisma.paperTrade.findMany({
    where: { userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const markMap = new Map<string, number>();
  for (const t of openTrades) {
    const snap = t.snapshots[0];
    const mark = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (mark > 0) markMap.set(t.id, mark);
  }
  return markMap;
}

export function filterTradesByRecordId(trades: DbPaperTrade[], recordId: string): DbPaperTrade[] {
  return trades.filter((t) => t.recordId === recordId);
}

async function tagUntaggedPaperData(userId: string, recordId: string) {
  await Promise.all([
    prisma.paperTrade.updateMany({ where: { userId, recordId: null }, data: { recordId } }),
    prisma.paperEvidenceRun.updateMany({ where: { userId, recordId: null }, data: { recordId } }),
    prisma.paperSignal.updateMany({ where: { userId, recordId: null }, data: { recordId } }),
    prisma.paperScanCandidate.updateMany({ where: { userId, recordId: null }, data: { recordId } }),
    prisma.paperTradeSnapshot.updateMany({
      where: { trade: { userId, recordId: null } },
      data: { recordId },
    }),
  ]);
}

async function nextRecordNumber(userId: string): Promise<number> {
  const max = await prisma.paperRecord.aggregate({
    where: { userId },
    _max: { recordNumber: true },
  });
  return (max._max.recordNumber ?? 0) + 1;
}

async function computeRecordPortfolio(userId: string, recordId: string) {
  const trades = await prisma.paperTrade.findMany({ where: { userId, recordId } });
  const markMap = await buildMarkMap(userId);
  return computePortfolioSnapshot(trades, markMap);
}

export async function getActivePaperRecord(userId: string): Promise<PaperRecord | null> {
  return prisma.paperRecord.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { recordNumber: "desc" },
  });
}

export async function listPaperRecords(userId: string): Promise<PaperRecord[]> {
  return prisma.paperRecord.findMany({
    where: { userId },
    orderBy: { recordNumber: "asc" },
  });
}

export async function ensurePaperRecords(userId: string): Promise<PaperRecord> {
  const existingActive = await getActivePaperRecord(userId);
  if (existingActive) return existingActive;

  const untaggedTrades = await prisma.paperTrade.count({ where: { userId, recordId: null } });
  const now = new Date();

  if (untaggedTrades > 0) {
    const markMap = await buildMarkMap(userId);
    const legacyTrades = await prisma.paperTrade.findMany({ where: { userId, recordId: null } });
    const legacyPortfolio = computePortfolioSnapshot(legacyTrades, markMap);
    const oldestOpened = legacyTrades
      .map((t) => t.openedAt ?? t.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const legacyRecord = await prisma.paperRecord.create({
      data: {
        userId,
        recordNumber: 1,
        recordName: LEGACY_RECORD_NAME,
        strategyVersion: "legacy",
        startedAt: oldestOpened ?? now,
        endedAt: now,
        status: "ARCHIVED",
        startingPaperBalance: SCANNER_CONFIG.simulatedAccountUsd,
        endingPaperBalance: SCANNER_CONFIG.simulatedAccountUsd + legacyPortfolio.totalPnl,
        startingRealizedPnl: 0,
        endingRealizedPnl: legacyPortfolio.realizedPnl,
        startingUnrealizedPnl: 0,
        endingUnrealizedPnl: legacyPortfolio.unrealizedPnl,
        startingTradeCount: legacyTrades.filter(isActionableTrade).length,
        endingTradeCount: legacyTrades.filter(isActionableTrade).length,
        notes: "Auto-archived legacy paper data when record system was enabled.",
      },
    });
    await tagUntaggedPaperData(userId, legacyRecord.id);
  }

  const recordNumber = await nextRecordNumber(userId);
  const markMap = await buildMarkMap(userId);
  const allTrades = await prisma.paperTrade.findMany({ where: { userId } });
  const portfolio = computePortfolioSnapshot(allTrades, markMap);

  return prisma.paperRecord.create({
    data: {
      userId,
      recordNumber,
      recordName: recordNumber === 1 ? DEFAULT_ACTIVE_RECORD_NAME : `Paper Record #${recordNumber}`,
      strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      startedAt: now,
      status: "ACTIVE",
      startingPaperBalance: SCANNER_CONFIG.simulatedAccountUsd + portfolio.totalPnl,
      startingRealizedPnl: 0,
      startingUnrealizedPnl: 0,
      startingTradeCount: 0,
      notes: null,
    },
  });
}

export async function buildRecordMetrics(input: {
  record: PaperRecord;
  trades: DbPaperTrade[];
  allTrades?: DbPaperTrade[];
  latestMarkByTradeId?: Map<string, number>;
  latestRunAt?: Date | null;
}): Promise<PaperRecordMetrics> {
  const markMap = input.latestMarkByTradeId ?? buildRecordMarkMap(input.trades);
  const accounting = buildCurrentRecordAccounting({
    record: input.record,
    recordTrades: input.trades,
    allTrades: input.allTrades,
    markMap,
  });
  const { carried, newTrades } = splitRecordTrades(input.trades);
  const breakdown = computeRecordPerformanceBreakdown({
    record: input.record,
    recordTrades: input.trades,
    allTrades: input.allTrades,
    markMap,
  });
  const summary = buildPaperPerformanceSummary({
    trades: newTrades,
    latestMarkByTradeId: markMap,
  });
  const carriedStats = computeCarriedTradeStats(carried, markMap);
  const carriedClosedTradesDetail = accounting.carriedClosedTradeDetails;
  const cleanFreshStart = accounting.cleanFreshStart;
  const recordVerdicts = buildRecordVerdicts({
    recordPnl: breakdown.recordPnl,
    newRecordRealizedPnl: breakdown.newRecordRealizedPnl,
    newRecordUnrealizedPnl: breakdown.newRecordUnrealizedPnl,
    carriedPnlSinceCarry: breakdown.carriedPnlSinceCarry,
    newTradesSummary: {
      wins: summary.wins,
      losses: summary.losses,
      totalClosedTrades: breakdown.closedTradesInRecord,
      closedTradesInRecord: breakdown.closedTradesInRecord,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor,
    },
    carriedStats,
  });
  const newTradeWinRateLabel =
    breakdown.closedTradesInRecord > 0 && summary.winRate !== null
      ? `${(summary.winRate * 100).toFixed(1)}% from ${breakdown.closedTradesInRecord} closed new trade(s)`
      : "Not enough closed new trades";

  const freshRecordMessage =
    breakdown.closedTradesInRecord === 0 && accounting.newOpenTrades === 0
      ? breakdown.carriedOpenTrades > 0
        ? "Fresh record started. Not enough closed trades yet. Carried open trades are tracked separately."
        : "Fresh record started. Not enough closed trades yet."
      : null;

  return {
    ...summary,
    recordId: input.record.id,
    recordNumber: input.record.recordNumber,
    recordName: input.record.recordName,
    strategyVersion: input.record.strategyVersion,
    startedAt: input.record.startedAt.toISOString(),
    endedAt: input.record.endedAt?.toISOString() ?? null,
    status: input.record.status,
    startingPaperBalance: accounting.startingEquity,
    currentPaperBalance: accounting.currentEquity,
    recordPnl: accounting.totalRecordPnl,
    recordRealizedPnl: accounting.newRealizedPnl,
    recordUnrealizedPnl: accounting.newUnrealizedPnl,
    newRecordRealizedPnl: accounting.newRealizedPnl,
    newRecordUnrealizedPnl: accounting.newUnrealizedPnl,
    carriedPnlSinceCarry: accounting.carriedTotalPnl,
    allTimePnl: breakdown.allTimePnl,
    totalNetPnl: accounting.totalRecordPnl,
    totalRealizedPnl: accounting.newRealizedPnl,
    totalUnrealizedPnl: accounting.newUnrealizedPnl,
    totalOpenTrades: accounting.newOpenTrades,
    totalClosedTrades: accounting.newClosedTrades,
    newTradesOpened: accounting.newTradesOpened,
    closedTradesInRecord: accounting.newClosedTrades,
    carriedOpenTrades: accounting.carriedOpenTrades,
    latestRunAt: input.latestRunAt?.toISOString() ?? null,
    scopeLabel: "CURRENT_RECORD",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
    freshRecordMessage,
    simpleVerdict: recordVerdicts.simpleVerdict,
    recordVerdicts,
    carriedTradeStats: carriedStats,
    carriedClosedTradesDetail,
    cleanFreshStart,
    newTradeWinRateLabel,
    overallRecordStatus: recordVerdicts.overallRecordStatus,
    currentRecordAccounting: accounting,
  };
}

export async function buildRecordHistoryRows(userId: string): Promise<PaperRecordHistoryRow[]> {
  const records = await listPaperRecords(userId);
  const allTrades = await prisma.paperTrade.findMany({ where: { userId } });
  const markMap = await buildMarkMap(userId);
  const rows: PaperRecordHistoryRow[] = [];

  for (const record of records) {
    const serialized = serializePaperRecord(record);
    const recordTrades = filterTradesByRecordId(allTrades, record.id);
    const { newTrades } = splitRecordTrades(recordTrades);
    const summary = buildPaperPerformanceSummary({ trades: newTrades, latestMarkByTradeId: markMap });

    if (record.status === "ARCHIVED" && record.endingPaperBalance !== null) {
      const { carried } = splitRecordTrades(recordTrades);
      const carriedClosed = carried.filter(
        (t) => t.status === "CLOSED" || t.status === "EXPIRED",
      ).length;
      rows.push({
        ...serialized,
        recordPnl: toNumber(record.endingPaperBalance) - toNumber(record.startingPaperBalance),
        openTrades: 0,
        closedTrades: summary.totalClosedTrades + carriedClosed,
        totalOpenedTrades: summary.totalClosedTrades + summary.totalOpenTrades,
        newRecordUnrealizedPnl: 0,
        winRate: summary.winRate,
        profitFactor: summary.profitFactor,
      });
    } else {
      const breakdown = computeRecordPerformanceBreakdown({
        record,
        recordTrades,
        allTrades,
        markMap,
      });
      const { carried } = splitRecordTrades(recordTrades);
      const carriedClosed = carried.filter(
        (t) => t.status === "CLOSED" || t.status === "EXPIRED",
      ).length;
      rows.push({
        ...serialized,
        recordPnl: breakdown.recordPnl,
        openTrades: breakdown.newOpenTrades + breakdown.carriedOpenTrades,
        closedTrades: breakdown.closedTradesInRecord + carriedClosed,
        totalOpenedTrades: breakdown.newTradesOpened,
        newRecordUnrealizedPnl: breakdown.newRecordUnrealizedPnl,
        winRate: summary.winRate,
        profitFactor: summary.profitFactor,
      });
    }
  }

  return rows;
}

export function buildRecordComparison(records: PaperRecordHistoryRow[]): PaperRecordComparison {
  const withMetrics = records.filter((r) => r.closedTrades > 0 || r.recordPnl !== null);
  const bestByPnl = [...withMetrics].sort((a, b) => (b.recordPnl ?? 0) - (a.recordPnl ?? 0))[0];
  const bestByProfitFactor = [...withMetrics]
    .filter((r) => r.profitFactor !== null)
    .sort((a, b) => (b.profitFactor ?? 0) - (a.profitFactor ?? 0))[0];
  const bestWinRate = [...withMetrics]
    .filter((r) => r.winRate !== null)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0];

  let plainEnglishVerdict =
    withMetrics.length < 2
      ? "Not enough archived records yet to compare performance across tests."
      : "Compare archived records using P&L, profit factor, and average loss.";

  if (withMetrics.length >= 2 && bestByPnl && bestByProfitFactor) {
    plainEnglishVerdict =
      `Record #${bestByPnl.recordNumber} (${bestByPnl.recordName}) had the best simulated P&L ` +
      `(${(bestByPnl.recordPnl ?? 0).toFixed(2)} SIM). ` +
      `Record #${bestByProfitFactor.recordNumber} had the best profit factor ` +
      `(${(bestByProfitFactor.profitFactor ?? 0).toFixed(2)}).`;
  }

  return {
    bestByPnl: bestByPnl
      ? { recordNumber: bestByPnl.recordNumber, recordName: bestByPnl.recordName, value: bestByPnl.recordPnl ?? 0 }
      : null,
    bestByProfitFactor: bestByProfitFactor
      ? {
          recordNumber: bestByProfitFactor.recordNumber,
          recordName: bestByProfitFactor.recordName,
          value: bestByProfitFactor.profitFactor ?? 0,
        }
      : null,
    worstByDrawdown: null,
    lowestAverageLoss: null,
    bestWinRate: bestWinRate
      ? {
          recordNumber: bestWinRate.recordNumber,
          recordName: bestWinRate.recordName,
          value: bestWinRate.winRate ?? 0,
        }
      : null,
    plainEnglishVerdict,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export async function startNewPaperRecord(input: {
  userId: string;
  recordName?: string;
  notes?: string;
  carryOpenTrades?: boolean;
  startMode?: PaperRecordStartMode;
}): Promise<StartNewRecordResult> {
  const startMode = input.startMode ?? "soft";
  await ensurePaperRecords(input.userId);
  const active = await getActivePaperRecord(input.userId);
  if (!active) {
    throw new Error("Failed to resolve active paper record");
  }

  const openTrades = await prisma.paperTrade.findMany({
    where: { userId: input.userId, status: "OPEN", recordId: active.id },
  });
  const actionableOpen = openTrades.filter(isActionableTrade);

  if (actionableOpen.length > 0 && startMode === "clean") {
    const symbols = [...new Set(actionableOpen.map((t) => t.symbol))];
    return {
      ok: false,
      reason: "OPEN_TRADES_EXIST",
      openTradeCount: actionableOpen.length,
      startMode: "clean",
      message:
        `Clean Fresh Start requires no open paper trades in the active record. ` +
        `Blocking: ${actionableOpen.length} open trade(s) (${symbols.join(", ")}). ` +
        `Choose Soft Fresh Start to carry them separately, or wait until they close.`,
    };
  }

  if (actionableOpen.length > 0 && !input.carryOpenTrades) {
    return {
      ok: false,
      reason: "OPEN_TRADES_EXIST",
      openTradeCount: actionableOpen.length,
      startMode: "soft",
      message:
        "You have open paper trades in the active record. Carry them into the new record or wait until they close.",
    };
  }

  const now = new Date();
  const markMap = await buildMarkMap(input.userId);
  const activeTrades = await prisma.paperTrade.findMany({
    where: { userId: input.userId, recordId: active.id },
  });
  const allTradesNow = await prisma.paperTrade.findMany({ where: { userId: input.userId } });
  const portfolioNow = computePortfolioSnapshot(allTradesNow, markMap);
  const accountValueNow = SCANNER_CONFIG.simulatedAccountUsd + portfolioNow.totalPnl;

  const archived = await prisma.paperRecord.update({
    where: { id: active.id },
    data: {
      status: "ARCHIVED",
      endedAt: now,
      endingPaperBalance: accountValueNow,
      endingRealizedPnl: portfolioNow.realizedPnl,
      endingUnrealizedPnl: portfolioNow.unrealizedPnl,
      endingTradeCount: activeTrades.filter(isActionableTrade).length,
    },
  });

  const recordNumber = active.recordNumber + 1;
  const autoName = `Paper Record #${recordNumber}`;

  const newRecord = await prisma.paperRecord.create({
    data: {
      userId: input.userId,
      recordNumber,
      recordName: input.recordName?.trim() || autoName,
      strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      startedAt: now,
      status: "ACTIVE",
      startingPaperBalance: accountValueNow,
      startingRealizedPnl: 0,
      startingUnrealizedPnl: 0,
      startingTradeCount: 0,
      notes: input.notes?.trim() || null,
    },
  });

  let carried = 0;
  if (input.carryOpenTrades && actionableOpen.length > 0) {
    for (const trade of actionableOpen) {
      const baselineUnrealized = tradeUnrealizedAtMark(trade, markMap);
      await prisma.paperTrade.update({
        where: { id: trade.id },
        data: {
          recordId: newRecord.id,
          carriedAt: now,
          carriedBaselineUnrealizedPnl: baselineUnrealized,
          reason: trade.reason.includes(CARRIED_FROM_PREVIOUS_RECORD)
            ? trade.reason
            : `${trade.reason} | ${CARRIED_FROM_PREVIOUS_RECORD}`,
        },
      });
      await prisma.paperTradeSnapshot.updateMany({
        where: { tradeId: trade.id },
        data: { recordId: newRecord.id },
      });
      carried++;
    }
  }

  return {
    ok: true,
    record: serializePaperRecord(newRecord),
    archivedRecord: serializePaperRecord(archived),
    carriedOpenTrades: carried,
    startMode,
    message:
      "New record started. Dashboard now shows this record only. Carried trades are monitored separately.",
  };
}

export function buildRecordActivityFeed(
  runs: Array<{
    startedAt: Date;
    status: string;
    reasonCode: string | null;
    tradesOpened: number;
    tradesUpdated: number;
    tradesClosed: number;
    scanSummary: unknown;
  }>,
  limit = 10,
  options?: {
    newTradesClosedInRecord?: number;
    carriedTradesClosedInRecord?: number;
  },
): RecordActivityEvent[] {
  const events: RecordActivityEvent[] = [];
  for (const run of [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit)) {
    const ts = run.startedAt.toISOString();
    const rejectionSummary = ((run.scanSummary as Record<string, unknown> | null)?.rejectionSummary ??
      {}) as Record<string, number>;
    const rejectionTotal = Object.values(rejectionSummary).reduce((sum, n) => sum + (n ?? 0), 0);
    const runCompleted = run.status === "COMPLETED";

    if (runCompleted) {
      events.push({
        type: "RUN_COMPLETED",
        timestamp: ts,
        summary: `Run completed — opened ${run.tradesOpened}, updated ${run.tradesUpdated}, closed ${run.tradesClosed}.`,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      });
    }

    if (run.tradesOpened > 0) {
      events.push({
        type: "TRADE_OPENED",
        timestamp: ts,
        summary: `Opened ${run.tradesOpened} new paper trade(s) in this record.`,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      });
    } else if (run.reasonCode?.includes("NO_TRADE") || run.reasonCode === "SCAN_COMPLETE") {
      events.push({
        type: "NO_TRADE_BEST_DECISION",
        timestamp: ts,
        summary: `No new entry — ${run.reasonCode ?? "NO_TRADE_BEST_DECISION"}.`,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      });
    }

    if (run.tradesUpdated > 0) {
      const breakdown = (
        (run.scanSummary as Record<string, unknown> | null)?.tradeUpdateBreakdown ?? null
      ) as { newTradesUpdated?: number; carriedTradesUpdated?: number } | null;
      const newUpdated = breakdown?.newTradesUpdated ?? 0;
      const carriedUpdated = breakdown?.carriedTradesUpdated ?? 0;
      if (breakdown && (newUpdated > 0 || carriedUpdated > 0)) {
        if (newUpdated > 0) {
          events.push({
            type: "NEW_TRADE_UPDATED",
            timestamp: ts,
            summary: `Updated ${newUpdated} new record paper trade(s).`,
            simulatedLabel: "SIMULATED_PAPER_ONLY",
          });
        }
        if (carriedUpdated > 0) {
          events.push({
            type: "CARRIED_TRADE_UPDATED",
            timestamp: ts,
            summary: `Updated ${carriedUpdated} carried paper trade(s).`,
            simulatedLabel: "SIMULATED_PAPER_ONLY",
          });
        }
      } else {
        events.push({
          type: "TRADE_UPDATED",
          timestamp: ts,
          summary: `Updated ${run.tradesUpdated} open paper trade(s).`,
          simulatedLabel: "SIMULATED_PAPER_ONLY",
        });
      }
    }

    if (run.tradesClosed > 0) {
      events.push({
        type: "TRADE_CLOSED",
        timestamp: ts,
        summary: `Closed ${run.tradesClosed} paper trade(s) in this run.`,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      });
    }

    if (rejectionTotal > 0) {
      events.push({
        type: "REJECTION_SUMMARY",
        timestamp: ts,
        summary: `Scanner rejections this run: ${rejectionTotal}.`,
        simulatedLabel: "SIMULATED_PAPER_ONLY",
      });
    }
  }

  if (
    options &&
    (options.newTradesClosedInRecord !== undefined || options.carriedTradesClosedInRecord !== undefined)
  ) {
    const newClosed = options.newTradesClosedInRecord ?? 0;
    const carriedClosed = options.carriedTradesClosedInRecord ?? 0;
    events.unshift({
      type: "RECORD_HISTORY_SYNC",
      timestamp: runs[0]?.startedAt.toISOString() ?? new Date().toISOString(),
      summary: `Record trade history synced: ${newClosed} closed new trade(s), ${carriedClosed} closed carried trade(s).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    });
  }

  return events.slice(0, limit);
}

export function buildRecordBotHealthCheck(input: {
  latestRun: {
    startedAt: Date | null;
    status: string | null;
    reasonCode: string | null;
    tradesUpdated: number;
    candidatesStored: number;
    coinsDiscovered: number | null;
  } | null;
  activityCounts: RecordActivityCounts;
}): RecordBotHealthCheck {
  const latestRunCompleted = input.latestRun?.status === "COMPLETED";
  const latestRunTime = input.latestRun?.startedAt?.toISOString() ?? null;
  const latestRunUpdatedTrades = (input.latestRun?.tradesUpdated ?? 0) > 0;
  const currentReason = input.latestRun?.reasonCode ?? null;
  const candidatesScanned =
    input.latestRun?.coinsDiscovered ??
    input.activityCounts.candidatesScannedInRecord ??
    input.latestRun?.candidatesStored ??
    0;

  const isWorking =
    input.activityCounts.runsCompletedInRecord > 0 &&
    (latestRunCompleted ||
      input.activityCounts.tradesUpdatedInRecord > 0 ||
      input.activityCounts.candidatesScannedInRecord > 0);

  let plainEnglishSummary = "No paper evidence runs in this record yet.";
  if (isWorking) {
    const parts: string[] = ["Bot is working."];
    if (latestRunCompleted) parts.push("It completed a run");
    if (candidatesScanned > 0) parts.push(`scanned ${candidatesScanned} coins`);
    if (input.activityCounts.carriedTradesMonitored > 0 && input.activityCounts.tradesUpdatedInRecord > 0) {
      parts.push(`updated ${input.activityCounts.carriedTradesMonitored} carried trade(s)`);
    }
    if (input.activityCounts.newTradesOpenedInRecord === 0) {
      parts.push("and skipped new entries because no setup passed the filters");
    }
    plainEnglishSummary = `${parts.join(", ")}.`;
  }

  return {
    isWorking,
    latestRunCompleted: latestRunCompleted ?? false,
    latestRunTime,
    latestRunUpdatedTrades,
    candidatesScanned,
    currentRecordRuns: input.activityCounts.runsCompletedInRecord,
    currentRecordOpenedTrades: input.activityCounts.newTradesOpenedInRecord,
    carriedTradesMonitored: input.activityCounts.carriedTradesMonitored,
    tradesUpdatedInRecord: input.activityCounts.tradesUpdatedInRecord,
    rejectionsInRecord: input.activityCounts.rejectionsInRecord,
    currentReason,
    plainEnglishSummary,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function sumRecordRejectionCounts(
  runs: Array<{ scanSummary: unknown }>,
): number {
  return runs.reduce((total, run) => {
    const rejectionSummary = ((run.scanSummary as Record<string, unknown> | null)?.rejectionSummary ??
      {}) as Record<string, number>;
    return total + Object.values(rejectionSummary).reduce((sum, n) => sum + (n ?? 0), 0);
  }, 0);
}

export function recordHeading(record: SerializedPaperRecord): string {
  return [
    "=".repeat(40),
    `RECORD #${record.recordNumber} — ${record.recordName}`,
    `Strategy Version: ${record.strategyVersion}`,
    `Started: ${record.startedAt}`,
    `Ended: ${record.endedAt ?? "ACTIVE"}`,
    `Status: ${record.status}`,
    "=".repeat(40),
  ].join("\n");
}
