import type { FeeSlippageModel } from "@/lib/trading/research/types";
import { MAX_REALTIME_SIGNAL_AGE_MS } from "@/lib/trading/shadow/types";

export type PaperTradeStatus = "OPEN" | "CLOSED" | "REJECTED" | "MISSED_FILL" | "PARTIAL_FILL";

export interface PaperTradeRecord {
  id: string;
  signalTimestamp: string;
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  entryPrice: number;
  fillPrice: number | null;
  exitPrice: number | null;
  size: number;
  filledSize: number;
  leverage: number;
  status: PaperTradeStatus;
  grossPnl: number | null;
  netPnl: number | null;
  feesPaid: number;
  slippagePaid: number;
  fundingPaid: number;
  spreadCost: number;
  missedFill: boolean;
  partialFill: boolean;
  rejected: boolean;
  reasonCodes: string[];
  openedAt: string;
  closedAt: string | null;
  feeModel: FeeSlippageModel;
}

export interface PaperDailySummary {
  reportDate: string;
  startingBalance: number;
  endingBalance: number;
  grossPnl: number;
  netPnl: number;
  feesPaid: number;
  slippagePaid: number;
  fundingPaid: number;
  spreadCost: number;
  tradeCount: number;
  wins: number;
  losses: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  largestLoss: number;
  averageWin: number | null;
  averageLoss: number | null;
  missedFills: number;
  rejectedTrades: number;
  noTradeDecisions: number;
  moneyProtected: number;
  generatedAt: string;
}

export { MAX_REALTIME_SIGNAL_AGE_MS };
