import type { PaperTrade as DbPaperTrade } from "@prisma/client";
import {
  computeUnrealizedForTrade,
  type PaperPerformanceSummary,
} from "@/lib/trading/paper/performance-summary";

export type RecordVerdictCode =
  | "LOSING_OVERALL"
  | "WINNING_OVERALL"
  | "BREAKEVEN_OVERALL"
  | "INSUFFICIENT_DATA"
  | "NEW_TRADES_PROFITABLE_BUT_SMALL_SAMPLE"
  | "NEW_TRADES_LOSING"
  | "NEW_TRADES_BREAKEVEN"
  | "NO_NEW_TRADES_YET"
  | "CARRIED_TRADES_CAUSED_MAJOR_LOSS"
  | "CARRIED_TRADES_MINOR_IMPACT"
  | "NO_CARRIED_TRADES"
  | "CARRIED_TRADES_STILL_OPEN";

export interface RecordVerdict {
  code: RecordVerdictCode;
  message: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface RecordVerdictBundle {
  totalRecordVerdict: RecordVerdict;
  newTradesVerdict: RecordVerdict;
  carriedTradesVerdict: RecordVerdict;
  simpleVerdict: string;
  overallRecordStatus: "Winning" | "Losing" | "Breakeven" | "Insufficient data";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface CarriedTradeStats {
  openCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  realizedPnlSinceCarry: number;
  unrealizedPnlSinceCarry: number;
  totalPnlSinceCarry: number;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface CarriedClosedTradeSnapshot {
  tradeId: string;
  symbol: string;
  side: string;
  originalEntryTime: string;
  carriedIntoRecordTime: string;
  exitTime: string;
  pnlSinceCarry: number | null;
  pnlSinceCarryDisplay: string;
  allTimePnl: number;
  exitReason: string | null;
  thesisStatus: string;
  countsTowardRecordPnl: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface CleanFreshStartStatus {
  available: boolean;
  blockingOpenTradeCount: number;
  blockingSymbols: string[];
  message: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function parseExitReason(reason: string): string | null {
  const closed = reason.match(/\|\s*closed:\s*([^|]+)/i);
  return closed ? closed[1].trim() : null;
}

function hasCarriedBaseline(trade: DbPaperTrade): boolean {
  return trade.carriedBaselineUnrealizedPnl !== null && trade.carriedBaselineUnrealizedPnl !== undefined;
}

function formatPnlSinceCarry(unrealizedSinceCarry: number | null, legacyBaselineMissing: boolean): string {
  if (legacyBaselineMissing) {
    return "Legacy carry baseline missing — start a new record after db:push for accurate carry delta.";
  }
  if (unrealizedSinceCarry === null) return "UNKNOWN";
  return unrealizedSinceCarry.toFixed(4);
}

function carriedBaselineUnrealized(trade: DbPaperTrade): number | null {
  if (hasCarriedBaseline(trade)) return toNumber(trade.carriedBaselineUnrealizedPnl);
  return null;
}

function pnlSinceCarryForTrade(trade: DbPaperTrade, markMap: Map<string, number>): {
  pnlSinceCarry: number | null;
  display: string;
} {
  const baseline = carriedBaselineUnrealized(trade);
  if (baseline === null) {
    return { pnlSinceCarry: null, display: formatPnlSinceCarry(null, true) };
  }
  if (trade.status === "OPEN") {
    const mark = markMap.get(trade.id) ?? toNumber(trade.entryPrice);
    const currentUnrealized = computeUnrealizedForTrade(trade, mark > 0 ? mark : null);
    const delta = currentUnrealized - baseline;
    return { pnlSinceCarry: delta, display: formatPnlSinceCarry(delta, false) };
  }
  if (trade.status === "CLOSED" || trade.status === "EXPIRED") {
    const delta = toNumber(trade.netPaperPnl) - baseline;
    return { pnlSinceCarry: delta, display: formatPnlSinceCarry(delta, false) };
  }
  return { pnlSinceCarry: null, display: "UNKNOWN" };
}

export function computeCarriedTradeStats(
  carriedTrades: DbPaperTrade[],
  markMap: Map<string, number>,
): CarriedTradeStats {
  const open = carriedTrades.filter((t) => t.status === "OPEN");
  const closed = carriedTrades.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");
  const winners = closed.filter((t) => t.result === "WIN");
  const losers = closed.filter((t) => t.result === "LOSS");
  const breakevens = closed.filter((t) => t.result === "BREAKEVEN");

  let realizedPnlSinceCarry = 0;
  let unrealizedPnlSinceCarry = 0;
  for (const trade of carriedTrades) {
    const { pnlSinceCarry } = pnlSinceCarryForTrade(trade, markMap);
    if (pnlSinceCarry === null) continue;
    if (trade.status === "OPEN") unrealizedPnlSinceCarry += pnlSinceCarry;
    else realizedPnlSinceCarry += pnlSinceCarry;
  }

  return {
    openCount: open.length,
    closedCount: closed.length,
    wins: winners.length,
    losses: losers.length,
    breakevens: breakevens.length,
    realizedPnlSinceCarry,
    unrealizedPnlSinceCarry,
    totalPnlSinceCarry: realizedPnlSinceCarry + unrealizedPnlSinceCarry,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildCarriedClosedTradeSnapshots(
  carriedTrades: DbPaperTrade[],
  markMap: Map<string, number>,
): CarriedClosedTradeSnapshot[] {
  return carriedTrades
    .filter((t) => t.status === "CLOSED" || t.status === "EXPIRED")
    .map((trade) => {
      const { pnlSinceCarry, display } = pnlSinceCarryForTrade(trade, markMap);
      return {
        tradeId: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        originalEntryTime: (trade.openedAt ?? trade.createdAt).toISOString(),
        carriedIntoRecordTime: (trade.carriedAt ?? trade.updatedAt).toISOString(),
        exitTime: (trade.closedAt ?? trade.updatedAt).toISOString(),
        pnlSinceCarry,
        pnlSinceCarryDisplay: display,
        allTimePnl: toNumber(trade.netPaperPnl),
        exitReason: parseExitReason(trade.reason),
        thesisStatus: trade.result ?? "UNKNOWN",
        countsTowardRecordPnl: pnlSinceCarry !== null,
        simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
      };
    });
}

export function buildRecordVerdicts(input: {
  recordPnl: number;
  newRecordRealizedPnl: number;
  newRecordUnrealizedPnl: number;
  carriedPnlSinceCarry: number;
  newTradesSummary: Pick<
    PaperPerformanceSummary,
    "wins" | "losses" | "totalClosedTrades" | "winRate" | "profitFactor"
  > & { closedTradesInRecord?: number };
  carriedStats: CarriedTradeStats;
}): RecordVerdictBundle {
  const newClosed =
    input.newTradesSummary.closedTradesInRecord ?? input.newTradesSummary.totalClosedTrades;
  const newRealized = input.newRecordRealizedPnl;
  const newUnrealized = input.newRecordUnrealizedPnl;
  const newNet = newRealized + newUnrealized;

  let overallRecordStatus: RecordVerdictBundle["overallRecordStatus"] = "Insufficient data";
  if (input.recordPnl > 0.01) overallRecordStatus = "Winning";
  else if (input.recordPnl < -0.01) overallRecordStatus = "Losing";
  else if (newClosed > 0 || input.carriedStats.closedCount > 0 || input.carriedStats.openCount > 0) {
    overallRecordStatus = "Breakeven";
  }

  let totalRecordVerdict: RecordVerdict;
  if (input.recordPnl < -0.01) {
    const newPart =
      newNet > 0.01
        ? `New trades are profitable (+${newNet.toFixed(4)} SIM)`
        : newNet < -0.01
          ? `New trades are also losing (${newNet.toFixed(4)} SIM)`
          : "New trades are flat";
    const carriedPart =
      input.carriedPnlSinceCarry < -0.01
        ? `carried trades caused ${input.carriedPnlSinceCarry.toFixed(4)} SIM`
        : input.carriedStats.closedCount + input.carriedStats.openCount > 0
          ? `carried trade impact is ${input.carriedPnlSinceCarry.toFixed(4)} SIM`
          : "no carried trade impact";
    totalRecordVerdict = {
      code: "LOSING_OVERALL",
      message: `Record is losing overall (${input.recordPnl.toFixed(4)} SIM). ${newPart}, but ${carriedPart}. Do not treat the record as profitable.`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (input.recordPnl > 0.01) {
    totalRecordVerdict = {
      code: "WINNING_OVERALL",
      message: `Record is winning overall (+${input.recordPnl.toFixed(4)} SIM, simulated only).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (newClosed === 0 && input.carriedStats.openCount === 0 && input.carriedStats.closedCount === 0) {
    totalRecordVerdict = {
      code: "INSUFFICIENT_DATA",
      message: "Fresh record — not enough closed trades yet for a total record verdict.",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else {
    totalRecordVerdict = {
      code: "BREAKEVEN_OVERALL",
      message: `Record is roughly breakeven (${input.recordPnl.toFixed(4)} SIM). More closed trades needed.`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  let newTradesVerdict: RecordVerdict;
  if (newClosed === 0) {
    newTradesVerdict = {
      code: "NO_NEW_TRADES_YET",
      message: "No closed new trades in this record yet.",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (newNet > 0.01 && newClosed < 5) {
    newTradesVerdict = {
      code: "NEW_TRADES_PROFITABLE_BUT_SMALL_SAMPLE",
      message: `New trades are profitable (+${newNet.toFixed(4)} SIM) from ${newClosed} closed trade(s) — small sample.`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (newNet > 0.01) {
    newTradesVerdict = {
      code: "NEW_TRADES_PROFITABLE_BUT_SMALL_SAMPLE",
      message: `New trades are profitable (+${newNet.toFixed(4)} SIM) from ${newClosed} closed trade(s).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (newNet < -0.01) {
    newTradesVerdict = {
      code: "NEW_TRADES_LOSING",
      message: `New trades are losing (${newNet.toFixed(4)} SIM) from ${newClosed} closed trade(s).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else {
    newTradesVerdict = {
      code: "NEW_TRADES_BREAKEVEN",
      message: `New trades are breakeven (${newNet.toFixed(4)} SIM) from ${newClosed} closed trade(s).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  let carriedTradesVerdict: RecordVerdict;
  if (input.carriedStats.openCount === 0 && input.carriedStats.closedCount === 0) {
    carriedTradesVerdict = {
      code: "NO_CARRIED_TRADES",
      message: "No carried trades in this record.",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (input.carriedPnlSinceCarry <= -50) {
    carriedTradesVerdict = {
      code: "CARRIED_TRADES_CAUSED_MAJOR_LOSS",
      message: `Carried trades caused major loss (${input.carriedPnlSinceCarry.toFixed(4)} SIM since carry). ${input.carriedStats.closedCount} closed, ${input.carriedStats.openCount} still open.`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else if (input.carriedStats.openCount > 0 && input.carriedStats.closedCount === 0) {
    carriedTradesVerdict = {
      code: "CARRIED_TRADES_STILL_OPEN",
      message: `${input.carriedStats.openCount} carried trade(s) still open — P&L since carry: ${input.carriedPnlSinceCarry.toFixed(4)} SIM.`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  } else {
    carriedTradesVerdict = {
      code: "CARRIED_TRADES_MINOR_IMPACT",
      message: `Carried trade P&L since carry: ${input.carriedPnlSinceCarry.toFixed(4)} SIM (${input.carriedStats.closedCount} closed, ${input.carriedStats.openCount} open).`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  const simpleVerdict =
    input.recordPnl < -0.01 && newNet > 0.01
      ? totalRecordVerdict.message
      : input.recordPnl > 0.01
        ? `Record is profitable overall (+${input.recordPnl.toFixed(4)} SIM, simulated only). ${newTradesVerdict.message}`
        : totalRecordVerdict.message;

  return {
    totalRecordVerdict,
    newTradesVerdict,
    carriedTradesVerdict,
    simpleVerdict,
    overallRecordStatus,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildCleanFreshStartStatus(activeOpenTrades: DbPaperTrade[]): CleanFreshStartStatus {
  const blocking = activeOpenTrades.filter(
    (t) => t.status === "OPEN" && t.side !== "NO_TRADE" && t.status !== "NO_TRADE",
  );
  const symbols = [...new Set(blocking.map((t) => t.symbol))];
  const available = blocking.length === 0;
  return {
    available,
    blockingOpenTradeCount: blocking.length,
    blockingSymbols: symbols,
    message: available
      ? "Clean Fresh Start available — no open trades in the active record."
      : `Clean Fresh Start blocked — ${blocking.length} open trade(s) in active record: ${symbols.join(", ") || "unknown"}. Archived record open trades do not block.`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
