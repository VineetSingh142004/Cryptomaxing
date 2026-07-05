import type { PaperTrade as DbPaperTrade, PaperTradeSide } from "@prisma/client";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import { buildTradeHistoryRow, type PaperTradeHistoryRow } from "@/lib/trading/paper/trade-history";

export interface PaperPortfolioSnapshot {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openExposureUsd: number;
  maxExposureUsedUsd: number;
  largestSingleTradeUsd: number;
}

export interface PaperPerformanceSummary {
  startingPaperBalance: number;
  currentPaperBalance: number;
  totalNetPnl: number;
  totalGrossProfit: number;
  totalGrossLoss: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  currentRunRealizedPnl: number | null;
  currentRunUnrealizedPnlChange: number | null;
  totalClosedTrades: number;
  totalOpenTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  averageWinningTrade: number | null;
  averageLosingTrade: number | null;
  profitFactor: number | null;
  expectancyPerTrade: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  bestCoin: string | null;
  worstCoin: string | null;
  mostTradedCoin: string | null;
  averageTradeDurationHours: number | null;
  stopLossHitCount: number;
  takeProfitHitCount: number;
  expiryExitCount: number;
  thesisInvalidationExitCount: number;
  currentExposurePct: number | null;
  maxExposureUsedPct: number | null;
  largestSingleTradeExposurePct: number | null;
  /** Capital notional deployed in open trades (can exceed 100% with leverage). */
  capitalExposurePct: number | null;
  /** Sum of risk-at-stop amounts vs account — this is what maxTotalExposurePercent enforces. */
  riskAtStopPct: number | null;
  exposureExplanation: string | null;
  maxDrawdownSimulated: number | null;
  simpleVerdict: string;
  improvementItems: string[];
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface PaperRunPnlDelta {
  portfolioPnlBeforeRun: number;
  portfolioPnlAfterRun: number;
  realizedPnlThisRun: number;
  unrealizedPnlChangeThisRun: number;
  netPnlDeltaThisRun: number;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function directionFromSide(side: PaperTradeSide): "long" | "short" {
  return side === "SHORT" ? "short" : "long";
}

function parseExitReason(reason: string): string | null {
  const closed = reason.match(/\|\s*closed:\s*([^|]+)/i);
  return closed ? closed[1].trim().toUpperCase() : null;
}

function tradeNotional(trade: DbPaperTrade): number {
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  return entry > 0 && size > 0 ? entry * size : 0;
}

/** Peak sum of all simultaneously open position notionals across trade history. */
export function computePeakSimultaneousExposureUsd(trades: DbPaperTrade[]): number {
  type ExposureEvent = { time: number; delta: number };
  const events: ExposureEvent[] = [];
  const now = Date.now();

  for (const trade of trades) {
    if (trade.status === "NO_TRADE" || trade.side === "NO_TRADE" || !trade.openedAt) continue;
    const notional = tradeNotional(trade);
    if (notional <= 0) continue;
    events.push({ time: trade.openedAt.getTime(), delta: notional });
    const endMs =
      trade.status === "OPEN"
        ? now
        : (trade.closedAt?.getTime() ?? trade.openedAt.getTime());
    events.push({ time: endMs, delta: -notional });
  }

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const e of events) {
    current += e.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

export function buildExposureExplanation(input: {
  currentOpenExposurePct: number | null;
  peakSimultaneousExposurePct: number | null;
  largestSingleTradeExposurePct: number | null;
  openTradeCount: number;
  riskAtStopPct?: number | null;
  maxAllowedRiskAtStopPct?: number;
}): string {
  const parts: string[] = [];
  if (input.currentOpenExposurePct !== null) {
    parts.push(
      `Capital exposure (${input.currentOpenExposurePct.toFixed(2)}%) is total open notional vs account — can exceed 100% with leverage.`,
    );
  }
  if (input.riskAtStopPct !== null) {
    parts.push(
      `Risk-at-stop (${input.riskAtStopPct.toFixed(2)}%) is max loss if all stops hit${
        input.maxAllowedRiskAtStopPct !== undefined
          ? ` — limit ${input.maxAllowedRiskAtStopPct}%`
          : ""
      }.`,
    );
  }
  if (input.peakSimultaneousExposurePct !== null) {
    parts.push(
      `Peak capital exposure (${input.peakSimultaneousExposurePct.toFixed(2)}%) is the highest simultaneous open notional in paper history.`,
    );
  }
  if (input.largestSingleTradeExposurePct !== null) {
    parts.push(
      `Largest single trade (${input.largestSingleTradeExposurePct.toFixed(2)}%) is the biggest one-position notional ever used.`,
    );
  }
  if (
    input.currentOpenExposurePct !== null &&
    input.largestSingleTradeExposurePct !== null &&
    input.currentOpenExposurePct > input.largestSingleTradeExposurePct * 1.2 &&
    input.openTradeCount > 1
  ) {
    parts.push(
      "Capital exposure can exceed largest single trade when multiple positions are open at once — this is expected, not a bug.",
    );
  }
  return parts.join(" ");
}

export function buildPerformanceVerdict(s: PaperPerformanceSummary): string {
  if (s.totalClosedTrades === 0) {
    return "No closed trades yet — keep running paper evidence steps to build a track record.";
  }

  const avgWin = s.averageWinningTrade ?? 0;
  const avgLoss = s.averageLosingTrade ?? 0;
  const lossVsWinRatio = avgWin > 0 ? avgLoss / avgWin : avgLoss > 0 ? 999 : 0;
  const winRatePct = s.winRate !== null ? (s.winRate * 100).toFixed(1) : "UNKNOWN";

  if (s.totalNetPnl > 0 && (s.winRate ?? 0) >= 0.6 && lossVsWinRatio >= 1.5) {
    return (
      `The bot is profitable in paper mode, but only slightly (+${s.totalNetPnl.toFixed(2)} SIM). ` +
      `It wins often (${winRatePct}% win rate), but losses are too large compared to wins ` +
      `(avg loss ${avgLoss.toFixed(2)} SIM vs avg win ${avgWin.toFixed(2)} SIM).`
    );
  }
  if (s.totalNetPnl > 0) {
    return (
      `The bot is profitable in paper mode (+${s.totalNetPnl.toFixed(2)} SIM, simulated only). ` +
      `Win rate ${winRatePct}%. Continue collecting evidence — this is not live proof.`
    );
  }
  if (s.totalNetPnl < 0 && (s.winRate ?? 0) >= 0.5) {
    return (
      `The bot wins often (${winRatePct}% win rate) but total paper P&L is negative ` +
      `(${s.totalNetPnl.toFixed(2)} SIM) — average losses outweigh wins.`
    );
  }
  if (s.totalNetPnl < 0) {
    return `The bot is losing in paper mode (${s.totalNetPnl.toFixed(2)} SIM). Review entry filters and risk sizing before more runs.`;
  }
  return "The bot is roughly breakeven in paper mode. More closed trades are needed for a clear verdict.";
}

export function buildImprovementItems(s: PaperPerformanceSummary): string[] {
  const items: string[] = [];
  const avgWin = s.averageWinningTrade ?? 0;
  const avgLoss = s.averageLosingTrade ?? 0;

  if (avgLoss > avgWin * 1.2) items.push("Reduce average loss");
  if (s.thesisInvalidationExitCount > 0 || s.expiryExitCount > s.stopLossHitCount) {
    items.push("Improve early exit logic");
  }
  if (s.stopLossHitCount > 0 || avgLoss > avgWin) items.push("Improve stop-loss logic");
  items.push("Improve risk sizing");
  if (s.largestLoss !== null && avgWin > 0 && Math.abs(s.largestLoss) > avgWin * 3) {
    items.push("Avoid trades where expected loss is too large");
  }
  items.push("Keep collecting paper trades");
  items.push("Do not enable live trading");
  return [...new Set(items)];
}

export function computeUnrealizedForTrade(trade: DbPaperTrade, markPrice: number | null): number {
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  if (entry <= 0 || size <= 0 || markPrice === null) return 0;
  const dir = directionFromSide(trade.side);
  return dir === "long" ? (markPrice - entry) * size : (entry - markPrice) * size;
}

export function computePortfolioSnapshot(
  trades: DbPaperTrade[],
  latestMarkByTradeId?: Map<string, number>,
): PaperPortfolioSnapshot {
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let openExposureUsd = 0;
  let largestSingleTradeUsd = 0;

  for (const trade of trades) {
    if (trade.status === "NO_TRADE" || trade.side === "NO_TRADE") continue;

    const notional = tradeNotional(trade);
    if (notional > 0) largestSingleTradeUsd = Math.max(largestSingleTradeUsd, notional);

    if (trade.status === "OPEN") {
      const mark =
        latestMarkByTradeId?.get(trade.id) ??
        toNumber(trade.entryPrice);
      unrealizedPnl += computeUnrealizedForTrade(trade, mark > 0 ? mark : null);
      openExposureUsd += notional;
    } else if (trade.status === "CLOSED" || trade.status === "EXPIRED") {
      realizedPnl += toNumber(trade.netPaperPnl);
    }
  }

  const peakSimultaneousUsd = computePeakSimultaneousExposureUsd(trades);

  return {
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openExposureUsd,
    maxExposureUsedUsd: peakSimultaneousUsd,
    largestSingleTradeUsd,
  };
}

export function buildPaperPerformanceSummary(input: {
  trades: DbPaperTrade[];
  latestMarkByTradeId?: Map<string, number>;
  maxDrawdown?: number | null;
  currentRunRealizedPnl?: number | null;
  currentRunUnrealizedPnlChange?: number | null;
}): PaperPerformanceSummary {
  const starting = SCANNER_CONFIG.simulatedAccountUsd;
  const portfolio = computePortfolioSnapshot(input.trades, input.latestMarkByTradeId);

  const actionable = input.trades.filter(
    (t) => t.status !== "NO_TRADE" && t.side !== "NO_TRADE",
  );
  const closed = actionable.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");
  const open = actionable.filter((t) => t.status === "OPEN");
  const riskAtStopUsd = open.reduce((s, t) => s + toNumber(t.riskAmount), 0);

  const rows: PaperTradeHistoryRow[] = actionable.map((t, i) =>
    buildTradeHistoryRow(t, actionable.length - i),
  );

  const winners = closed.filter((t) => t.result === "WIN");
  const losers = closed.filter((t) => t.result === "LOSS");
  const breakevens = closed.filter((t) => t.result === "BREAKEVEN");

  const grossProfit = winners.reduce((s, t) => s + Math.max(0, toNumber(t.netPaperPnl)), 0);
  const grossLoss = losers.reduce((s, t) => s + Math.abs(Math.min(0, toNumber(t.netPaperPnl))), 0);
  const totalNet = closed.reduce((s, t) => s + toNumber(t.netPaperPnl), 0);

  const coinPnl = new Map<string, number>();
  const coinCounts = new Map<string, number>();
  for (const t of closed) {
    coinPnl.set(t.baseAsset, (coinPnl.get(t.baseAsset) ?? 0) + toNumber(t.netPaperPnl));
    coinCounts.set(t.baseAsset, (coinCounts.get(t.baseAsset) ?? 0) + 1);
  }
  const coinPnlEntries = [...coinPnl.entries()];
  const bestCoin = coinPnlEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const worstCoin = coinPnlEntries.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
  const mostTradedCoin =
    [...coinCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let stopLossHitCount = 0;
  let takeProfitHitCount = 0;
  let expiryExitCount = 0;
  let thesisInvalidationExitCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const t of closed) {
    const exit = parseExitReason(t.reason);
    if (exit?.includes("STOP_LOSS")) stopLossHitCount++;
    else if (exit?.includes("TAKE_PROFIT")) takeProfitHitCount++;
    else if (exit?.includes("EXPIRY")) expiryExitCount++;
    else if (
      exit?.includes("THESIS") ||
      exit?.includes("MOMENTUM") ||
      exit?.includes("EARLY_LOSS") ||
      exit?.includes("VOLUME_COLLAPSE") ||
      exit?.includes("LIQUIDITY_WEAKENING")
    ) {
      thesisInvalidationExitCount++;
    }
    if (t.openedAt && t.closedAt) {
      durationSum += (t.closedAt.getTime() - t.openedAt.getTime()) / 3_600_000;
      durationCount++;
    }
  }

  const closedPnls = closed.map((t) => toNumber(t.netPaperPnl));
  const largestWin = closedPnls.length ? Math.max(...closedPnls.filter((p) => p > 0), 0) || null : null;
  const largestLoss = closedPnls.length
    ? Math.min(...closedPnls.filter((p) => p < 0), 0) || null
    : null;

  const exposurePct =
    starting > 0 ? (portfolio.openExposureUsd / starting) * 100 : null;
  const peakExposurePct =
    starting > 0 ? (portfolio.maxExposureUsedUsd / starting) * 100 : null;
  const largestSinglePct =
    starting > 0 ? (portfolio.largestSingleTradeUsd / starting) * 100 : null;
  const riskAtStopPct = starting > 0 ? (riskAtStopUsd / starting) * 100 : null;

  const summaryBase = {
    startingPaperBalance: starting,
    currentPaperBalance: starting + portfolio.totalPnl,
    totalNetPnl: portfolio.totalPnl,
    totalGrossProfit: grossProfit,
    totalGrossLoss: grossLoss,
    totalRealizedPnl: portfolio.realizedPnl,
    totalUnrealizedPnl: portfolio.unrealizedPnl,
    currentRunRealizedPnl: input.currentRunRealizedPnl ?? null,
    currentRunUnrealizedPnlChange: input.currentRunUnrealizedPnlChange ?? null,
    totalClosedTrades: closed.length,
    totalOpenTrades: open.length,
    wins: winners.length,
    losses: losers.length,
    breakevens: breakevens.length,
    winRate: closed.length > 0 ? winners.length / closed.length : null,
    averageWinningTrade: winners.length > 0 ? grossProfit / winners.length : null,
    averageLosingTrade: losers.length > 0 ? grossLoss / losers.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : null,
    expectancyPerTrade: closed.length > 0 ? totalNet / closed.length : null,
    largestWin: largestWin && largestWin > 0 ? largestWin : null,
    largestLoss: largestLoss && largestLoss < 0 ? largestLoss : null,
    bestCoin,
    worstCoin,
    mostTradedCoin,
    averageTradeDurationHours:
      durationCount > 0 ? Math.round((durationSum / durationCount) * 10) / 10 : null,
    stopLossHitCount,
    takeProfitHitCount,
    expiryExitCount,
    thesisInvalidationExitCount,
    currentExposurePct: exposurePct,
    capitalExposurePct: exposurePct,
    riskAtStopPct,
    maxExposureUsedPct: peakExposurePct,
    largestSingleTradeExposurePct: largestSinglePct,
    exposureExplanation: buildExposureExplanation({
      currentOpenExposurePct: exposurePct,
      peakSimultaneousExposurePct: peakExposurePct,
      largestSingleTradeExposurePct: largestSinglePct,
      openTradeCount: open.length,
      riskAtStopPct,
      maxAllowedRiskAtStopPct: PAPER_RISK_CONFIG.maxTotalExposurePercent,
    }),
    maxDrawdownSimulated: input.maxDrawdown ?? null,
    simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
  };

  return {
    ...summaryBase,
    simpleVerdict: buildPerformanceVerdict(summaryBase as PaperPerformanceSummary),
    improvementItems: buildImprovementItems(summaryBase as PaperPerformanceSummary),
  };
}

export function computeRunPnlDelta(
  before: PaperPortfolioSnapshot,
  after: PaperPortfolioSnapshot,
  realizedPnlThisRun: number,
): PaperRunPnlDelta {
  const unrealizedChange = after.unrealizedPnl - before.unrealizedPnl;
  return {
    portfolioPnlBeforeRun: before.totalPnl,
    portfolioPnlAfterRun: after.totalPnl,
    realizedPnlThisRun,
    unrealizedPnlChangeThisRun: unrealizedChange,
    netPnlDeltaThisRun: after.totalPnl - before.totalPnl,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildDeepEvaluationExplanation(input: {
  coinsDiscovered: number;
  coinsScanned: number;
  passedFilters: number;
  deepEvaluated: number;
  limit: number;
}): string {
  const skipped = Math.max(0, input.passedFilters - input.deepEvaluated);
  return (
    `All ${input.coinsDiscovered} discovered coins were scanned. ` +
    `Only the top ${input.deepEvaluated} were deeply evaluated because ` +
    `SCANNER_MAX_EVALUATED_COINS=${input.limit}. ` +
    `${skipped} lower-ranked coin(s) skipped deep evaluation (snapshot + scoring).`
  );
}

export function formatMetric(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "UNKNOWN";
  return value.toFixed(digits);
}

export function formatProfitFactorDisplay(
  profitFactor: number | null,
  wins: number,
  losses: number,
): string {
  if (wins > 0 && losses === 0) {
    return "No losses yet — profit factor not meaningful";
  }
  if (profitFactor === null || !Number.isFinite(profitFactor)) {
    return wins === 0 && losses === 0 ? "Not enough data" : "UNKNOWN";
  }
  return profitFactor.toFixed(2);
}
