import { randomUUID } from "crypto";
import type { BlockedTradeRecord, MoneyProtectedSummary } from "@/lib/trading/proof/types";

const BLOCK_CATEGORY_MAP: Record<string, string> = {
  RISK_ENGINE: "blockedByRisk",
  DATA_QUALITY: "blockedByDataQuality",
  SPREAD_WIDE: "blockedBySpread",
  LIQUIDITY_LOW: "blockedByLiquidity",
  FAKEOUT_HIGH: "blockedByFakeout",
  LATE_ENTRY: "blockedByLateEntry",
  STRATEGY_DECAY: "blockedByStrategyDecay",
  BAD_SESSION: "blockedByBadSession",
  MICROSTRUCTURE_BLOCK: "blockedByMicrostructure",
};

export interface RecordBlockInput {
  symbol: string;
  strategyId: string;
  blockReason: string;
  blockCategory: keyof typeof BLOCK_CATEGORY_MAP | string;
  signalTimestamp: string;
  estimatedLossAvoided?: number;
}

export function recordBlockedTrade(input: RecordBlockInput): BlockedTradeRecord {
  return {
    id: randomUUID(),
    symbol: input.symbol,
    strategyId: input.strategyId,
    blockReason: input.blockReason,
    blockCategory: input.blockCategory,
    estimatedLossAvoided: input.estimatedLossAvoided ?? null,
    signalTimestamp: input.signalTimestamp,
    laterOutcome: null,
    outcomeCheckedAt: null,
  };
}

export function updateBlockOutcome(
  record: BlockedTradeRecord,
  outcome: "LOST" | "WON" | "UNKNOWN",
): BlockedTradeRecord {
  return {
    ...record,
    laterOutcome: outcome,
    outcomeCheckedAt: new Date().toISOString(),
  };
}

export function summarizeMoneyProtected(input: {
  reportDate: string;
  records: BlockedTradeRecord[];
}): MoneyProtectedSummary {
  const counts: Record<string, number> = {
    blockedByRisk: 0,
    blockedByDataQuality: 0,
    blockedBySpread: 0,
    blockedByLiquidity: 0,
    blockedByFakeout: 0,
    blockedByLateEntry: 0,
    blockedByStrategyDecay: 0,
    blockedByBadSession: 0,
    blockedByMicrostructure: 0,
  };

  for (const r of input.records) {
    const key = BLOCK_CATEGORY_MAP[r.blockCategory] ?? r.blockCategory;
    if (key in counts) counts[key]++;
  }

  const withOutcome = input.records.filter((r) => r.laterOutcome !== null);
  const correctBlocks = withOutcome.filter((r) => r.laterOutcome === "LOST").length;
  const falsePositiveBlocks = withOutcome.filter((r) => r.laterOutcome === "WON").length;
  const missedWinnersDueToBlock = falsePositiveBlocks;

  const estimatedLossAvoided = input.records
    .filter((r) => r.laterOutcome === "LOST" || r.laterOutcome === null)
    .reduce((s, r) => s + (r.estimatedLossAvoided ?? 0), 0);

  const precision =
    withOutcome.length > 0 ? correctBlocks / (correctBlocks + falsePositiveBlocks || 1) : null;
  const recall = withOutcome.length > 0 ? correctBlocks / input.records.length : null;

  return {
    reportDate: input.reportDate,
    blockedByRisk: counts.blockedByRisk,
    blockedByDataQuality: counts.blockedByDataQuality,
    blockedBySpread: counts.blockedBySpread,
    blockedByLiquidity: counts.blockedByLiquidity,
    blockedByFakeout: counts.blockedByFakeout,
    blockedByLateEntry: counts.blockedByLateEntry,
    blockedByStrategyDecay: counts.blockedByStrategyDecay,
    blockedByBadSession: counts.blockedByBadSession,
    blockedByMicrostructure: counts.blockedByMicrostructure,
    estimatedLossAvoided,
    correctBlocks,
    falsePositiveBlocks,
    missedWinnersDueToBlock,
    blockPrecision: precision,
    blockRecall: recall,
    records: input.records,
    generatedAt: new Date().toISOString(),
  };
}
