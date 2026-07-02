import type { StrategyDefinition } from "@/lib/trading/strategies/definitions";

export interface ParameterRange {
  key: string;
  values: number[];
}

export function buildParameterGrid(strategy: StrategyDefinition): ParameterRange[] {
  const base = strategy.parameters;
  const ranges: ParameterRange[] = [
    { key: "minRelativeVolume", values: vary(base.minRelativeVolume as number, [0.85, 1, 1.15]) },
    { key: "secondTargetR", values: vary(base.secondTargetR as number, [0.8, 1, 1.25]) },
    { key: "partialR", values: vary(base.partialR as number, [0.8, 1, 1.2]) },
  ];
  if (typeof base.maxSpreadBps === "number") {
    ranges.push({ key: "maxSpreadBps", values: vary(base.maxSpreadBps, [0.8, 1, 1.2]) });
  }
  if (typeof base.maxVwapExtensionPct === "number") {
    ranges.push({ key: "maxVwapExtensionPct", values: vary(base.maxVwapExtensionPct, [0.8, 1, 1.2]) });
  }
  return ranges.filter((r) => r.values.length > 0);
}

function vary(base: number, multipliers: number[]): number[] {
  if (typeof base !== "number" || !Number.isFinite(base)) return [];
  const vals = multipliers.map((m) => Math.round(base * m * 100) / 100);
  return [...new Set(vals)];
}

export function cartesianProduct(ranges: ParameterRange[]): Record<string, number>[] {
  if (ranges.length === 0) return [{}];
  const [first, ...rest] = ranges;
  const restProduct = cartesianProduct(rest);
  const out: Record<string, number>[] = [];
  for (const v of first.values) {
    for (const combo of restProduct) {
      out.push({ ...combo, [first.key]: v });
    }
  }
  return out;
}

export const OPTIMIZATION_REJECTION_RULES = {
  maxLuckyTradeDominance: 0.5,
  minValidationExpectancy: 0,
  minOosExpectancy: 0,
  maxDrawdownPct: 25,
  minTradeCount: 10,
  maxParameterSensitivityPct: 30,
} as const;

export function shouldRejectVariant(input: {
  inSample: { expectancy: number | null; luckyTradeDominance: number | null; maxDrawdownPct: number; tradeCount: number };
  validation: { expectancy: number | null; tradeCount: number };
  outOfSample: { expectancy: number | null; tradeCount: number };
  walkForwardPass: boolean;
  chopCollapse: boolean;
}): string[] {
  const reasons: string[] = [];
  const rules = OPTIMIZATION_REJECTION_RULES;

  if (input.inSample.tradeCount < rules.minTradeCount) reasons.push("INSUFFICIENT_TRADES_IN_SAMPLE");
  if ((input.inSample.luckyTradeDominance ?? 0) > rules.maxLuckyTradeDominance) {
    reasons.push("LUCKY_TRADE_DOMINANCE");
  }
  if ((input.validation.expectancy ?? -Infinity) < rules.minValidationExpectancy) {
    reasons.push("VALIDATION_FAILED");
  }
  if ((input.outOfSample.expectancy ?? -Infinity) < rules.minOosExpectancy) {
    reasons.push("OUT_OF_SAMPLE_FAILED");
  }
  if (!input.walkForwardPass) reasons.push("WALK_FORWARD_FAILED");
  if (input.inSample.maxDrawdownPct > rules.maxDrawdownPct) reasons.push("DRAWDOWN_UNACCEPTABLE");
  if (input.chopCollapse) reasons.push("CHOP_COLLAPSE");

  return reasons;
}
