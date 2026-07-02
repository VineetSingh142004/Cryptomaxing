import type { ComputedFeatures } from "@/lib/trading/features/compute";
import type { TrueInvalidationStopResult } from "@/lib/trading/stops/true-invalidation";

export interface ProfitPlanInput {
  entryPrice: number;
  direction: "long" | "short";
  stop: TrueInvalidationStopResult;
  features: ComputedFeatures;
  partialR?: number;
  secondTargetR?: number;
  accountEquity: number;
  positionRiskPct: number;
}

export interface ProfitPlan {
  partialTpPrice: number;
  partialTpR: number;
  secondTpPrice: number;
  secondTpR: number;
  trailingStopTriggerR: number | null;
  breakevenTriggerR: number;
  maxTimeInTradeMinutes: number;
  invalidationConditions: string[];
  earlyExitConditions: string[];
  expectedProfitPerMinute: number | null;
  expectedProfitPerHour: number | null;
  expectedProfitPerUnitRisk: number | null;
  expectedProfitPerUnitMargin: number | null;
  capitalLockupMinutes: number;
  opportunityCostScore: number;
  profitDensityScore: number;
  decision: "EFFICIENT" | "MARGINAL" | "REJECT";
  reasonCodes: string[];
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function buildProfitPlan(input: ProfitPlanInput): ProfitPlan {
  const {
    entryPrice,
    direction,
    stop,
    features,
    partialR = 1.0,
    secondTargetR = 2.0,
    accountEquity,
    positionRiskPct,
  } = input;

  const riskDist = stop.stopDistancePct / 100;
  const sign = direction === "long" ? 1 : -1;

  const priceAtR = (r: number) => entryPrice * (1 + sign * riskDist * r);

  const partialTpPrice = priceAtR(partialR);
  const secondTpPrice = priceAtR(secondTargetR);
  const breakevenTriggerR = partialR * 0.8;

  const strongMomentum =
    features.volume.relativeVolume !== null &&
    features.volume.relativeVolume > 1.2 &&
    features.price.candleBodyStrength > 0.5;

  const trailingStopTriggerR = strongMomentum ? partialR * 1.2 : null;

  const timeEst = features.price.return5m !== 0 ? 60 : 45;
  const maxTimeInTradeMinutes = clamp(timeEst * 3, 15, 240);

  const invalidationConditions = [
    "Stop hit at true invalidation",
    "VWAP lost against direction",
    "Volume fade below 0.8 relative",
    "Order book weakens against trade",
    "BTC/ETH turns against trade",
    "Spread widens beyond threshold",
    "Liquidity drops below minimum",
  ];

  const earlyExitConditions = [
    "Volume fades after entry",
    "Book weakens post-entry",
    "Benchmark assets turn",
    "Spread expands sharply",
    "Exit liquidity drops",
  ];

  const notional = accountEquity * (positionRiskPct / 100) / Math.max(riskDist, 0.001);
  const expectedNetAtPartial = notional * riskDist * partialR * 0.5;
  const expectedProfitPerMinute =
    maxTimeInTradeMinutes > 0 ? expectedNetAtPartial / maxTimeInTradeMinutes : null;
  const expectedProfitPerHour =
    expectedProfitPerMinute !== null ? expectedProfitPerMinute * 60 : null;
  const expectedProfitPerUnitRisk = partialR * 0.5 + secondTargetR * 0.5;
  const marginUsed = notional / 3;
  const expectedProfitPerUnitMargin =
    marginUsed > 0 && expectedNetAtPartial > 0 ? expectedNetAtPartial / marginUsed : null;

  const profitDensityScore = clamp(
    (expectedProfitPerHour ?? 0) / (accountEquity / 10_000) * 10 +
      expectedProfitPerUnitRisk * 15 -
      maxTimeInTradeMinutes * 0.1,
  );

  const opportunityCostScore = clamp(profitDensityScore - maxTimeInTradeMinutes * 0.05);

  const reasonCodes: string[] = [];
  if (profitDensityScore < 40) reasonCodes.push("SLOW_MEDIOCRE_TRADE");
  if (features.volume.volumeFade) reasonCodes.push("VOLUME_FADING");
  if (maxTimeInTradeMinutes > 120) reasonCodes.push("LONG_CAPITAL_LOCKUP");

  let decision: ProfitPlan["decision"] = "MARGINAL";
  if (profitDensityScore >= 60 && reasonCodes.length === 0) decision = "EFFICIENT";
  if (profitDensityScore < 30 || reasonCodes.includes("SLOW_MEDIOCRE_TRADE")) decision = "REJECT";

  return {
    partialTpPrice,
    partialTpR: partialR,
    secondTpPrice,
    secondTpR: secondTargetR,
    trailingStopTriggerR,
    breakevenTriggerR,
    maxTimeInTradeMinutes,
    invalidationConditions,
    earlyExitConditions,
    expectedProfitPerMinute,
    expectedProfitPerHour,
    expectedProfitPerUnitRisk,
    expectedProfitPerUnitMargin,
    capitalLockupMinutes: maxTimeInTradeMinutes,
    opportunityCostScore,
    profitDensityScore,
    decision,
    reasonCodes,
  };
}

export interface OpportunityCandidate {
  id: string;
  symbol: string;
  strategyId: string;
  profitMaximizationScore: number;
  expectedNetProfit: number;
  profitDensity: number;
  timeToTargetMinutes: number;
  rewardToRisk: number;
  correlationGroup: string;
  capitalLockupMinutes: number;
}

export interface AllocationResult {
  ranked: OpportunityCandidate[];
  selectedId: string | null;
  watchIds: string[];
  blockedIds: string[];
  reasonCodes: string[];
  allocatedAt: string;
}

export function allocateCapital(candidates: OpportunityCandidate[]): AllocationResult {
  const blockedIds: string[] = [];
  const reasonCodes: string[] = [];

  const viable = candidates.filter((c) => {
    if (c.profitMaximizationScore < 45) {
      blockedIds.push(c.id);
      return false;
    }
    if (c.rewardToRisk < 2) {
      blockedIds.push(c.id);
      reasonCodes.push(`${c.id}:LOW_RR`);
      return false;
    }
    return true;
  });

  const sorted = [...viable].sort((a, b) => b.profitMaximizationScore - a.profitMaximizationScore);

  const groups = new Map<string, OpportunityCandidate>();
  for (const c of sorted) {
    if (!groups.has(c.correlationGroup)) groups.set(c.correlationGroup, c);
  }

  const deduped = [...groups.values()].sort((a, b) => b.profitMaximizationScore - a.profitMaximizationScore);
  const selected = deduped[0] ?? null;
  const watch = deduped.slice(1, 4).map((c) => c.id);

  if (selected && selected.profitMaximizationScore < 55) {
    reasonCodes.push("NO_A_PLUS_SETUP");
  }

  return {
    ranked: sorted,
    selectedId: selected?.id ?? null,
    watchIds: watch,
    blockedIds,
    reasonCodes,
    allocatedAt: new Date().toISOString(),
  };
}
