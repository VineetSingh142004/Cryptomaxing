import { randomUUID } from "crypto";
import {
  applyEntryCosts,
  applyExitCosts,
  computeFundingCost,
  grossPnl,
  shouldMissFill,
} from "@/lib/trading/research/cost-model";
import type { FeeSlippageModel } from "@/lib/trading/research/types";
import type { PaperDailySummary, PaperTradeRecord } from "@/lib/trading/paper/types";
import { validateRealtimeSignal } from "@/lib/trading/shadow/engine";

export interface OpenPaperTradeInput {
  signalTimestamp: string;
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  entryPrice: number;
  size: number;
  leverage?: number;
  feeModel: FeeSlippageModel;
  spreadBps: number;
  minOrderSize?: number;
  latencyMs?: number;
  rng?: () => number;
  reportDate: string;
}

export interface ClosePaperTradeInput {
  trade: PaperTradeRecord;
  exitPrice: number;
  isStop?: boolean;
  holdHours?: number;
  emergency?: boolean;
  rng?: () => number;
}

function sameDay(signalIso: string, reportDate: string): boolean {
  return signalIso.slice(0, 10) === reportDate.slice(0, 10);
}

export function openPaperTrade(input: OpenPaperTradeInput): PaperTradeRecord {
  const now = new Date().toISOString();
  const errors = validateRealtimeSignal(input.signalTimestamp);
  const reasonCodes = [...errors];

  if (!sameDay(input.signalTimestamp, input.reportDate)) {
    reasonCodes.push("NOT_SAME_DAY_SIGNAL");
  }

  const minSize = input.minOrderSize ?? 0;
  if (input.size < minSize) reasonCodes.push("BELOW_MIN_ORDER_SIZE");

  if (reasonCodes.length > 0) {
    return rejectedPaper(input, now, reasonCodes);
  }

  const rng = input.rng ?? Math.random;
  if (shouldMissFill(input.feeModel, rng)) {
    return {
      ...basePaper(input, now),
      status: "MISSED_FILL",
      missedFill: true,
      reasonCodes: ["MISSED_FILL"],
    };
  }

  let filledSize = input.size;
  let partialFill = false;
  const partialRate = input.feeModel.partialFillRate ?? 0;
  if (rng() < partialRate) {
    filledSize = input.size * 0.5;
    partialFill = true;
  }

  const entry = applyEntryCosts(input.entryPrice, input.direction, filledSize, input.feeModel);
  const spreadCost = (input.spreadBps / 10_000) * entry.fillPrice * filledSize;

  return {
    ...basePaper(input, now),
    fillPrice: entry.fillPrice,
    filledSize,
    feesPaid: entry.fee,
    slippagePaid: entry.slippage,
    spreadCost,
    partialFill,
    status: partialFill ? "PARTIAL_FILL" : "OPEN",
    reasonCodes: partialFill ? ["PARTIAL_FILL"] : [],
  };
}

function basePaper(input: OpenPaperTradeInput, now: string): PaperTradeRecord {
  return {
    id: randomUUID(),
    signalTimestamp: input.signalTimestamp,
    symbol: input.symbol,
    strategyId: input.strategyId,
    direction: input.direction,
    entryPrice: input.entryPrice,
    fillPrice: null,
    exitPrice: null,
    size: input.size,
    filledSize: 0,
    leverage: input.leverage ?? 1,
    status: "OPEN",
    grossPnl: null,
    netPnl: null,
    feesPaid: 0,
    slippagePaid: 0,
    fundingPaid: 0,
    spreadCost: 0,
    missedFill: false,
    partialFill: false,
    rejected: false,
    reasonCodes: [],
    openedAt: now,
    closedAt: null,
    feeModel: input.feeModel,
  };
}

function rejectedPaper(input: OpenPaperTradeInput, now: string, reasonCodes: string[]): PaperTradeRecord {
  return {
    ...basePaper(input, now),
    status: "REJECTED",
    rejected: true,
    reasonCodes,
  };
}

export function closePaperTrade(input: ClosePaperTradeInput): PaperTradeRecord {
  const { trade } = input;
  if (trade.status !== "OPEN" && trade.status !== "PARTIAL_FILL") return trade;
  if (trade.fillPrice === null) return trade;

  const model = trade.feeModel;
  const slipMult = input.emergency ? 2.5 : 1;
  const exitModel = input.emergency
    ? { ...model, slippageBps: model.slippageBps * slipMult, stopSlippageBps: (model.stopSlippageBps ?? 12) * slipMult }
    : model;

  const exit = applyExitCosts(
    input.exitPrice,
    trade.direction,
    trade.filledSize,
    exitModel,
    input.isStop ?? false,
  );

  const holdHours = input.holdHours ?? 0.25;
  const notional = trade.fillPrice * trade.filledSize;
  const funding = computeFundingCost(notional, holdHours, model);
  const gross = grossPnl(trade.direction, trade.fillPrice, exit.fillPrice, trade.filledSize);
  const net = gross - trade.feesPaid - exit.fee - trade.slippagePaid - exit.slippage - funding - trade.spreadCost;

  return {
    ...trade,
    exitPrice: exit.fillPrice,
    grossPnl: gross,
    netPnl: net,
    feesPaid: trade.feesPaid + exit.fee,
    slippagePaid: trade.slippagePaid + exit.slippage,
    fundingPaid: funding,
    status: "CLOSED",
    closedAt: new Date().toISOString(),
  };
}

export function summarizePaperDay(input: {
  reportDate: string;
  startingBalance: number;
  trades: PaperTradeRecord[];
  noTradeDecisions?: number;
  moneyProtected?: number;
}): PaperDailySummary {
  const closed = input.trades.filter((t) => t.status === "CLOSED" && t.netPnl !== null);
  const wins = closed.filter((t) => (t.netPnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.netPnl ?? 0) <= 0);

  const grossPnl = closed.reduce((s, t) => s + (t.grossPnl ?? 0), 0);
  const netPnl = closed.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const feesPaid = closed.reduce((s, t) => s + t.feesPaid, 0);
  const slippagePaid = closed.reduce((s, t) => s + t.slippagePaid, 0);
  const fundingPaid = closed.reduce((s, t) => s + t.fundingPaid, 0);
  const spreadCost = closed.reduce((s, t) => s + t.spreadCost, 0);

  let peak = input.startingBalance;
  let equity = input.startingBalance;
  let maxDrawdown = 0;
  for (const t of closed.sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""))) {
    equity += t.netPnl ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const grossProfit = wins.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0));

  return {
    reportDate: input.reportDate,
    startingBalance: input.startingBalance,
    endingBalance: input.startingBalance + netPnl,
    grossPnl,
    netPnl,
    feesPaid,
    slippagePaid,
    fundingPaid,
    spreadCost,
    tradeCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    expectancy: closed.length > 0 ? netPnl / closed.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdown,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.netPnl ?? 0)) : 0,
    averageWin: wins.length > 0 ? grossProfit / wins.length : null,
    averageLoss: losses.length > 0 ? grossLoss / losses.length : null,
    missedFills: input.trades.filter((t) => t.missedFill).length,
    rejectedTrades: input.trades.filter((t) => t.rejected).length,
    noTradeDecisions: input.noTradeDecisions ?? 0,
    moneyProtected: input.moneyProtected ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

export const PAPER_FORWARD_STATUS = "ACTIVE" as const;
