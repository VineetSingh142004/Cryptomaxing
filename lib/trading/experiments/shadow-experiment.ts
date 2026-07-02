import { randomUUID } from "crypto";
import { createShadowTrade, closeShadowTrade } from "@/lib/trading/shadow";
import type { ShadowTradeRecord } from "@/lib/trading/shadow/types";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";

export interface ShadowExperimentInput {
  signalTimestamp: string;
  proposedStrategyId: string;
  approvedStrategyId: string;
  symbol: string;
  venue: string;
  direction: "long" | "short";
  entryPrice: number;
  stopPrice: number;
  targetPrices: number[];
  exitPrice?: number;
  exitReason?: string;
  holdHours?: number;
  spreadBps: number;
  entryWouldFill: boolean;
  approvedBaselineNet?: number;
}

export interface ShadowExperimentResult {
  id: string;
  proposedStrategyId: string;
  approvedStrategyId: string;
  proposedShadow: ShadowTradeRecord;
  approvedComparisonNet: number | null;
  proposedBetter: boolean | null;
  missedTrades: number;
  fakeoutsAvoided: number;
  slippageEstimate: number;
  timingDeltaMs: number | null;
  canApprove: false;
  canIncreaseRisk: false;
  affectsLiveAuto: false;
  reasonCodes: string[];
  completedAt: string;
}

export function runShadowExperiment(input: ShadowExperimentInput): ShadowExperimentResult {
  const reasonCodes: string[] = ["CANNOT_SELF_APPROVE", "CANNOT_INCREASE_RISK"];

  const proposedShadow = createShadowTrade({
    signalTimestamp: input.signalTimestamp,
    symbol: input.symbol,
    venue: input.venue,
    strategyId: input.proposedStrategyId,
    marketRegime: "experiment",
    direction: input.direction,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    targetPrices: input.targetPrices,
    exitPlan: ["experiment"],
    size: 1,
    feeModel: DEFAULT_FEE_MODEL,
    spreadBps: input.spreadBps,
    entryReason: ["shadow_experiment"],
    stopReason: "experiment_stop",
    entryWouldFill: input.entryWouldFill,
  });

  let closed = proposedShadow;
  if (input.exitPrice !== undefined && proposedShadow.status === "OPEN") {
    closed = closeShadowTrade({
      shadow: proposedShadow,
      exitPrice: input.exitPrice,
      exitReason: input.exitReason ?? "experiment_exit",
      exitTimestamp: new Date().toISOString(),
      stopWouldFill: false,
      targetWouldFill: true,
      holdHours: input.holdHours ?? 0.25,
      randomEntryNetPnl: input.approvedBaselineNet,
    });
  }

  const proposedBetter =
    closed.netPnlEstimate !== null && input.approvedBaselineNet !== undefined
      ? closed.netPnlEstimate > input.approvedBaselineNet
      : null;

  if (proposedShadow.status === "REJECTED") reasonCodes.push("RETROACTIVE_OR_INVALID_SIGNAL");
  if (proposedShadow.status === "NO_FILL") reasonCodes.push("MISSED_FILL");

  return {
    id: randomUUID(),
    proposedStrategyId: input.proposedStrategyId,
    approvedStrategyId: input.approvedStrategyId,
    proposedShadow: closed,
    approvedComparisonNet: input.approvedBaselineNet ?? null,
    proposedBetter,
    missedTrades: proposedShadow.status === "NO_FILL" ? 1 : 0,
    fakeoutsAvoided: 0,
    slippageEstimate: closed.expectedSlippage,
    timingDeltaMs: null,
    canApprove: false,
    canIncreaseRisk: false,
    affectsLiveAuto: false,
    reasonCodes,
    completedAt: new Date().toISOString(),
  };
}

export const EXPERIMENTS_ENGINE_STATUS = "ACTIVE" as const;
