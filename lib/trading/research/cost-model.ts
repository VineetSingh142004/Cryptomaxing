import type { FeeSlippageModel, BacktestTrade } from "@/lib/trading/research/types";

export function applyEntryCosts(
  price: number,
  direction: "long" | "short",
  size: number,
  model: FeeSlippageModel,
): { fillPrice: number; fee: number; slippage: number } {
  const slipPct = model.slippageBps / 10_000;
  const fillPrice =
    direction === "long" ? price * (1 + slipPct) : price * (1 - slipPct);
  const notional = fillPrice * size;
  const fee = notional * (model.takerBps / 10_000);
  const slippage = Math.abs(fillPrice - price) * size;
  return { fillPrice, fee, slippage };
}

export function applyExitCosts(
  price: number,
  direction: "long" | "short",
  size: number,
  model: FeeSlippageModel,
  isStop = false,
): { fillPrice: number; fee: number; slippage: number } {
  const slipBps = isStop ? (model.stopSlippageBps ?? model.slippageBps * 1.5) : model.slippageBps;
  const slipPct = slipBps / 10_000;
  const fillPrice =
    direction === "long" ? price * (1 - slipPct) : price * (1 + slipPct);
  const notional = fillPrice * size;
  const fee = notional * (model.takerBps / 10_000);
  const slippage = Math.abs(fillPrice - price) * size;
  return { fillPrice, fee, slippage };
}

export function computeFundingCost(
  notional: number,
  holdHours: number,
  model: FeeSlippageModel,
): number {
  const rate = model.fundingBpsPer8h ?? 0;
  return notional * (rate / 10_000) * (holdHours / 8);
}

export function shouldMissFill(model: FeeSlippageModel, rng: () => number): boolean {
  const rate = model.missedFillRate ?? 0;
  return rng() < rate;
}

export function grossPnl(
  direction: "long" | "short",
  entryPrice: number,
  exitPrice: number,
  size: number,
): number {
  return direction === "long"
    ? (exitPrice - entryPrice) * size
    : (entryPrice - exitPrice) * size;
}

export function netPnlFromTrade(trade: Pick<BacktestTrade, "grossPnl" | "fees" | "slippage" | "funding">): number {
  return trade.grossPnl - trade.fees - trade.slippage - trade.funding;
}

export const DEFAULT_FEE_MODEL: FeeSlippageModel = {
  makerBps: 16,
  takerBps: 26,
  slippageBps: 5,
  stopSlippageBps: 12,
  fundingBpsPer8h: 1,
  missedFillRate: 0.05,
  partialFillRate: 0.1,
  source: "kraken_conservative",
};

export const STRESS_FEE_MODEL: FeeSlippageModel = {
  ...DEFAULT_FEE_MODEL,
  slippageBps: 15,
  stopSlippageBps: 30,
  takerBps: 35,
  missedFillRate: 0.15,
  source: "stress_conservative",
};
