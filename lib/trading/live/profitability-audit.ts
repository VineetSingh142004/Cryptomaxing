import type { LiveProfitabilityAuditResult, LiveTradeRecord } from "@/lib/trading/live/types";

function netPnl(t: LiveTradeRecord): number {
  return t.grossPnl - t.fees - t.spreadCost - t.slippage - t.funding - (t.stopSlippage ?? 0) - (t.emergencyExitSlippage ?? 0);
}

function holdHours(t: LiveTradeRecord): number {
  const ms = new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

function maxDrawdownFromNet(trades: LiveTradeRecord[]): number {
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

function longestLosingStreak(trades: LiveTradeRecord[]): number {
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

export function auditLiveProfitability(input: {
  strategyId: string;
  period: string;
  trades: LiveTradeRecord[];
  expectedDrawdown?: number;
  verifiedOnly?: boolean;
}): LiveProfitabilityAuditResult {
  const reasonCodes: string[] = [];
  let trades = input.trades.filter((t) => t.strategyId === input.strategyId);

  if (input.verifiedOnly !== false) {
    trades = trades.filter((t) => t.reconciled !== false);
  }

  if (trades.length === 0) {
    return {
      strategyId: input.strategyId,
      period: input.period,
      grossPnl: 0,
      netPnl: 0,
      realizedFees: 0,
      realizedSpreadCost: 0,
      realizedSlippage: 0,
      realizedFunding: 0,
      missedFills: 0,
      partialFills: 0,
      rejectedOrders: 0,
      stopSlippageTotal: 0,
      emergencyExitSlippageTotal: 0,
      averageEntryQuality: null,
      averageExitQuality: null,
      fillProbability: null,
      averageHoldTimeHours: null,
      averageTimeToTargetHours: null,
      maxDrawdown: 0,
      consecutiveLosses: 0,
      liveExpectancy: null,
      liveProfitFactor: null,
      liveWinRate: null,
      averageWin: null,
      averageLoss: null,
      largestLoss: 0,
      bestTradeContribution: null,
      worstTradeContribution: null,
      luckyTradeDominance: null,
      tradeCount: 0,
      decision: "INSUFFICIENT_DATA",
      reasonCodes: ["NO_VERIFIED_LIVE_TRADES"],
      auditedAt: new Date().toISOString(),
    };
  }

  const nets = trades.map(netPnl);
  const grossPnl = trades.reduce((s, t) => s + t.grossPnl, 0);
  const netPnlTotal = nets.reduce((s, n) => s + n, 0);
  const wins = trades.filter((_, i) => nets[i]! > 0);
  const losses = trades.filter((_, i) => nets[i]! <= 0);

  const grossProfit = wins.reduce((s, t, i) => s + nets[trades.indexOf(t)]!, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + netPnl(t), 0));

  const best = Math.max(...nets);
  const worst = Math.min(...nets);
  const luckyTradeDominance = netPnlTotal > 0 ? best / netPnlTotal : null;

  const liveExpectancy = netPnlTotal / trades.length;
  const liveProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const liveWinRate = wins.length / trades.length;

  const entryQ = trades.filter((t) => t.entryQualityScore !== undefined);
  const exitQ = trades.filter((t) => t.exitQualityScore !== undefined);

  let decision: LiveProfitabilityAuditResult["decision"] = "APPROVE";

  if (liveExpectancy < 0) {
    decision = "DISABLE_AUTO";
    reasonCodes.push("NEGATIVE_LIVE_EXPECTANCY");
  }

  const costsRemovedEdge = grossPnl > 0 && netPnlTotal <= 0;
  if (costsRemovedEdge) {
    decision = "DEMOTE";
    reasonCodes.push("COSTS_REMOVED_EDGE");
  }

  if (luckyTradeDominance !== null && luckyTradeDominance > 0.5) {
    decision = decision === "APPROVE" ? "REDUCE" : decision;
    reasonCodes.push("ONE_TRADE_DOMINATES_PROFIT");
  }

  const maxDd = maxDrawdownFromNet(trades);
  const expectedDd = input.expectedDrawdown ?? maxDd * 1.5 + 1;
  if (maxDd > expectedDd) {
    decision = "REDUCE";
    reasonCodes.push("DRAWDOWN_EXCEEDS_EXPECTED");
  }

  if (netPnlTotal <= 0 && grossPnl > 0) {
    reasonCodes.push("GROSS_NOT_USED_FOR_APPROVAL");
  }

  return {
    strategyId: input.strategyId,
    period: input.period,
    grossPnl,
    netPnl: netPnlTotal,
    realizedFees: trades.reduce((s, t) => s + t.fees, 0),
    realizedSpreadCost: trades.reduce((s, t) => s + t.spreadCost, 0),
    realizedSlippage: trades.reduce((s, t) => s + t.slippage, 0),
    realizedFunding: trades.reduce((s, t) => s + t.funding, 0),
    missedFills: trades.filter((t) => t.missedFill).length,
    partialFills: trades.filter((t) => t.partialFill).length,
    rejectedOrders: trades.filter((t) => t.rejected).length,
    stopSlippageTotal: trades.reduce((s, t) => s + (t.stopSlippage ?? 0), 0),
    emergencyExitSlippageTotal: trades.reduce((s, t) => s + (t.emergencyExitSlippage ?? 0), 0),
    averageEntryQuality: entryQ.length > 0 ? entryQ.reduce((s, t) => s + (t.entryQualityScore ?? 0), 0) / entryQ.length : null,
    averageExitQuality: exitQ.length > 0 ? exitQ.reduce((s, t) => s + (t.exitQualityScore ?? 0), 0) / exitQ.length : null,
    fillProbability: trades.some((t) => t.fillProbability !== undefined)
      ? trades.reduce((s, t) => s + (t.fillProbability ?? 0), 0) / trades.length
      : null,
    averageHoldTimeHours: trades.reduce((s, t) => s + holdHours(t), 0) / trades.length,
    averageTimeToTargetHours: null,
    maxDrawdown: maxDd,
    consecutiveLosses: longestLosingStreak(trades),
    liveExpectancy,
    liveProfitFactor,
    liveWinRate,
    averageWin: wins.length > 0 ? grossProfit / wins.length : null,
    averageLoss: losses.length > 0 ? grossLoss / losses.length : null,
    largestLoss: worst,
    bestTradeContribution: netPnlTotal !== 0 ? best / Math.abs(netPnlTotal) : null,
    worstTradeContribution: netPnlTotal !== 0 ? worst / Math.abs(netPnlTotal) : null,
    luckyTradeDominance,
    tradeCount: trades.length,
    decision,
    reasonCodes,
    auditedAt: new Date().toISOString(),
  };
}
