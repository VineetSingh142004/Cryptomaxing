import type { FeeSlippageModel } from "@/lib/trading/research/types";

/** Max age of signal timestamp when creating shadow/paper trades (real-time only) */
export const MAX_REALTIME_SIGNAL_AGE_MS = 120_000;

export type ShadowTradeStatus = "OPEN" | "CLOSED" | "REJECTED" | "NO_FILL";

export interface ShadowTradeRecord {
  id: string;
  signalTimestamp: string;
  createdAt: string;
  symbol: string;
  venue: string;
  strategyId: string;
  marketRegime: string;
  direction: "long" | "short";
  entryPrice: number;
  realisticEntryPrice: number;
  stopPrice: number;
  targetPrices: number[];
  exitPlan: string[];
  expectedFees: number;
  expectedSlippage: number;
  expectedSpreadCost: number;
  expectedFunding: number;
  orderBookState: Record<string, unknown> | null;
  liquidityState: Record<string, unknown> | null;
  entryReason: string[];
  stopReason: string;
  exitReason: string | null;
  exitPrice: number | null;
  grossPnl: number | null;
  netPnlEstimate: number | null;
  entryWouldFill: boolean;
  stopWouldFill: boolean;
  targetWouldFill: boolean;
  randomEntryNetPnl: number | null;
  randomEntryBetter: boolean | null;
  status: ShadowTradeStatus;
  reasonCodes: string[];
  feeModel: FeeSlippageModel;
}

export interface CreateShadowTradeInput {
  signalTimestamp: string;
  symbol: string;
  venue: string;
  strategyId: string;
  marketRegime: string;
  direction: "long" | "short";
  entryPrice: number;
  stopPrice: number;
  targetPrices: number[];
  exitPlan: string[];
  size: number;
  feeModel: FeeSlippageModel;
  spreadBps: number;
  orderBookState?: Record<string, unknown> | null;
  liquidityState?: Record<string, unknown> | null;
  entryReason: string[];
  stopReason: string;
  entryWouldFill: boolean;
  now?: string;
}

export interface CloseShadowTradeInput {
  shadow: ShadowTradeRecord;
  exitPrice: number;
  exitReason: string;
  exitTimestamp: string;
  stopWouldFill: boolean;
  targetWouldFill: boolean;
  holdHours: number;
  randomEntryNetPnl?: number;
}
