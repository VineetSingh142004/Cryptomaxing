import type { NormalizedCandle } from "@/lib/trading/data/types";

export type ApprovalStatus = "RESEARCH_ONLY" | "PROOF_CANDIDATE" | "REJECTED" | "NOT_IMPLEMENTED";

export type ResearchPeriodLabel = "in_sample" | "validation" | "out_of_sample";

export interface FeeSlippageModel {
  makerBps: number;
  takerBps: number;
  slippageBps: number;
  slippageWorseningBps?: number;
  fundingBpsPer8h?: number;
  missedFillRate?: number;
  partialFillRate?: number;
  stopSlippageBps?: number;
  source: string;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  funding: number;
  netPnl: number;
  rMultiple: number;
  exitReason: string;
  sessionHour: number;
  regime: string;
  parameters: Record<string, number>;
}

export interface BacktestMetrics {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
  totalSlippage: number;
  totalFunding: number;
  netProfit: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgWin: number | null;
  avgLoss: number | null;
  largestWin: number;
  largestLoss: number;
  luckyTradeDominance: number | null;
  sampleSize: number;
}

export interface BacktestResult {
  strategyId: string;
  symbol: string;
  period: ResearchPeriodLabel;
  dataSource: string;
  startDate: string;
  endDate: string;
  assumptions: FeeSlippageModel;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  status: "COMPLETED" | "INSUFFICIENT_DATA" | "NO_TRADES" | "BLOCKED" | "FAILED";
  reasonCodes: string[];
}

export interface EdgeCandidate {
  edge_candidate: string;
  edge_conditions: Record<string, unknown>;
  supporting_data: Record<string, unknown>;
  sample_size: number;
  net_expectancy_after_costs: number | null;
  regimes_where_edge_works: string[];
  regimes_where_edge_fails: string[];
  overfit_risk: "low" | "medium" | "high" | "unknown";
  approval_status: ApprovalStatus;
  reason_codes: string[];
}

export interface OptimizationVariantResult {
  parameters: Record<string, number>;
  inSample: BacktestMetrics;
  validation: BacktestMetrics;
  outOfSample: BacktestMetrics;
  walkForwardPass: boolean;
  rejected: boolean;
  rejectionReasons: string[];
}

export interface MonteCarloResult {
  iterations: number;
  probDrawdownGt5Pct: number;
  probDrawdownGt10Pct: number;
  probDrawdownGt20Pct: number;
  probLosingStreakGe5: number;
  probWeeklyLossLimitHit: number;
  probAccountRuin: number;
  worst5PctOutcome: number;
  medianOutcome: number;
  best5PctOutcome: number;
  expectancyCiLower: number;
  expectancyCiUpper: number;
  blocked: boolean;
  blockReasons: string[];
  assumptions: Record<string, unknown>;
}

export interface AdversarialScenarioResult {
  scenario: string;
  survivalRate: number;
  netExpectancy: number | null;
  maxDrawdown: number;
  passed: boolean;
  reasonCode: string;
}

export interface BenchmarkComparison {
  benchmarkRef: string;
  benchmarkReturn: number;
  strategyReturn: number;
  alpha: number;
  netAlphaAfterCosts: number;
  riskAdjustedReturn: number | null;
  edgeConfidence: number;
}

export interface SessionEdgeStats {
  hour: number;
  sessionLabel: string;
  tradeCount: number;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  avgSpreadBps: number | null;
  fakeoutRate: number | null;
  recommendation: "PREFER" | "NEUTRAL" | "REDUCE_RISK" | "BLOCK";
  reasonCodes: string[];
}

export interface ResearchRunConfig {
  strategyId: string;
  symbol: string;
  minHistoryDays: number;
  feeModel: FeeSlippageModel;
}

export function candlesToSorted(candles: NormalizedCandle[]): NormalizedCandle[] {
  return [...candles].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function splitPeriods<T extends { timestamp: string }>(
  data: T[],
  ratios = { train: 0.6, validation: 0.2, test: 0.2 },
): { inSample: T[]; validation: T[]; outOfSample: T[] } {
  const sorted = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const n = sorted.length;
  const trainEnd = Math.floor(n * ratios.train);
  const valEnd = Math.floor(n * (ratios.train + ratios.validation));
  return {
    inSample: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, valEnd),
    outOfSample: sorted.slice(valEnd),
  };
}

export function historySpanDays(candles: NormalizedCandle[]): number {
  if (candles.length < 2) return 0;
  const sorted = candlesToSorted(candles);
  const first = new Date(sorted[0].timestamp).getTime();
  const last = new Date(sorted[sorted.length - 1].timestamp).getTime();
  return (last - first) / 86_400_000;
}
