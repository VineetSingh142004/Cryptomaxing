import type { NormalizedCandle } from "@/lib/trading/data/types";
import { runBacktest } from "@/lib/trading/research/backtest-engine";
import { DEFAULT_FEE_MODEL, STRESS_FEE_MODEL } from "@/lib/trading/research/cost-model";
import {
  buildParameterGrid,
  cartesianProduct,
  shouldRejectVariant,
} from "@/lib/trading/research/parameter-grid";
import { splitPeriods } from "@/lib/trading/research/types";
import type { FeeSlippageModel, OptimizationVariantResult } from "@/lib/trading/research/types";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

export function runWalkForward(
  candles: NormalizedCandle[],
  strategyId: string,
  parameters: Record<string, number>,
  feeModel: FeeSlippageModel,
  folds = 3,
): boolean {
  const foldSize = Math.floor(candles.length / folds);
  if (foldSize < 50) return false;

  let passCount = 0;
  for (let f = 0; f < folds - 1; f++) {
    const train = candles.slice(0, (f + 1) * foldSize);
    const test = candles.slice((f + 1) * foldSize, (f + 2) * foldSize);
    if (test.length < 30) continue;

    const trainResult = runBacktest({
      strategyId,
      symbol: "walkforward",
      candles: train,
      period: "in_sample",
      parameters,
      feeModel,
      dataSource: "walk_forward",
    });
    const testResult = runBacktest({
      strategyId,
      symbol: "walkforward",
      candles: test,
      period: "out_of_sample",
      parameters,
      feeModel,
      dataSource: "walk_forward",
    });

    if (
      (trainResult.metrics.expectancy ?? -1) > 0 &&
      (testResult.metrics.expectancy ?? -1) >= 0 &&
      testResult.metrics.tradeCount >= 3
    ) {
      passCount++;
    }
  }

  return passCount >= Math.max(1, folds - 2);
}

export function runParameterOptimization(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  feeModel?: FeeSlippageModel;
  maxVariants?: number;
}): {
  variants: OptimizationVariantResult[];
  bestVariant: OptimizationVariantResult | null;
  status: string;
  reasonCodes: string[];
} {
  const strategy = getStrategyById(input.strategyId);
  if (!strategy) {
    return { variants: [], bestVariant: null, status: "FAILED", reasonCodes: ["STRATEGY_NOT_FOUND"] };
  }

  const feeModel = input.feeModel ?? DEFAULT_FEE_MODEL;
  const splits = splitPeriods(input.candles);
  const grid = cartesianProduct(buildParameterGrid(strategy));
  const maxVariants = input.maxVariants ?? 27;
  const variants: OptimizationVariantResult[] = [];

  for (const parameters of grid.slice(0, maxVariants)) {
    const inSample = runBacktest({
      strategyId: input.strategyId,
      symbol: input.symbol,
      candles: splits.inSample,
      period: "in_sample",
      parameters,
      feeModel,
      dataSource: "optimization",
    });
    const validation = runBacktest({
      strategyId: input.strategyId,
      symbol: input.symbol,
      candles: splits.validation,
      period: "validation",
      parameters,
      feeModel,
      dataSource: "optimization",
    });
    const outOfSample = runBacktest({
      strategyId: input.strategyId,
      symbol: input.symbol,
      candles: splits.outOfSample,
      period: "out_of_sample",
      parameters,
      feeModel,
      dataSource: "optimization",
    });

    const stressResult = runBacktest({
      strategyId: input.strategyId,
      symbol: input.symbol,
      candles: splits.outOfSample,
      period: "out_of_sample",
      parameters,
      feeModel: STRESS_FEE_MODEL,
      dataSource: "stress_test",
    });

    const walkForwardPass = runWalkForward(input.candles, input.strategyId, parameters, feeModel);
    const chopCollapse =
      (outOfSample.metrics.expectancy ?? 0) > 0 &&
      (stressResult.metrics.expectancy ?? 0) < 0;

    const rejectionReasons = shouldRejectVariant({
      inSample: inSample.metrics,
      validation: validation.metrics,
      outOfSample: outOfSample.metrics,
      walkForwardPass,
      chopCollapse,
    });

    variants.push({
      parameters,
      inSample: inSample.metrics,
      validation: validation.metrics,
      outOfSample: outOfSample.metrics,
      walkForwardPass,
      rejected: rejectionReasons.length > 0,
      rejectionReasons,
    });
  }

  const accepted = variants.filter((v) => !v.rejected);
  const bestVariant =
    accepted.sort(
      (a, b) => (b.outOfSample.expectancy ?? -Infinity) - (a.outOfSample.expectancy ?? -Infinity),
    )[0] ?? null;

  return {
    variants,
    bestVariant,
    status: bestVariant ? "COMPLETED" : "NO_VALID_VARIANT",
    reasonCodes: bestVariant ? [] : ["ALL_VARIANTS_REJECTED"],
  };
}
