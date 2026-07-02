import { randomUUID } from "crypto";
import {
  applyEntryCosts,
  applyExitCosts,
  computeFundingCost,
  grossPnl,
} from "@/lib/trading/research/cost-model";
import type {
  CloseShadowTradeInput,
  CreateShadowTradeInput,
  ShadowTradeRecord,
} from "@/lib/trading/shadow/types";
import { MAX_REALTIME_SIGNAL_AGE_MS } from "@/lib/trading/shadow/types";

export function validateRealtimeSignal(signalTimestamp: string, nowMs = Date.now()): string[] {
  const errors: string[] = [];
  const signalMs = new Date(signalTimestamp).getTime();
  if (Number.isNaN(signalMs)) errors.push("INVALID_SIGNAL_TIMESTAMP");
  const age = nowMs - signalMs;
  if (age < 0) errors.push("FUTURE_SIGNAL_REJECTED");
  if (age > MAX_REALTIME_SIGNAL_AGE_MS) errors.push("RETROACTIVE_SHADOW_REJECTED");
  return errors;
}

export function createShadowTrade(input: CreateShadowTradeInput): ShadowTradeRecord {
  const now = input.now ?? new Date().toISOString();
  const errors = validateRealtimeSignal(input.signalTimestamp, new Date(now).getTime());
  if (errors.length > 0) {
    return {
      id: randomUUID(),
      signalTimestamp: input.signalTimestamp,
      createdAt: now,
      symbol: input.symbol,
      venue: input.venue,
      strategyId: input.strategyId,
      marketRegime: input.marketRegime,
      direction: input.direction,
      entryPrice: input.entryPrice,
      realisticEntryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      targetPrices: input.targetPrices,
      exitPlan: input.exitPlan,
      expectedFees: 0,
      expectedSlippage: 0,
      expectedSpreadCost: 0,
      expectedFunding: 0,
      orderBookState: input.orderBookState ?? null,
      liquidityState: input.liquidityState ?? null,
      entryReason: input.entryReason,
      stopReason: input.stopReason,
      exitReason: null,
      exitPrice: null,
      grossPnl: null,
      netPnlEstimate: null,
      entryWouldFill: false,
      stopWouldFill: false,
      targetWouldFill: false,
      randomEntryNetPnl: null,
      randomEntryBetter: null,
      status: "REJECTED",
      reasonCodes: errors,
      feeModel: input.feeModel,
    };
  }

  if (!input.entryWouldFill) {
    return buildOpenShadow(input, now, "NO_FILL", ["ENTRY_WOULD_NOT_FILL"]);
  }

  const entry = applyEntryCosts(input.entryPrice, input.direction, input.size, input.feeModel);
  const spreadCost = (input.spreadBps / 10_000) * entry.fillPrice * input.size;

  const record = buildOpenShadow(input, now, "OPEN", []);
  record.realisticEntryPrice = entry.fillPrice;
  record.expectedFees = entry.fee;
  record.expectedSlippage = entry.slippage;
  record.expectedSpreadCost = spreadCost;
  record.entryWouldFill = true;
  return record;
}

function buildOpenShadow(
  input: CreateShadowTradeInput,
  now: string,
  status: ShadowTradeRecord["status"],
  reasonCodes: string[],
): ShadowTradeRecord {
  return {
    id: randomUUID(),
    signalTimestamp: input.signalTimestamp,
    createdAt: now,
    symbol: input.symbol,
    venue: input.venue,
    strategyId: input.strategyId,
    marketRegime: input.marketRegime,
    direction: input.direction,
    entryPrice: input.entryPrice,
    realisticEntryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    targetPrices: input.targetPrices,
    exitPlan: input.exitPlan,
    expectedFees: 0,
    expectedSlippage: 0,
    expectedSpreadCost: 0,
    expectedFunding: 0,
    orderBookState: input.orderBookState ?? null,
    liquidityState: input.liquidityState ?? null,
    entryReason: input.entryReason,
    stopReason: input.stopReason,
    exitReason: null,
    exitPrice: null,
    grossPnl: null,
    netPnlEstimate: null,
    entryWouldFill: input.entryWouldFill,
    stopWouldFill: false,
    targetWouldFill: false,
    randomEntryNetPnl: null,
    randomEntryBetter: null,
    status,
    reasonCodes,
    feeModel: input.feeModel,
  };
}

export function closeShadowTrade(input: CloseShadowTradeInput): ShadowTradeRecord {
  const { shadow } = input;
  if (shadow.status !== "OPEN") return shadow;

  const closeMs = new Date(input.exitTimestamp).getTime();
  const signalMs = new Date(shadow.signalTimestamp).getTime();
  if (closeMs < signalMs) {
    return { ...shadow, status: "REJECTED", reasonCodes: [...shadow.reasonCodes, "EXIT_BEFORE_SIGNAL"] };
  }

  const size = 1;
  const exit = applyExitCosts(
    input.exitPrice,
    shadow.direction,
    size,
    shadow.feeModel,
    input.stopWouldFill,
  );
  const notional = shadow.realisticEntryPrice * size;
  const funding = computeFundingCost(notional, input.holdHours, shadow.feeModel);
  const gross = grossPnl(shadow.direction, shadow.realisticEntryPrice, exit.fillPrice, size);
  const net =
    gross - shadow.expectedFees - exit.fee - shadow.expectedSlippage - exit.slippage - funding - shadow.expectedSpreadCost;

  let randomEntryBetter: boolean | null = null;
  if (input.randomEntryNetPnl !== undefined) {
    randomEntryBetter = input.randomEntryNetPnl > net;
  }

  return {
    ...shadow,
    exitReason: input.exitReason,
    exitPrice: exit.fillPrice,
    grossPnl: gross,
    netPnlEstimate: net,
    expectedFunding: funding,
    expectedFees: shadow.expectedFees + exit.fee,
    expectedSlippage: shadow.expectedSlippage + exit.slippage,
    stopWouldFill: input.stopWouldFill,
    targetWouldFill: input.targetWouldFill,
    randomEntryNetPnl: input.randomEntryNetPnl ?? null,
    randomEntryBetter,
    status: "CLOSED",
  };
}

export const SHADOW_ENGINE_STATUS = "ACTIVE" as const;
