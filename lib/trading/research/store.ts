import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type {
  EdgeCandidate,
  MonteCarloResult,
  BacktestResult,
} from "@/lib/trading/research/types";

export async function persistEdgeDiscoveryRun(input: {
  name: string;
  candidates: EdgeCandidate[];
  dataSource: string;
}): Promise<string> {
  const run = await prisma.edgeDiscoveryRun.create({
    data: {
      name: input.name,
      version: "1.0.0",
      dataSource: input.dataSource,
      assumptions: { researchOnly: true, autoApproval: false },
      results: input.candidates as unknown as Prisma.InputJsonValue,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  return run.id;
}

export async function persistAlphaResearch(input: {
  name: string;
  results: Record<string, unknown>;
  feeModel: Record<string, unknown>;
  slippageModel: Record<string, unknown>;
  dataSource: string;
  status: string;
}): Promise<string> {
  const row = await prisma.alphaResearchResult.create({
    data: {
      name: input.name,
      version: "1.0.0",
      dataSource: input.dataSource,
      timeframe: "1m",
      assumptions: { researchOnly: true },
      feeModel: input.feeModel as Prisma.InputJsonValue,
      slippageModel: input.slippageModel as Prisma.InputJsonValue,
      results: input.results as Prisma.InputJsonValue,
      status: input.status,
    },
  });
  return row.id;
}

export async function persistMonteCarloTest(input: {
  strategyRef: string;
  result: MonteCarloResult;
  feeModel: Record<string, unknown>;
}): Promise<string> {
  const row = await prisma.monteCarloTest.create({
    data: {
      strategyRef: input.strategyRef,
      iterations: input.result.iterations,
      dataSource: "monte_carlo_engine",
      assumptions: input.result.assumptions as Prisma.InputJsonValue,
      feeModel: input.feeModel as Prisma.InputJsonValue,
      slippageModel: { slippageWorsening: true } as Prisma.InputJsonValue,
      results: input.result as unknown as Prisma.InputJsonValue,
      status: input.result.blocked ? "BLOCKED" : "COMPLETED",
    },
  });
  return row.id;
}

export async function persistWalkForwardTest(input: {
  strategyRef: string;
  folds: number;
  passed: boolean;
  results: Record<string, unknown>;
}): Promise<string> {
  const row = await prisma.walkForwardTest.create({
    data: {
      strategyRef: input.strategyRef,
      folds: input.folds,
      dataSource: "walk_forward_engine",
      assumptions: { researchOnly: true },
      feeModel: {} as Prisma.InputJsonValue,
      slippageModel: {} as Prisma.InputJsonValue,
      results: input.results as Prisma.InputJsonValue,
      status: input.passed ? "PASSED" : "FAILED",
    },
  });
  return row.id;
}

export async function persistAdversarialTest(input: {
  strategyRef: string;
  scenario: string;
  results: Record<string, unknown>;
  passed: boolean;
}): Promise<string> {
  const row = await prisma.adversarialMarketTest.create({
    data: {
      strategyRef: input.strategyRef,
      scenario: input.scenario,
      dataSource: "adversarial_simulator",
      assumptions: { researchOnly: true },
      results: input.results as Prisma.InputJsonValue,
      status: input.passed ? "PASSED" : "FAILED",
    },
  });
  return row.id;
}

export async function persistBenchmarkResult(input: {
  strategyRef: string;
  benchmarkRef: string;
  alpha: number;
  dataSource: string;
  assumptions: Record<string, unknown>;
}): Promise<string> {
  const row = await prisma.benchmarkAlphaResult.create({
    data: {
      strategyRef: input.strategyRef,
      benchmarkRef: input.benchmarkRef,
      dataSource: input.dataSource,
      timeframe: "1m",
      alpha: input.alpha,
      assumptions: input.assumptions as Prisma.InputJsonValue,
      calculatedAt: new Date(),
    },
  });
  return row.id;
}

export async function persistParameterTest(input: {
  parameterSetId: string;
  testType: string;
  results: Record<string, unknown>;
  status: string;
}): Promise<string> {
  const row = await prisma.parameterTest.create({
    data: {
      parameterSetId: input.parameterSetId,
      testType: input.testType,
      dataSource: "parameter_optimizer",
      assumptions: { researchOnly: true },
      feeModel: {} as Prisma.InputJsonValue,
      slippageModel: {} as Prisma.InputJsonValue,
      results: input.results as Prisma.InputJsonValue,
      status: input.status,
    },
  });
  return row.id;
}

export function summarizeBacktestForStorage(result: BacktestResult): Record<string, unknown> {
  return {
    strategyId: result.strategyId,
    symbol: result.symbol,
    period: result.period,
    status: result.status,
    metrics: result.metrics,
    tradeCount: result.trades.length,
    reasonCodes: result.reasonCodes,
  };
}
