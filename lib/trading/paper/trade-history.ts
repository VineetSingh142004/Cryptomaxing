import type { PaperTrade as DbPaperTrade, PaperTradeResult, PaperTradeStatus } from "@prisma/client";

export type TradeHistoryResult = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" | "NO_TRADE";

export interface PaperTradeHistoryRow {
  tradeNumber: number;
  tradeId: string;
  coin: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  marketType: string;
  leverageUsed: number;
  entryTime: string | null;
  exitTime: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  amountEntered: number | null;
  amountExited: number | null;
  capitalUsed: number | null;
  profitMade: number | null;
  lossTaken: number | null;
  netPnl: number | null;
  pctGainLoss: number | null;
  durationHours: number | null;
  entryReason: string;
  exitReason: string | null;
  followedBotRules: boolean;
  finalResult: TradeHistoryResult;
  strategyName: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface PaperTradeHistorySummary {
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number | null;
  totalProfit: number;
  totalLoss: number;
  netProfitLoss: number;
  averageProfitPerWinner: number | null;
  averageLossPerLoser: number | null;
  bestTrade: { symbol: string; netPnl: number } | null;
  worstTrade: { symbol: string; netPnl: number } | null;
  totalLeverageUsed: number;
  averageLeverageUsed: number | null;
  mostTradedCoin: string | null;
  bestPerformingStrategy: string | null;
  worstPerformingStrategy: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function parseLeverageFromReason(reason: string): number {
  const match = reason.match(/leverage:\s*([\d.]+)x/i);
  if (match) return parseFloat(match[1]) || 1;
  return 1;
}

function parseExitReason(reason: string): string | null {
  const closed = reason.match(/\|\s*closed:\s*([^|]+)/i);
  if (closed) return closed[1].trim();
  return null;
}

function parseEntryReason(reason: string): string {
  const base = reason.split("|")[0]?.trim() ?? reason;
  return base.replace(/^(EXTREME_RISK_PAPER_ONLY|HIGH_VOLATILITY_PAPER_ONLY):\s*/i, "");
}

function parseMarketType(reason: string): string {
  if (/margin|leverage:\s*[2-9]/i.test(reason)) return "margin";
  if (/perp|futures/i.test(reason)) return "perp";
  return "spot";
}

function isClosedStatus(status: PaperTradeStatus): boolean {
  return status === "CLOSED" || status === "EXPIRED";
}

function mapResult(result: PaperTradeResult, status: PaperTradeStatus): TradeHistoryResult {
  if (status === "NO_TRADE") return "NO_TRADE";
  if (status === "OPEN") return "OPEN";
  if (result === "WIN") return "WIN";
  if (result === "LOSS") return "LOSS";
  if (result === "BREAKEVEN") return "BREAKEVEN";
  return "OPEN";
}

function followedBotRules(trade: DbPaperTrade): boolean {
  if (trade.status === "NO_TRADE") return true;
  if (trade.side === "NO_TRADE") return true;
  const entry = toNumber(trade.entryPrice);
  const size = toNumber(trade.simulatedSize);
  return entry !== null && entry > 0 && size !== null && size > 0 && !trade.isRealTrade;
}

export function buildTradeHistoryRow(trade: DbPaperTrade, tradeNumber: number): PaperTradeHistoryRow {
  const entry = toNumber(trade.entryPrice);
  const exit = toNumber(trade.exitPrice);
  const size = toNumber(trade.simulatedSize);
  const net = toNumber(trade.netPaperPnl);
  const riskAmount = toNumber(trade.riskAmount);
  const leverage = parseLeverageFromReason(trade.reason);
  const capitalUsed =
    entry !== null && size !== null ? entry * size : riskAmount;

  let pctGainLoss: number | null = null;
  if (entry !== null && entry > 0 && exit !== null && isClosedStatus(trade.status)) {
    const dir = trade.side === "SHORT" ? -1 : 1;
    pctGainLoss = ((exit - entry) / entry) * 100 * dir;
  } else if (entry !== null && entry > 0 && net !== null && capitalUsed !== null && capitalUsed > 0) {
    pctGainLoss = (net / capitalUsed) * 100;
  }

  let durationHours: number | null = null;
  if (trade.openedAt) {
    const end = trade.closedAt ?? new Date();
    durationHours = Math.round(((end.getTime() - trade.openedAt.getTime()) / 3_600_000) * 10) / 10;
  }

  const profitMade = net !== null && net > 0 ? net : null;
  const lossTaken = net !== null && net < 0 ? Math.abs(net) : null;

  return {
    tradeNumber,
    tradeId: trade.id,
    coin: trade.symbol,
    baseAsset: trade.baseAsset,
    quoteAsset: trade.quoteAsset,
    exchange: trade.dataSource ?? "kraken",
    marketType: parseMarketType(trade.reason),
    leverageUsed: leverage,
    entryTime: trade.openedAt?.toISOString() ?? null,
    exitTime: trade.closedAt?.toISOString() ?? null,
    entryPrice: entry,
    exitPrice: exit,
    amountEntered: size,
    amountExited: isClosedStatus(trade.status) ? size : null,
    capitalUsed,
    profitMade,
    lossTaken,
    netPnl: net,
    pctGainLoss,
    durationHours,
    entryReason: parseEntryReason(trade.reason),
    exitReason: parseExitReason(trade.reason),
    followedBotRules: followedBotRules(trade),
    finalResult: mapResult(trade.result, trade.status),
    strategyName: trade.strategyName,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildTradeHistorySummary(rows: PaperTradeHistoryRow[]): PaperTradeHistorySummary {
  const closed = rows.filter((r) => r.finalResult === "WIN" || r.finalResult === "LOSS" || r.finalResult === "BREAKEVEN");
  const winners = closed.filter((r) => r.finalResult === "WIN");
  const losers = closed.filter((r) => r.finalResult === "LOSS");
  const breakevens = closed.filter((r) => r.finalResult === "BREAKEVEN");

  const totalProfit = winners.reduce((s, r) => s + (r.netPnl ?? 0), 0);
  const totalLoss = losers.reduce((s, r) => s + Math.abs(r.netPnl ?? 0), 0);
  const netProfitLoss = closed.reduce((s, r) => s + (r.netPnl ?? 0), 0);

  const coinCounts = new Map<string, number>();
  for (const r of rows.filter((r) => r.finalResult !== "NO_TRADE")) {
    coinCounts.set(r.baseAsset, (coinCounts.get(r.baseAsset) ?? 0) + 1);
  }
  const mostTradedCoin =
    [...coinCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const strategyPnl = new Map<string, number>();
  for (const r of closed) {
    strategyPnl.set(r.strategyName, (strategyPnl.get(r.strategyName) ?? 0) + (r.netPnl ?? 0));
  }
  const strategyEntries = [...strategyPnl.entries()];
  const bestPerformingStrategy =
    strategyEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const worstPerformingStrategy =
    strategyEntries.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;

  const closedWithPnl = closed.filter((r) => r.netPnl !== null);
  const best = closedWithPnl.length
    ? closedWithPnl.reduce((a, b) => ((a.netPnl ?? 0) > (b.netPnl ?? 0) ? a : b))
    : null;
  const worst = closedWithPnl.length
    ? closedWithPnl.reduce((a, b) => ((a.netPnl ?? 0) < (b.netPnl ?? 0) ? a : b))
    : null;

  const leverageRows = rows.filter((r) => r.finalResult !== "NO_TRADE");
  const totalLeverageUsed = leverageRows.reduce((s, r) => s + r.leverageUsed, 0);

  return {
    totalTrades: closed.length,
    profitableTrades: winners.length,
    losingTrades: losers.length,
    breakevenTrades: breakevens.length,
    winRate: closed.length > 0 ? winners.length / closed.length : null,
    totalProfit,
    totalLoss,
    netProfitLoss,
    averageProfitPerWinner: winners.length > 0 ? totalProfit / winners.length : null,
    averageLossPerLoser: losers.length > 0 ? totalLoss / losers.length : null,
    bestTrade: best ? { symbol: best.coin, netPnl: best.netPnl ?? 0 } : null,
    worstTrade: worst ? { symbol: worst.coin, netPnl: worst.netPnl ?? 0 } : null,
    totalLeverageUsed,
    averageLeverageUsed: leverageRows.length > 0 ? totalLeverageUsed / leverageRows.length : null,
    mostTradedCoin,
    bestPerformingStrategy,
    worstPerformingStrategy,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildPaperTradeHistory(trades: DbPaperTrade[]) {
  const actionable = trades.filter((t) => t.status !== "NO_TRADE" && t.side !== "NO_TRADE");
  const rows = actionable
    .map((t, i) => buildTradeHistoryRow(t, actionable.length - i))
    .sort((a, b) => (b.entryTime ?? "").localeCompare(a.entryTime ?? ""));

  return {
    rows,
    summary: buildTradeHistorySummary(rows),
    simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
    warning: "All trade history values are simulated paper trades — not real profit or loss",
  };
}
