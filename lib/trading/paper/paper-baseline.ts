import type { PaperTestBaseline, PaperTrade as DbPaperTrade } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import {
  buildPaperPerformanceSummary,
  computePortfolioSnapshot,
  type PaperPerformanceSummary,
} from "@/lib/trading/paper/performance-summary";
import { computeOpenExposureMetrics } from "@/lib/trading/paper/exposure-metrics";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";

export type PaperRiskPerformanceScope = "all_time" | "strategy_version" | "baseline";

export interface PaperBaselineMetrics extends PaperPerformanceSummary {
  baselineId: string;
  strategyVersion: string;
  startedAt: string;
  notes: string | null;
  baselineStartingBalance: number;
  pnlSinceBaseline: number;
  realizedPnlSinceBaseline: number;
  unrealizedPnlSinceBaseline: number;
  tradesOpenedSinceBaseline: number;
  tradesClosedSinceBaseline: number;
  winsSinceBaseline: number;
  lossesSinceBaseline: number;
  winRateSinceBaseline: number | null;
  averageWinSinceBaseline: number | null;
  averageLossSinceBaseline: number | null;
  profitFactorSinceBaseline: number | null;
  expectancySinceBaseline: number | null;
  maxDrawdownSinceBaseline: number | null;
  largestSingleTradeSinceBaseline: number | null;
  noTradeCountSinceBaseline: number;
  rejectedBadRiskRewardCount: number;
  fakePumpWatchRejectCount: number;
  capitalExposurePct: number | null;
  riskAtStopPct: number | null;
  scopeLabel: "CURRENT_BASELINE";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface PaperStrategyVersionMetrics extends PaperPerformanceSummary {
  strategyVersion: string;
  scopeLabel: "CURRENT_STRATEGY_VERSION";
  note: string;
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function isActionableTrade(trade: DbPaperTrade): boolean {
  return trade.status !== "NO_TRADE" && trade.side !== "NO_TRADE";
}

export function filterTradesSinceBaseline(
  trades: DbPaperTrade[],
  baselineStartedAt: Date,
): DbPaperTrade[] {
  return trades.filter((t) => {
    if (!isActionableTrade(t)) return false;
    const opened = t.openedAt ?? t.createdAt;
    return opened.getTime() >= baselineStartedAt.getTime();
  });
}

export function filterTradesByStrategyVersion(
  trades: DbPaperTrade[],
  strategyVersion: string,
): DbPaperTrade[] {
  return trades.filter(
    (t) => isActionableTrade(t) && (t.strategyVersion ?? "legacy") === strategyVersion,
  );
}

export function serializeBaseline(baseline: PaperTestBaseline) {
  return {
    id: baseline.id,
    strategyVersion: baseline.strategyVersion,
    startedAt: baseline.startedAt.toISOString(),
    startingPaperBalance: toNumber(baseline.startingPaperBalance),
    startingRealizedPnl: toNumber(baseline.startingRealizedPnl),
    startingUnrealizedPnl: toNumber(baseline.startingUnrealizedPnl),
    startingTradeCount: baseline.startingTradeCount,
    startingClosedCount: baseline.startingClosedCount,
    startingOpenCount: baseline.startingOpenCount,
    notes: baseline.notes,
    isActive: baseline.isActive,
    createdAt: baseline.createdAt.toISOString(),
  };
}

export async function getActivePaperBaseline(userId: string): Promise<PaperTestBaseline | null> {
  return prisma.paperTestBaseline.findFirst({
    where: { userId, isActive: true },
    orderBy: { startedAt: "desc" },
  });
}

export async function listPaperBaselines(userId: string) {
  const rows = await prisma.paperTestBaseline.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
  });
  return rows.map(serializeBaseline);
}

export async function createPaperTestBaseline(input: {
  userId: string;
  notes?: string;
  strategyVersion?: string;
  now?: Date;
}): Promise<PaperTestBaseline> {
  const now = input.now ?? new Date();
  const strategyVersion = input.strategyVersion ?? CURRENT_PAPER_STRATEGY_VERSION;

  const trades = await prisma.paperTrade.findMany({ where: { userId: input.userId } });
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const openWithSnaps = await prisma.paperTrade.findMany({
    where: { userId: input.userId, status: "OPEN" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  const markMap = new Map<string, number>();
  for (const t of openWithSnaps) {
    const snap = t.snapshots[0];
    const mark = snap ? toNumber(snap.markPrice) : toNumber(t.entryPrice);
    if (mark > 0) markMap.set(t.id, mark);
  }

  const portfolio = computePortfolioSnapshot(trades, markMap);
  const actionable = trades.filter(isActionableTrade);
  const closed = actionable.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");

  await prisma.paperTestBaseline.updateMany({
    where: { userId: input.userId, isActive: true },
    data: { isActive: false },
  });

  return prisma.paperTestBaseline.create({
    data: {
      userId: input.userId,
      strategyVersion,
      startedAt: now,
      startingPaperBalance: SCANNER_CONFIG.simulatedAccountUsd + portfolio.totalPnl,
      startingRealizedPnl: portfolio.realizedPnl,
      startingUnrealizedPnl: portfolio.unrealizedPnl,
      startingTradeCount: actionable.length,
      startingClosedCount: closed.length,
      startingOpenCount: openTrades.length,
      notes: input.notes?.trim() || null,
      isActive: true,
    },
  });
}

async function countCandidateStatsSince(userId: string, since: Date) {
  const [noTradeCount, rejectedBadRr, fakePump] = await Promise.all([
    prisma.paperSignal.count({
      where: { userId, noTrade: true, createdAt: { gte: since } },
    }),
    prisma.paperScanCandidate.count({
      where: {
        userId,
        createdAt: { gte: since },
        reasonCode: { in: ["RISK_REWARD_TOO_WEAK", "REJECTED_BAD_RISK_REWARD"] },
      },
    }),
    prisma.paperScanCandidate.count({
      where: {
        userId,
        createdAt: { gte: since },
        reasonCode: {
          in: [
            "REJECTED_FAKE_PUMP_RISK",
            "WATCH_ONLY_FAKE_PUMP_RISK",
            "PUMP_RISK_TOO_HIGH",
            "WATCHLIST_ONLY",
          ],
        },
      },
    }),
  ]);
  return { noTradeCount, rejectedBadRr, fakePump };
}

export async function buildBaselineMetrics(input: {
  baseline: PaperTestBaseline;
  trades: DbPaperTrade[];
  latestMarkByTradeId?: Map<string, number>;
}): Promise<PaperBaselineMetrics> {
  const sinceTrades = filterTradesSinceBaseline(input.trades, input.baseline.startedAt);
  const summary = buildPaperPerformanceSummary({
    trades: sinceTrades,
    latestMarkByTradeId: input.latestMarkByTradeId,
  });

  const portfolioNow = computePortfolioSnapshot(input.trades, input.latestMarkByTradeId);
  const startBalance = toNumber(input.baseline.startingPaperBalance);
  const startRealized = toNumber(input.baseline.startingRealizedPnl);
  const startUnrealized = toNumber(input.baseline.startingUnrealizedPnl);

  const closedSince = sinceTrades.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");
  const openedSince = sinceTrades.filter((t) => t.openedAt || t.createdAt);
  const winners = closedSince.filter((t) => t.result === "WIN");
  const losers = closedSince.filter((t) => t.result === "LOSS");
  const grossProfit = winners.reduce((s, t) => s + Math.max(0, toNumber(t.netPaperPnl)), 0);
  const grossLoss = losers.reduce((s, t) => s + Math.abs(Math.min(0, toNumber(t.netPaperPnl))), 0);
  const closedNet = closedSince.reduce((s, t) => s + toNumber(t.netPaperPnl), 0);

  const openNow = input.trades.filter((t) => t.status === "OPEN");
  const exposure = computeOpenExposureMetrics({
    openTrades: openNow,
    accountUsd: SCANNER_CONFIG.simulatedAccountUsd,
    riskUsedTodayUsd: 0,
    dailyBudgetUsd: SCANNER_CONFIG.simulatedAccountUsd,
  });

  const candidateStats = await countCandidateStatsSince(
    input.baseline.userId,
    input.baseline.startedAt,
  );

  let largestSingle = 0;
  for (const t of sinceTrades) {
    const entry = toNumber(t.entryPrice);
    const size = toNumber(t.simulatedSize);
    if (entry > 0 && size > 0) largestSingle = Math.max(largestSingle, entry * size);
  }

  return {
    ...summary,
    baselineId: input.baseline.id,
    strategyVersion: input.baseline.strategyVersion,
    startedAt: input.baseline.startedAt.toISOString(),
    notes: input.baseline.notes,
    baselineStartingBalance: startBalance,
    currentPaperBalance: startBalance + (portfolioNow.totalPnl - startRealized - startUnrealized),
    pnlSinceBaseline: portfolioNow.totalPnl - startRealized - startUnrealized,
    realizedPnlSinceBaseline: portfolioNow.realizedPnl - startRealized,
    unrealizedPnlSinceBaseline: portfolioNow.unrealizedPnl - startUnrealized,
    tradesOpenedSinceBaseline: openedSince.length,
    tradesClosedSinceBaseline: closedSince.length,
    winsSinceBaseline: winners.length,
    lossesSinceBaseline: losers.length,
    winRateSinceBaseline: closedSince.length > 0 ? winners.length / closedSince.length : null,
    averageWinSinceBaseline: winners.length > 0 ? grossProfit / winners.length : null,
    averageLossSinceBaseline: losers.length > 0 ? grossLoss / losers.length : null,
    profitFactorSinceBaseline: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null,
    expectancySinceBaseline: closedSince.length > 0 ? closedNet / closedSince.length : null,
    maxDrawdownSinceBaseline: summary.maxDrawdownSimulated,
    largestSingleTradeSinceBaseline:
      largestSingle > 0
        ? (largestSingle / SCANNER_CONFIG.simulatedAccountUsd) * 100
        : null,
    noTradeCountSinceBaseline: candidateStats.noTradeCount,
    rejectedBadRiskRewardCount: candidateStats.rejectedBadRr,
    fakePumpWatchRejectCount: candidateStats.fakePump,
    capitalExposurePct: exposure.capitalExposurePct,
    riskAtStopPct: exposure.riskAtStopPct,
    scopeLabel: "CURRENT_BASELINE",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildStrategyVersionMetrics(input: {
  trades: DbPaperTrade[];
  strategyVersion: string;
  latestMarkByTradeId?: Map<string, number>;
}): PaperStrategyVersionMetrics {
  const filtered = filterTradesByStrategyVersion(input.trades, input.strategyVersion);
  const summary = buildPaperPerformanceSummary({
    trades: filtered,
    latestMarkByTradeId: input.latestMarkByTradeId,
  });
  return {
    ...summary,
    strategyVersion: input.strategyVersion,
    scopeLabel: "CURRENT_STRATEGY_VERSION",
    note: `Includes only trades tagged with strategy version ${input.strategyVersion}. Older untagged trades are excluded.`,
  };
}

export function resolveRiskPerformanceScope(input: {
  activeBaseline: PaperTestBaseline | null;
  requestedScope?: PaperRiskPerformanceScope;
}): PaperRiskPerformanceScope {
  if (input.requestedScope) return input.requestedScope;
  return input.activeBaseline ? "baseline" : "all_time";
}

export function buildAllTimePerformanceNote(hasLegacyTrades: boolean): string {
  if (!hasLegacyTrades) {
    return "All-time performance includes every paper trade recorded.";
  }
  return (
    "All-time performance includes older strategy versions and pre-baseline logic. " +
    "Use current baseline to judge whether the new model is better."
  );
}
