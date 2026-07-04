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
  mapLegacyCloseReason,
  type PaperExitReason,
} from "@/lib/trading/paper/thesis-invalidation";
import { explainLosingTrade } from "@/lib/trading/paper/risk-explanation";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import {
  resolveEffectiveMaxOpenTrades,
  countCorrelatedTrades,
} from "@/lib/trading/paper/dynamic-capacity";

export type PaperRunAction =
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

  if (!shouldClose && snapshot && entry !== null) {
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
              ].includes(mappedReason)
            ? "LOSS"
            : classifyResult(pnl.net);

  const closeNote = riskExplanation
    ? `${trade.reason} | closed: ${closeReason} | risk: ${riskExplanation}`
    : `${trade.reason} | closed: ${closeReason}`;

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

async function getPaperEvidenceCountSnapshot(userId: string): Promise<PaperEvidenceCountSnapshot> {
  const [paperRuns, candidatesStored, signalsStored, snapshotsStored] = await Promise.all([
    prisma.paperEvidenceRun.count({ where: { userId } }),
    prisma.paperScanCandidate.count({ where: { run: { userId } } }),
    prisma.paperSignal.count({ where: { userId } }),
    prisma.paperTradeSnapshot.count({
      where: { trade: { userId } },
    }),
  ]);
  return { paperRuns, candidatesStored, signalsStored, snapshotsStored };
}

async function storeCandidateSafe(
  runId: string,
  userId: string,
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
    const prepared = prepareCandidateWriteData(runId, userId, c);
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

function serializeCandidate(c: ScanCandidate) {
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
    rank: c.rank,
  };
}

export async function getLastRunScannerSummary(userId: string) {
  const lastRun = await prisma.paperEvidenceRun.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
    include: {
      candidates: { orderBy: { opportunityScore: "desc" }, take: 50 },
    },
  });

  if (!lastRun) return null;

  const summary = (lastRun.scanSummary ?? {}) as Record<string, unknown>;
  const rejectionSummary = (summary.rejectionSummary ?? {}) as Record<string, number>;

  const allCandidates = lastRun.candidates.map((c) => ({
    symbol: c.symbol,
    source: c.source,
    price: toNumber(c.price),
    score: toNumber(c.opportunityScore),
    spreadBps: toNumber(c.spreadBps),
    volume24hUsd: toNumber(c.volume24hUsd),
    change24hPct: toNumber(c.change24hPct),
    riskTier: c.riskTier,
    tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
    action: c.action,
    reason: c.reasonText,
    reasonCode: c.reasonCode,
  }));

  const topCandidates = dedupeBySymbol(allCandidates).slice(0, 5);
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

export async function getPaperEvidenceStats(userId: string) {
  const [
    countSnapshot,
    totalTrades,
    openTrades,
    closedTrades,
    noTradeSignals,
    missedOpportunitiesTotal,
    runs,
  ] = await Promise.all([
    getPaperEvidenceCountSnapshot(userId),
    prisma.paperTrade.count({ where: { userId } }),
    prisma.paperTrade.count({ where: { userId, status: "OPEN" } }),
    prisma.paperTrade.count({
      where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
    }),
    prisma.paperSignal.count({ where: { userId, noTrade: true } }),
    prisma.paperMissedOpportunity.count({ where: { userId } }),
    prisma.paperEvidenceRun.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, errorCount: true },
    }),
  ]);

  const { paperRuns, candidatesStored, signalsStored, snapshotsStored } = countSnapshot;
  const paperEvidenceCountTotal = computePaperEvidenceCountTotal(countSnapshot);

  const closed = await prisma.paperTrade.findMany({
    where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
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
  const availableSlots = Math.max(0, maxOpenTrades - openCount);

  return {
    maxOpenTrades,
    openTrades: openCount,
    availableSlots,
    newTradeOpening: openCount >= maxOpenTrades ? ("BLOCKED" as const) : ("ALLOWED" as const),
    maxOpenTradesBlockReason: openCount >= maxOpenTrades ? "MAX_OPEN_TRADES_REACHED" : null,
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

export async function getPaperStatus() {
  const userId = await resolvePaperUserId();
  const marketData = getMarketDataProviderStatus();
  const stats = await getPaperEvidenceStats(userId);
  const scanner = await getLastRunScannerSummary(userId);
  const modelAccess = await confirmPaperModelsAccessible();
  const latestRun = await prisma.paperEvidenceRun.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
    select: {
      status: true,
      reasonCode: true,
      candidatesStored: true,
      snapshotsStored: true,
      signalsStored: true,
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
  const safetyVerification = verifyPaperSafetyGates();

  return {
    paperModeReady: true,
    marketDataReady: marketData.configured,
    paperRuns: stats.paperRuns,
    candidatesStored: stats.candidatesStored,
    signalsStored: stats.signalsStored,
    snapshotsStored: stats.snapshotsStored,
    paperEvidenceCountTotal: stats.paperEvidenceCountTotal,
    paperEvidenceCount: stats.paperEvidenceCountTotal,
    openPaperTrades: stats.openTrades,
    closedPaperTrades: stats.closedTrades,
    noTradeSignals: stats.noTradeSignals,
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
    lastRunAt: stats.lastRunAt,
    latestRunStatus: latestRun?.status ?? null,
    latestRunReasonCode: latestRun?.reasonCode ?? null,
    currentStatus: stats.evidenceStatus,
    nextAction:
      stats.evidenceStatus === "PASS"
        ? "Continue collecting paper evidence — does not unlock live trading"
        : stats.paperRuns === 0
          ? "Run first paper evidence step"
          : "Keep running paper evidence steps daily",
    simulatedNetPnl: stats.simulatedNetPnl,
    wins: stats.wins,
    losses: stats.losses,
    breakevens: stats.breakevens,
    warning: "Paper P&L is simulated — not live proof",
    prismaClientStale,
    prismaStaleMessage: prismaClientStale ? STALE_PRISMA_MESSAGE : null,
    historicalPrismaWarning:
      modelAccess.stalePrismaDetectedNow && recentWritesSucceeded
        ? "Previous Prisma health check reported stale client, but recent DB writes succeeded."
        : null,
    scanner,
    tradeHistory,
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
  const startedAt = options?.now ?? new Date();
  const fetchSnapshot = options?.fetchSnapshot ?? getMarketSnapshot;
  const buildWide = options?.buildWide ?? buildWideUniverse;

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
  });

  for (const trade of openTrades) {
    try {
      const snapshot = await fetchSnapshot(trade.symbol);
      successfulFetches++;
      const mark = (snapshot.ticker.bid + snapshot.ticker.ask) / 2;
      const { action, snapshotStored, snapshotError } = await updateOpenTrade(
        trade,
        mark,
        now,
        snapshot,
      );
      actions.push(action);
      latestAction = action;
      if (snapshotStored) {
        snapshotsStored++;
      } else {
        snapshotWriteFailures++;
        if (snapshotError) runErrors.push(snapshotError);
      }
      if (action === "TRADE_UPDATED") tradesUpdated++;
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
    const stored = await storeCandidateSafe(run.id, userId, c);
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
    .filter((c) => c.tradableOnConfiguredExchange && c.action === "OPEN_TRADE")
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
          actions.push("PAPER_ROTATION_EXIT");
          latestAction = "PAPER_ROTATION_EXIT";
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
            actions.push("MISSED_OPPORTUNITY");
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
          actions.push("MISSED_OPPORTUNITY");
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
    const strategy = evaluateControlledActiveStrategy(candidate, momentum);
    const { baseAsset, quoteAsset } = parseSymbol(candidate.symbol);

    const signal = await prisma.paperSignal.create({
      data: {
        runId: run.id,
        userId,
        symbol: candidate.symbol,
        side: (strategy.decision === "NO_TRADE" ? "NO_TRADE" : strategy.decision) as PaperTradeSide,
        strategyName: PAPER_CONFIG.strategyName,
        confidence: strategy.confidence,
        reason: isRotationEntry
          ? `PAPER_ROTATION_ENTRY: ${strategy.reasonCode}: ${strategy.reason}`
          : `${strategy.reasonCode}: ${strategy.reason}`,
        noTrade: strategy.decision === "NO_TRADE",
        marketPrice: candidate.price,
      },
    });
    signalsStored++;

    if (strategy.decision === "NO_TRADE") {
      await prisma.paperTrade.create({
        data: {
          userId,
          signalId: signal.id,
          symbol: candidate.symbol,
          baseAsset,
          quoteAsset,
          side: "NO_TRADE",
          strategyName: PAPER_CONFIG.strategyName,
          status: "NO_TRADE",
          result: "NO_TRADE",
          confidence: strategy.confidence,
          reason: `${strategy.reasonCode}: ${strategy.reason}`,
          dataSource: "kraken",
          isRealTrade: false,
          isVerifiedLivePnl: false,
        },
      });
      actions.push("NO_TRADE");
      noTradeCount++;
      latestAction = "NO_TRADE";
      continue;
    }

    const trade = await prisma.paperTrade.create({
      data: {
        userId,
        signalId: signal.id,
        symbol: candidate.symbol,
        baseAsset,
        quoteAsset,
        side: strategy.decision as PaperTradeSide,
        strategyName: PAPER_CONFIG.strategyName,
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
        reason: strategy.warning
          ? `${strategy.warning}: ${strategy.reason}`
          : `${strategy.reason} | leverage: ${strategy.simulatedLeverage ?? 1}x (${strategy.leverageReason ?? "spot"}) | alloc: ${strategy.capitalAllocationPct?.toFixed(2) ?? "?"}%`,
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
    actions.push("TRADE_OPENED");
    latestAction = "TRADE_OPENED";
    tradesOpened++;
    newTradesThisRun++;
    currentOpenCount++;
    activeOpenTrades.push(trade);
  }

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

  const reasonCode = resolveRunReasonCode({
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

  const reasonText =
    runStatus === "NOOP"
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
      },
    },
  });

  const stats = await getPaperEvidenceStats(userId);
  const currentRunPnlDelta = 0;

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
    topCandidates: dedupeBySymbol(ranked.slice(0, 10).map(serializeCandidate)),
    highVolatilityOpportunities: dedupeBySymbol(
      split.highVolatilityCandidates.slice(0, 10).map(serializeCandidate),
    ),
    tradablePaperCandidates: dedupeBySymbol(
      split.tradablePaperCandidates.slice(0, 10).map(serializeCandidate),
    ),
    watchlistOnlyMovers: dedupeBySymbol(
      split.watchlistOnlyCandidates.slice(0, 10).map(serializeCandidate),
    ),
    rejectedCandidates: dedupeBySymbol(rejectedCandidates.slice(0, 10).map(serializeCandidate)),
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
    portfolioSimulatedNetPnl: stats.simulatedNetPnl,
    currentRunPnlDelta,
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
    const run = await prisma.paperEvidenceRun.create({
      data: {
        userId,
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
