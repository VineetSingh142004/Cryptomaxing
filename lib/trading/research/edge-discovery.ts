import type { BacktestTrade, EdgeCandidate } from "@/lib/trading/research/types";
import { runBacktest } from "@/lib/trading/research/backtest-engine";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import { splitPeriods } from "@/lib/trading/research/types";
import { getStrategyById } from "@/lib/trading/strategies/definitions";

function groupByRegime(trades: BacktestTrade[]): Record<string, BacktestTrade[]> {
  const groups: Record<string, BacktestTrade[]> = {};
  for (const t of trades) {
    groups[t.regime] = groups[t.regime] ?? [];
    groups[t.regime].push(t);
  }
  return groups;
}

function regimeExpectancy(trades: BacktestTrade[]): number | null {
  if (trades.length === 0) return null;
  return trades.reduce((s, t) => s + t.netPnl, 0) / trades.length;
}

export function discoverEdge(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  parameters?: Record<string, number>;
}): EdgeCandidate {
  const strategy = getStrategyById(input.strategyId);
  const params = input.parameters ?? (strategy?.parameters as Record<string, number>) ?? {};
  const splits = splitPeriods(input.candles);

  const inSample = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: splits.inSample,
    period: "in_sample",
    parameters: params,
    feeModel: DEFAULT_FEE_MODEL,
    dataSource: "edge_discovery",
  });

  const oos = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: splits.outOfSample,
    period: "out_of_sample",
    parameters: params,
    feeModel: DEFAULT_FEE_MODEL,
    dataSource: "edge_discovery",
  });

  const allTrades = [...inSample.trades, ...oos.trades];
  const byRegime = groupByRegime(allTrades);
  const works: string[] = [];
  const fails: string[] = [];

  for (const [regime, trades] of Object.entries(byRegime)) {
    const exp = regimeExpectancy(trades);
    if (exp !== null && exp > 0) works.push(regime);
    else if (exp !== null && exp <= 0) fails.push(regime);
  }

  const isExp = inSample.metrics.expectancy ?? 0;
  const oosExp = oos.metrics.expectancy ?? 0;
  let overfit_risk: EdgeCandidate["overfit_risk"] = "unknown";
  if (isExp > 0 && oosExp < 0) overfit_risk = "high";
  else if (isExp > 0 && oosExp >= 0 && oosExp < isExp * 0.5) overfit_risk = "medium";
  else if (oosExp > 0) overfit_risk = "low";

  const reason_codes: string[] = ["RESEARCH_ONLY_DEFAULT"];
  if (allTrades.length < 10) reason_codes.push("SAMPLE_SIZE_LOW");
  if ((oos.metrics.netProfit ?? 0) <= 0) reason_codes.push("OOS_NET_NOT_POSITIVE");
  if (overfit_risk === "high") reason_codes.push("OVERFIT_SUSPECTED");

  return {
    edge_candidate: `${input.strategyId}:${input.symbol}`,
    edge_conditions: {
      strategyId: input.strategyId,
      symbol: input.symbol,
      parameters: params,
      bestRegimes: works,
      sessions: [...new Set(allTrades.map((t) => t.sessionHour))],
    },
    supporting_data: {
      inSampleMetrics: inSample.metrics,
      oosMetrics: oos.metrics,
      dataSource: inSample.dataSource,
    },
    sample_size: allTrades.length,
    net_expectancy_after_costs: oos.metrics.expectancy,
    regimes_where_edge_works: works,
    regimes_where_edge_fails: fails,
    overfit_risk,
    approval_status: "RESEARCH_ONLY",
    reason_codes,
  };
}

export function runEdgeDiscoveryBatch(input: {
  strategyIds: string[];
  symbols: string[];
  candlesBySymbol: Record<string, NormalizedCandle[]>;
}): EdgeCandidate[] {
  const results: EdgeCandidate[] = [];
  for (const strategyId of input.strategyIds) {
    for (const symbol of input.symbols) {
      const candles = input.candlesBySymbol[symbol];
      if (!candles?.length) continue;
      results.push(
        discoverEdge({ strategyId, symbol, candles }),
      );
    }
  }
  return results;
}
