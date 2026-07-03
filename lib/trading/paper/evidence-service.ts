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

export type PaperRunAction =
  | "TRADE_OPENED"
  | "TRADE_UPDATED"
  | "TRADE_CLOSED"
  | "NO_TRADE"
  | "MARKET_DATA_FAILED";

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
): Promise<{ action: PaperRunAction; trade: DbPaperTrade }> {
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  const stop = toNumber(trade.plannedStopLoss);
  const tp = toNumber(trade.plannedTakeProfit);

  if (entry === null || size === null || size <= 0) {
    return { action: "TRADE_UPDATED", trade };
  }

  const dir = directionFromSide(trade.side);
  const unrealized =
    dir === "long" ? (markPrice - entry) * size : (entry - markPrice) * size;

  await prisma.paperTradeSnapshot.create({
    data: {
      tradeId: trade.id,
      markPrice,
      unrealizedPnl: unrealized,
      capturedAt: now,
    },
  });

  let shouldClose = false;
  let exitPrice = markPrice;
  let closeReason = "TRADE_UPDATED";

  if (trade.openedAt) {
    const ageHours = (now.getTime() - trade.openedAt.getTime()) / 3_600_000;
    if (ageHours >= PAPER_TRADE_EXPIRY_HOURS) {
      shouldClose = true;
      closeReason = "EXPIRED";
    }
  }

  if (!shouldClose && stop !== null && tp !== null) {
    if (trade.side === "LONG") {
      if (markPrice <= stop) {
        shouldClose = true;
        exitPrice = stop;
        closeReason = "STOP_LOSS";
      } else if (markPrice >= tp) {
        shouldClose = true;
        exitPrice = tp;
        closeReason = "TAKE_PROFIT";
      }
    } else if (trade.side === "SHORT") {
      if (markPrice >= stop) {
        shouldClose = true;
        exitPrice = stop;
        closeReason = "STOP_LOSS";
      } else if (markPrice <= tp) {
        shouldClose = true;
        exitPrice = tp;
        closeReason = "TAKE_PROFIT";
      }
    }
  }

  if (!shouldClose) {
    const updated = await prisma.paperTrade.update({
      where: { id: trade.id },
      data: { updatedAt: now },
    });
    return { action: "TRADE_UPDATED", trade: updated };
  }

  const pnl = computeClosePnl({ side: trade.side, entryPrice: entry, exitPrice, size });
  const result =
    closeReason === "EXPIRED"
      ? classifyResult(pnl.net)
      : closeReason === "STOP_LOSS"
        ? "LOSS"
        : closeReason === "TAKE_PROFIT"
          ? "WIN"
          : classifyResult(pnl.net);

  const updated = await prisma.paperTrade.update({
    where: { id: trade.id },
    data: {
      status: closeReason === "EXPIRED" ? "EXPIRED" : "CLOSED",
      closedAt: now,
      exitPrice: pnl.fillExit,
      grossPaperPnl: pnl.gross,
      estimatedFees: pnl.fees,
      estimatedSlippage: pnl.slippage,
      netPaperPnl: pnl.net,
      result,
      reason: `${trade.reason} | closed: ${closeReason}`,
      isRealTrade: false,
      isVerifiedLivePnl: false,
    },
  });

  return { action: "TRADE_CLOSED", trade: updated };
}

async function storeCandidate(runId: string, userId: string, c: ScanCandidate) {
  await prisma.paperScanCandidate.create({
    data: {
      runId,
      userId,
      symbol: c.symbol,
      source: c.source,
      exchange: c.tradableOnConfiguredExchange ? "kraken" : "none",
      price: c.price,
      spreadBps: c.spreadBps,
      volume24hUsd: c.volume24hUsd,
      change24hPct: c.change24hPct,
      marketCap: c.marketCapUsd,
      riskTier: c.riskTier,
      momentumScore: c.momentumScore,
      volumeSpikeScore: c.volumeSpikeScore,
      volatilityScore: c.volatilityScore,
      liquidityScore: c.liquidityScore,
      spreadScore: c.spreadScore,
      trendScore: c.trendScore,
      opportunityScore: c.opportunityScore,
      dataQualityScore: c.dataQualityScore,
      riskPenalty: c.riskPenalty,
      pumpRiskPenalty: c.pumpRiskPenalty,
      tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
      rank: c.rank ?? null,
      action: c.actionType,
      reasonCode: c.reasonCode,
      reasonText: c.reasonText,
    },
  });
}

async function storeCandidateSafe(
  runId: string,
  userId: string,
  c: ScanCandidate,
): Promise<{ ok: boolean; reasonCode?: string; reasonText?: string }> {
  try {
    await storeCandidate(runId, userId, c);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPrismaStale =
      msg.includes("Unknown arg") ||
      msg.includes("Invalid `prisma") ||
      msg.includes("column") ||
      msg.includes("does not exist");
    return {
      ok: false,
      reasonCode: isPrismaStale ? "PRISMA_CLIENT_STALE" : "DATABASE_WRITE_FAILED",
      reasonText: isPrismaStale
        ? "Prisma client out of date — stop dev server, run npm run db:generate, restart"
        : `Failed to store candidate ${c.symbol}: ${msg.slice(0, 200)}`,
    };
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
    source: c.source,
    price: c.price,
    spreadBps: c.spreadBps,
    volume24hUsd: c.volume24hUsd,
    change24hPct: c.change24hPct,
    marketCapUsd: c.marketCapUsd,
    riskTier: c.riskTier,
    opportunityScore: c.opportunityScore,
    liquidityScore: c.liquidityScore,
    momentumScore: c.momentumScore,
    volatilityScore: c.volatilityScore,
    tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
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
  const [totalRuns, totalSignals, totalTrades, openTrades, closedTrades, noTradeSignals, runs] =
    await Promise.all([
      prisma.paperEvidenceRun.count({ where: { userId } }),
      prisma.paperSignal.count({ where: { userId } }),
      prisma.paperTrade.count({ where: { userId } }),
      prisma.paperTrade.count({ where: { userId, status: "OPEN" } }),
      prisma.paperTrade.count({
        where: { userId, status: { in: ["CLOSED", "EXPIRED"] } },
      }),
      prisma.paperSignal.count({ where: { userId, noTrade: true } }),
      prisma.paperEvidenceRun.findMany({
        where: { userId },
        orderBy: { startedAt: "asc" },
        select: { startedAt: true, errorCount: true },
      }),
    ]);

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
    totalRuns,
    closedTrades: closed.length,
    calendarDays,
    unresolvedDataErrors,
    systemAvailable: true,
  });

  return {
    totalRuns,
    totalSignals,
    totalTrades,
    openTrades,
    closedTrades,
    noTradeSignals,
    wins,
    losses,
    breakevens,
    simulatedNetPnl,
    maxDrawdown,
    lastRunAt: lastRun?.toISOString() ?? null,
    calendarDays,
    unresolvedDataErrors,
    evidenceStatus: evidenceEval.status,
    evidenceNote: evidenceEval.note,
    evidenceProgress: evidenceEval.progress,
  };
}

export async function getPaperStatus() {
  const userId = await resolvePaperUserId();
  const marketData = getMarketDataProviderStatus();
  const stats = await getPaperEvidenceStats(userId);
  const scanner = await getLastRunScannerSummary(userId);

  return {
    paperModeReady: true,
    marketDataReady: marketData.configured,
    openPaperTrades: stats.openTrades,
    closedPaperTrades: stats.closedTrades,
    noTradeSignals: stats.noTradeSignals,
    paperEvidenceCount: stats.totalSignals + stats.totalTrades,
    lastRunAt: stats.lastRunAt,
    currentStatus: stats.evidenceStatus,
    nextAction:
      stats.evidenceStatus === "PASS"
        ? "Continue collecting paper evidence — does not unlock live trading"
        : stats.totalRuns === 0
          ? "Run first paper evidence step"
          : "Keep running paper evidence steps daily",
    simulatedNetPnl: stats.simulatedNetPnl,
    wins: stats.wins,
    losses: stats.losses,
    breakevens: stats.breakevens,
    warning: "Paper P&L is simulated — not live proof",
    scanner,
  };
}

export async function runPaperEvidenceStep(options?: {
  fetchSnapshot?: MarketSnapshotFetcher;
  buildUniverse?: typeof buildPaperSymbolUniverse;
  buildWide?: typeof buildWideUniverse;
  now?: Date;
}) {
  const userId = await resolvePaperUserId();
  const now = options?.now ?? new Date();
  const fetchSnapshot = options?.fetchSnapshot ?? getMarketSnapshot;
  const buildWide = options?.buildWide ?? buildWideUniverse;

  const configCheck = validateScannerConfig();
  if (!configCheck.valid) {
    return buildFailedRunResponse(
      userId,
      now,
      configCheck.reasonCode,
      configCheck.errors.join("; "),
    );
  }

  let universeSize = 0;
  let symbols: string[] = [];
  let wideResult: WideUniverseResult | null = null;

  try {
    wideResult = await buildWide();
    universeSize = wideResult.coinsDiscovered;
    symbols = wideResult.tradablePaperCandidates.map((c) => c.symbol);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reasonCode = msg.startsWith("KRAKEN_UNAVAILABLE") ? "KRAKEN_UNAVAILABLE" : "UNIVERSE_EMPTY";
    return buildFailedRunResponse(userId, now, reasonCode, msg);
  }

  if (symbols.length === 0 && wideResult.watchlistOnlyCandidates.length === 0) {
    return buildFailedRunResponse(userId, now, "UNIVERSE_EMPTY", "No candidates passed universe filters");
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
        startedAt: now,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reasonCode =
      msg.includes("Unknown arg") || msg.includes("column") ? "PRISMA_CLIENT_STALE" : "DATABASE_WRITE_FAILED";
    return buildFailedRunResponse(userId, now, reasonCode, msg);
  }

  const actions: PaperRunAction[] = [];
  let errorCount = 0;
  let tradesUpdated = 0;
  let tradesClosed = 0;
  let tradesOpened = 0;
  let noTradeCount = 0;
  let successfulFetches = 0;
  let failedFetches = 0;
  let staleSymbolCount = 0;
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
      const { action } = await updateOpenTrade(trade, mark, now);
      actions.push(action);
      latestAction = action;
      if (action === "TRADE_UPDATED") tradesUpdated++;
      if (action === "TRADE_CLOSED") tradesClosed++;
    } catch {
      errorCount++;
      failedFetches++;
      actions.push("MARKET_DATA_FAILED");
      latestAction = "MARKET_DATA_FAILED";
    }
  }

  const tickerBySymbol = new Map(
    wideResult.tradablePaperCandidates
      .filter((c) => c.tickerRow)
      .map((c) => [c.symbol, c.tickerRow!]),
  );

  const quickRanked = dedupeBySymbol(
    [...wideResult.tradablePaperCandidates].sort(
      (a, b) => quickScoreFromTiered(b) - quickScoreFromTiered(a),
    ),
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
          riskTier: tiered.riskTier,
          shortTermReturnPct: 0,
          breakoutScore: 0,
          source: tiered.source,
          tradableOnConfiguredExchange: tiered.tradableOnConfiguredExchange,
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
          riskTier: tiered.riskTier,
          shortTermReturnPct: 0,
          breakoutScore: 0,
          source: tiered.source,
          tradableOnConfiguredExchange: tiered.tradableOnConfiguredExchange,
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
  let dbWriteFailures = 0;
  let dbFailureReason: string | undefined;

  for (const c of ranked) {
    const stored = await storeCandidateSafe(run.id, userId, c);
    if (!stored.ok) {
      dbWriteFailures++;
      dbFailureReason = stored.reasonText;
      errorCount++;
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

  for (const candidate of topToEvaluate) {
    if (newTradesThisRun >= SCANNER_CONFIG.maxNewTradesPerRun) break;
    if (currentOpenCount >= SCANNER_CONFIG.maxOpenTrades) {
      noTradeCount++;
      continue;
    }

    const existingOpen = await prisma.paperTrade.findFirst({
      where: { userId, symbol: candidate.symbol, status: "OPEN" },
    });
    if (existingOpen) {
      noTradeCount++;
      continue;
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
        reason: `${strategy.reasonCode}: ${strategy.reason}`,
        noTrade: strategy.decision === "NO_TRADE",
        marketPrice: candidate.price,
      },
    });

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
          : strategy.reason,
        dataSource: "kraken",
        isRealTrade: false,
        isVerifiedLivePnl: false,
      },
    });

    openedTrades.push({
      ...serializePaperTrade(trade),
      riskTier: strategy.riskTier,
      riskPercent: strategy.riskPercent,
      warning: strategy.warning,
    });
    actions.push("TRADE_OPENED");
    latestAction = "TRADE_OPENED";
    tradesOpened++;
    newTradesThisRun++;
    currentOpenCount++;
  }

  const averageSpreadBps =
    spreadSamples.length > 0 ? spreadSamples.reduce((s, v) => s + v, 0) / spreadSamples.length : null;

  const marketDataStatus =
    successfulFetches === 0 && scanSymbols.length > 0
      ? "MARKET_DATA_FAILED"
      : failedFetches > 0 || dbWriteFailures > 0
        ? "MARKET_DATA_PARTIAL"
        : "OK";

  const runWarnings = [
    "Paper P&L is simulated.",
    "This does not unlock live trading.",
    "Auto remains locked.",
    "Do not treat paper results as real profit.",
    "EXTREME_RISK candidates are paper-only watchlist/trades.",
  ];
  if (wideResult.coingeckoStatus === "unavailable") {
    runWarnings.push(`COINGECKO_UNAVAILABLE: ${wideResult.coingeckoError ?? "fallback to Kraken only"}`);
  }
  if (dbWriteFailures > 0) {
    runWarnings.push(dbFailureReason ?? "DATABASE_WRITE_FAILED: some candidates not stored");
  }
  if (marketDataStatus === "MARKET_DATA_PARTIAL") {
    runWarnings.push("MARKET_DATA_PARTIAL: some symbols failed to fetch");
  }

  const runStatus =
    dbWriteFailures > 0 && dbWriteFailures === ranked.length
      ? "FAILED"
      : errorCount > 0 || failedFetches > 0
        ? "PARTIAL"
        : "COMPLETED";

  await prisma.paperEvidenceRun.update({
    where: { id: run.id },
    data: {
      status: runStatus,
      actions,
      errorCount: errorCount + dbWriteFailures,
      completedAt: now,
      rankedCandidateCount: ranked.length,
      evaluatedCandidateCount: topToEvaluate.length,
      coinsEvaluated: scanSymbols.length,
      watchlistCount: split.watchlistOnlyCandidates.length,
      highVolCount: split.highVolatilityCandidates.length,
      tradesOpened,
      tradesUpdated,
      tradesClosed,
      noTradeCount,
      successfulFetches,
      failedFetches,
      averageSpreadBps,
      staleSymbolCount,
      scanSummary: {
        rejectionSummary,
        marketDataStatus,
        coingeckoStatus: wideResult.coingeckoStatus,
        krakenStatus: wideResult.krakenStatus,
        dbWriteFailures,
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

  return {
    runId: run.id,
    status: runStatus,
    reasonCode: runStatus === "FAILED" ? (dbFailureReason ? "DATABASE_WRITE_FAILED" : "MARKET_DATA_FAILED") : undefined,
    reasonText: dbFailureReason,
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
    errorCount: errorCount + dbWriteFailures,
    symbols,
    openPaperTrades: stats.openTrades,
    closedPaperTrades: stats.closedTrades,
    noTradeSignals: stats.noTradeSignals,
    simulatedNetPnl: stats.simulatedNetPnl,
    warnings: runWarnings,
    autoUnlocked: false,
    liveOrdersPlaced: false,
  };
}

async function buildFailedRunResponse(
  userId: string,
  now: Date,
  reasonCode: string,
  reasonText: string,
) {
  let runId = "unknown";
  try {
    const run = await prisma.paperEvidenceRun.create({
      data: {
        userId,
        status: "FAILED",
        symbols: [],
        marketDataReady: getMarketDataProviderStatus().configured,
        universeSize: 0,
        scannedSymbolCount: 0,
        errorCount: 1,
        startedAt: now,
        completedAt: now,
        scanSummary: { rejectionSummary: { [reasonCode]: 1 }, reasonText, reasonCode },
      },
    });
    runId = run.id;
  } catch {
    // DB unavailable — still return safe payload
  }

  return {
    runId,
    status: "FAILED" as const,
    reasonCode,
    reasonText,
    latestAction: "MARKET_DATA_FAILED" as PaperRunAction,
    universeSize: 0,
    scannedSymbolCount: 0,
    rankedCandidateCount: 0,
    evaluatedCandidateCount: 0,
    tradesOpened: 0,
    tradesUpdated: 0,
    tradesClosed: 0,
    noTradeCount: 1,
    topCandidates: [],
    rejectedCandidates: [],
    openedTrades: [],
    rejectionSummary: { [reasonCode]: 1 },
    actions: ["MARKET_DATA_FAILED"],
    errorCount: 1,
    symbols: [],
    openPaperTrades: 0,
    closedPaperTrades: 0,
    noTradeSignals: 0,
    simulatedNetPnl: 0,
    warnings: [
      `[${reasonCode}] ${reasonText}`,
      "Paper P&L is simulated.",
      "Auto remains locked.",
    ],
    autoUnlocked: false,
    liveOrdersPlaced: false,
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

export async function getPaperTradesList(userId?: string) {
  const uid = userId ?? (await resolvePaperUserId());
  const trades = await prisma.paperTrade.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const serialized = trades.map(serializePaperTrade);
  return {
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
  return {
    ...stats,
    scanner,
    warning: "Paper evidence is not live proof",
    simulatedPnlLabel: "SIMULATED",
  };
}
