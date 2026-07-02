import { DATA_QUALITY_THRESHOLDS } from "@/lib/trading/data/types";
import { runAllAdversarialTests } from "@/lib/trading/research/adversarial";
import { runBacktest } from "@/lib/trading/research/backtest-engine";
import { runBenchmarkComparison } from "@/lib/trading/research/benchmark";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import { discoverEdge } from "@/lib/trading/research/edge-discovery";
import {
  ensureResearchVenuesAndAssets,
  loadOrFetchHistoricalCandles,
} from "@/lib/trading/research/historical-data";
import { runMonteCarlo } from "@/lib/trading/research/monte-carlo";
import { runParameterOptimization, runWalkForward } from "@/lib/trading/research/parameter-optimizer";
import { analyzeSessionEdge } from "@/lib/trading/research/session-edge";
import {
  persistAdversarialTest,
  persistAlphaResearch,
  persistBenchmarkResult,
  persistEdgeDiscoveryRun,
  persistMonteCarloTest,
  persistWalkForwardTest,
  summarizeBacktestForStorage,
} from "@/lib/trading/research/store";
import { splitPeriods } from "@/lib/trading/research/types";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

export const RESEARCH_ENGINE_STATUS = "ACTIVE" as const;

export async function runFullResearchPipeline(input: {
  strategyId: string;
  symbol: string;
  minHistoryDays?: number;
  persist?: boolean;
}) {
  await ensureResearchVenuesAndAssets();

  const minDays = input.minHistoryDays ?? DATA_QUALITY_THRESHOLDS.minBacktestDays1m;
  const history = await loadOrFetchHistoricalCandles({
    symbol: input.symbol,
    timeframe: "1m",
    minDays,
  });

  if (!history.sufficient) {
    return {
      status: "INSUFFICIENT_DATA",
      reasonCodes: history.reasonCodes,
      spanDays: history.spanDays,
      approval_status: "RESEARCH_ONLY" as const,
      message: "Cannot run research — insufficient historical data. No fake backtest generated.",
    };
  }

  const strategy = getStrategyById(input.strategyId);
  if (!strategy) {
    return { status: "FAILED", reasonCodes: ["STRATEGY_NOT_FOUND"] };
  }

  const parameters = strategy.parameters as Record<string, number>;
  const splits = splitPeriods(history.candles);

  const oosBacktest = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: splits.outOfSample,
    period: "out_of_sample",
    parameters,
    feeModel: DEFAULT_FEE_MODEL,
    dataSource: history.dataSource,
  });

  const edge = discoverEdge({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: history.candles,
    parameters,
  });

  const optimization = runParameterOptimization({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: history.candles,
  });

  const monteCarlo = runMonteCarlo({ trades: oosBacktest.trades });
  const adversarial = runAllAdversarialTests({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: history.candles,
    parameters,
  });
  const benchmark = runBenchmarkComparison({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: splits.outOfSample,
    parameters,
  });
  const sessionEdge = analyzeSessionEdge(oosBacktest.trades);
  const walkForwardPass = runWalkForward(
    history.candles,
    input.strategyId,
    optimization.bestVariant?.parameters ?? parameters,
    DEFAULT_FEE_MODEL,
  );

  const blocked =
    monteCarlo.blocked ||
    !benchmark.hasRealAlpha ||
    !adversarial.overallPass ||
    edge.overfit_risk === "high" ||
    !walkForwardPass;

  const result = {
    status: blocked ? "BLOCKED" : "COMPLETED",
    approval_status: "RESEARCH_ONLY" as const,
    dataSource: history.dataSource,
    spanDays: history.spanDays,
    sampleSize: oosBacktest.metrics.sampleSize,
    edge,
    backtest: summarizeBacktestForStorage(oosBacktest),
    optimization: {
      status: optimization.status,
      bestVariant: optimization.bestVariant,
      variantCount: optimization.variants.length,
      rejectedCount: optimization.variants.filter((v) => v.rejected).length,
    },
    monteCarlo,
    adversarial,
    benchmark,
    sessionEdge,
    walkForwardPass,
    blocked,
    blockReasons: [
      ...(monteCarlo.blockReasons ?? []),
      ...benchmark.reasonCodes,
      ...(adversarial.overallPass ? [] : ["ADVERSARIAL_FAILED"]),
      ...(walkForwardPass ? [] : ["WALK_FORWARD_FAILED"]),
      ...(edge.overfit_risk === "high" ? ["OVERFIT_HIGH"] : []),
    ],
  };

  if (input.persist !== false) {
    await persistEdgeDiscoveryRun({
      name: `${input.strategyId}:${input.symbol}`,
      candidates: [edge],
      dataSource: history.dataSource,
    });
    await persistAlphaResearch({
      name: `full_pipeline:${input.strategyId}`,
      results: result as unknown as Record<string, unknown>,
      feeModel: { ...DEFAULT_FEE_MODEL },
      slippageModel: { bps: DEFAULT_FEE_MODEL.slippageBps },
      dataSource: history.dataSource,
      status: result.status,
    });
    await persistMonteCarloTest({
      strategyRef: input.strategyId,
      result: monteCarlo,
      feeModel: { ...DEFAULT_FEE_MODEL },
    });
    await persistWalkForwardTest({
      strategyRef: input.strategyId,
      folds: 3,
      passed: walkForwardPass,
      results: { pass: walkForwardPass },
    });
    for (const adv of adversarial.results) {
      await persistAdversarialTest({
        strategyRef: input.strategyId,
        scenario: adv.scenario,
        results: adv as unknown as Record<string, unknown>,
        passed: adv.passed,
      });
    }
    for (const comp of benchmark.comparisons) {
      await persistBenchmarkResult({
        strategyRef: input.strategyId,
        benchmarkRef: comp.benchmarkRef,
        alpha: comp.alpha,
        dataSource: history.dataSource,
        assumptions: { researchOnly: true },
      });
    }
  }

  return result;
}

export {
  runBacktest,
  discoverEdge,
  runParameterOptimization,
  runMonteCarlo,
  runAllAdversarialTests,
  runBenchmarkComparison,
  analyzeSessionEdge,
  loadOrFetchHistoricalCandles,
  splitPeriods,
};

export * from "@/lib/trading/research/types";
