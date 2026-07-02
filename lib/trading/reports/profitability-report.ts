import { attributeProfit } from "@/lib/trading/reports/profit-attribution";
import type { ProfitabilityReport, ProfitabilityReportInput, TradeLike } from "@/lib/trading/reports/types";
import type { LiveTradeRecord } from "@/lib/trading/live/types";

function netPnl(t: TradeLike): number {
  return t.grossPnl - t.fees - t.spreadCost - t.slippage - t.funding - (t.stopSlippage ?? 0);
}

function sumByGroup(trades: TradeLike[], key: (t: TradeLike) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of trades) {
    const k = key(t);
    out[k] = (out[k] ?? 0) + netPnl(t);
  }
  return out;
}

function maxDrawdown(trades: TradeLike[]): number {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
    equity += netPnl(t);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}

function consecutiveLosses(trades: TradeLike[]): number {
  let max = 0;
  let cur = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
    if (netPnl(t) <= 0) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}

function tradeStats(trades: TradeLike[]) {
  const nets = trades.map(netPnl);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : null;
  const averageWin = wins.length > 0 ? wins.reduce((s, n) => s + n, 0) / wins.length : null;
  const averageLoss = losses.length > 0 ? losses.reduce((s, n) => s + n, 0) / losses.length : null;
  const expectancy = trades.length > 0 ? nets.reduce((s, n) => s + n, 0) / trades.length : null;
  const grossWins = wins.reduce((s, n) => s + n, 0);
  const grossLosses = Math.abs(losses.reduce((s, n) => s + n, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null;
  return { winRate, averageWin, averageLoss, expectancy, profitFactor, largestLoss: losses.length ? Math.min(...losses) : 0 };
}

function safeAnnualize(netPnl: number, startEquity: number, days: number): { pct: number | null; warning: string | null } {
  if (days < 30 || startEquity <= 0) {
    return { pct: null, warning: "Annualization suppressed — sample too small (<30 days)" };
  }
  const totalReturn = netPnl / startEquity;
  const annualized = (Math.pow(1 + totalReturn, 365 / days) - 1) * 100;
  if (days < 90) {
    return { pct: annualized, warning: "Annualized figure is indicative only — less than 90 days of data" };
  }
  return { pct: annualized, warning: null };
}

export function buildProfitabilityReport(input: ProfitabilityReportInput): ProfitabilityReport {
  const disclaimers: string[] = [];
  const verifiedTrades = input.trades.filter((t) => t.reconciled !== false);

  if (verifiedTrades.length === 0) {
    disclaimers.push("No verified live trades in period — net P&L is zero by design, not hidden");
  }

  const grossPnl = verifiedTrades.reduce((s, t) => s + t.grossPnl, 0);
  const totalFees = verifiedTrades.reduce((s, t) => s + t.fees, 0);
  const totalSlippage = verifiedTrades.reduce((s, t) => s + t.slippage + (t.stopSlippage ?? 0), 0);
  const totalFunding = verifiedTrades.reduce((s, t) => s + t.funding, 0);
  const totalSpreadCost = verifiedTrades.reduce((s, t) => s + t.spreadCost, 0);
  const realizedNetPnl = verifiedTrades.reduce((s, t) => s + netPnl(t), 0);
  const unrealizedPnl = input.endingEquity - input.startingEquity - realizedNetPnl;

  const stats = tradeStats(verifiedTrades);
  const days =
    (new Date(input.dateRange.end).getTime() - new Date(input.dateRange.start).getTime()) /
    86_400_000;

  const { pct: annualizedReturnPct, warning: annualizationWarning } = safeAnnualize(
    realizedNetPnl,
    input.startingEquity,
    Math.max(1, days),
  );

  let profitabilityClaim: ProfitabilityReport["profitabilityClaim"] = "NOT_PROVEN";
  if (realizedNetPnl < 0 && verifiedTrades.length >= 5) profitabilityClaim = "NEGATIVE";
  else if (input.evidenceLevel >= 12 && input.reconciliation?.status === "RECONCILED" && input.statisticallyMeaningful) {
    profitabilityClaim = "RECONCILED_EDGE";
  } else if (verifiedTrades.length > 0) {
    profitabilityClaim = "INSUFFICIENT_LIVE";
    disclaimers.push("Live trades present but insufficient evidence for proven profitability");
  }

  if (input.evidenceLevel < 10) {
    disclaimers.push("Evidence level below tiny-live — backtest/paper results are not live profit");
  }

  disclaimers.push("Net P&L shown after fees, spread, slippage, and funding — gross P&L is secondary");

  const primaryStrategy = verifiedTrades[0]?.strategyId ?? "unknown";
  const attribution =
    input.attribution ??
    (verifiedTrades.length > 0
      ? attributeProfit({
          period: `${input.dateRange.start}/${input.dateRange.end}`,
          strategyId: primaryStrategy,
          trades: verifiedTrades as LiveTradeRecord[],
          randomBaselineNet: input.randomBaselineNetPnl,
          benchmarkNet: input.benchmarkNetPnl,
        })
      : null);

  const paperNet = input.paperTrades?.reduce((s, t) => s + netPnl(t), 0) ?? null;
  const liveNet = realizedNetPnl;

  return {
    dateRange: input.dateRange,
    startingEquity: input.startingEquity,
    endingEquity: input.endingEquity,
    realizedNetPnl,
    unrealizedPnl,
    grossPnl,
    totalFees,
    totalSlippage,
    totalFunding,
    totalSpreadCost,
    tradeCount: verifiedTrades.length,
    winRate: stats.winRate,
    averageWin: stats.averageWin,
    averageLoss: stats.averageLoss,
    expectancy: stats.expectancy,
    profitFactor: stats.profitFactor === Infinity ? null : stats.profitFactor,
    maxDrawdown: maxDrawdown(verifiedTrades),
    largestLoss: stats.largestLoss,
    consecutiveLosses: consecutiveLosses(verifiedTrades),
    strategyBreakdown: sumByGroup(verifiedTrades, (t) => t.strategyId),
    assetBreakdown: sumByGroup(verifiedTrades, (t) => t.symbol),
    venueBreakdown: sumByGroup(verifiedTrades, (t) => t.venue),
    regimeBreakdown: sumByGroup(verifiedTrades, (t) => t.regime ?? "unknown"),
    benchmarkComparison:
      input.benchmarkNetPnl !== undefined
        ? { benchmarkNet: input.benchmarkNetPnl, alphaVsBenchmark: liveNet - input.benchmarkNetPnl }
        : null,
    randomBaselineComparison:
      input.randomBaselineNetPnl !== undefined
        ? { randomNet: input.randomBaselineNetPnl, alphaVsRandom: liveNet - input.randomBaselineNetPnl }
        : null,
    liveVsPaper:
      paperNet !== null ? { liveNet, paperNet, delta: liveNet - paperNet } : null,
    liveVsBacktest:
      input.backtestNetPnl !== undefined
        ? { liveNet, backtestNet: input.backtestNetPnl, delta: liveNet - input.backtestNetPnl }
        : null,
    executionQualityScore: input.executionQualityScore ?? null,
    reconciliationStatus: input.reconciliation?.status ?? "UNKNOWN",
    evidenceLevel: input.evidenceLevel,
    evidenceLevelChanges: input.evidenceLevelChanges ?? [],
    strategyPromotions: input.strategyPromotions ?? [],
    strategyDemotions: input.strategyDemotions ?? [],
    autoBlocks: input.autoBlocks ?? [],
    moneyProtectedTotal: input.moneyProtectedTotal ?? 0,
    statisticallyMeaningful: input.statisticallyMeaningful,
    edgeTrend: input.edgeTrend,
    annualizedReturnPct,
    annualizationWarning,
    profitabilityClaim,
    disclaimers,
    generatedAt: new Date().toISOString(),
  };
}
