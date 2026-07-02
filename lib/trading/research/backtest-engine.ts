import type {
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  FeeSlippageModel,
  ResearchPeriodLabel,
} from "@/lib/trading/research/types";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import {
  applyEntryCosts,
  applyExitCosts,
  computeFundingCost,
  grossPnl,
  shouldMissFill,
} from "@/lib/trading/research/cost-model";
import { SIGNAL_GENERATORS } from "@/lib/trading/research/signals";

function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  if (trades.length === 0) {
    return {
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: null,
      grossProfit: 0,
      grossLoss: 0,
      totalFees: 0,
      totalSlippage: 0,
      totalFunding: 0,
      netProfit: 0,
      expectancy: null,
      profitFactor: null,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      avgWin: null,
      avgLoss: null,
      largestWin: 0,
      largestLoss: 0,
      luckyTradeDominance: null,
      sampleSize: 0,
    };
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netProfit = trades.reduce((s, t) => s + t.netPnl, 0);

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const largestWin = wins.length ? Math.max(...wins.map((t) => t.netPnl)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.netPnl)) : 0;
  const luckyDominance =
    netProfit > 0 && largestWin > 0 ? largestWin / netProfit : null;

  return {
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : null,
    grossProfit,
    grossLoss,
    totalFees: trades.reduce((s, t) => s + t.fees, 0),
    totalSlippage: trades.reduce((s, t) => s + t.slippage, 0),
    totalFunding: trades.reduce((s, t) => s + t.funding, 0),
    netProfit,
    expectancy: netProfit / trades.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdown: maxDd,
    maxDrawdownPct: peak > 0 ? (maxDd / peak) * 100 : 0,
    avgWin: wins.length ? grossProfit / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    largestWin,
    largestLoss,
    luckyTradeDominance: luckyDominance,
    sampleSize: trades.length,
  };
}

export function runBacktest(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  period: ResearchPeriodLabel;
  parameters: Record<string, number>;
  feeModel: FeeSlippageModel;
  dataSource: string;
  rng?: () => number;
}): BacktestResult {
  const generator = SIGNAL_GENERATORS[input.strategyId];
  const reasonCodes: string[] = [];

  if (!generator) {
    return {
      strategyId: input.strategyId,
      symbol: input.symbol,
      period: input.period,
      dataSource: input.dataSource,
      startDate: input.candles[0]?.timestamp ?? "",
      endDate: input.candles.at(-1)?.timestamp ?? "",
      assumptions: input.feeModel,
      trades: [],
      metrics: computeMetrics([]),
      status: "FAILED",
      reasonCodes: ["STRATEGY_NOT_FOUND"],
    };
  }

  if (input.candles.length < 100) {
    return {
      strategyId: input.strategyId,
      symbol: input.symbol,
      period: input.period,
      dataSource: input.dataSource,
      startDate: input.candles[0]?.timestamp ?? "",
      endDate: input.candles.at(-1)?.timestamp ?? "",
      assumptions: input.feeModel,
      trades: [],
      metrics: computeMetrics([]),
      status: "INSUFFICIENT_DATA",
      reasonCodes: ["SAMPLE_SIZE_INSUFFICIENT"],
    };
  }

  const rng = input.rng ?? Math.random;
  const trades: BacktestTrade[] = [];
  const size = 1;
  let i = 50;

  while (i < input.candles.length - 2) {
    const signal = generator({
      candles: input.candles,
      index: i,
      parameters: input.parameters,
    });

    if (!signal || signal.entryIndex >= input.candles.length) {
      i++;
      continue;
    }

    if (shouldMissFill(input.feeModel, rng)) {
      reasonCodes.push("MISSED_FILL_SIMULATED");
      i = signal.entryIndex;
      continue;
    }

    const entryCandle = input.candles[signal.entryIndex];
    const entryBase = entryCandle.open;
    const entryCosts = applyEntryCosts(entryBase, signal.direction, size, input.feeModel);

    let exitIndex = signal.entryIndex;
    let exitPrice = entryCosts.fillPrice;
    let exitReason = "timeout";
    let isStop = false;

    for (let j = signal.entryIndex + 1; j < Math.min(signal.entryIndex + 60, input.candles.length); j++) {
      const c = input.candles[j];
      if (c.low <= signal.stopPrice) {
        exitPrice = signal.stopPrice;
        exitIndex = j;
        exitReason = "stop";
        isStop = true;
        break;
      }
      if (c.high >= signal.targetPrice) {
        exitPrice = signal.targetPrice;
        exitIndex = j;
        exitReason = "target";
        break;
      }
    }

    if (exitReason === "timeout") {
      exitIndex = Math.min(signal.entryIndex + 59, input.candles.length - 1);
      exitPrice = input.candles[exitIndex].close;
    }

    const exitCosts = applyExitCosts(exitPrice, signal.direction, size, input.feeModel, isStop);
    const holdMs =
      new Date(input.candles[exitIndex].timestamp).getTime() -
      new Date(entryCandle.timestamp).getTime();
    const holdHours = holdMs / 3_600_000;
    const notional = entryCosts.fillPrice * size;
    const funding = computeFundingCost(notional, holdHours, input.feeModel);

    const gross = grossPnl(signal.direction, entryCosts.fillPrice, exitCosts.fillPrice, size);
    const fees = entryCosts.fee + exitCosts.fee;
    const slippage = entryCosts.slippage + exitCosts.slippage;
    const net = gross - fees - slippage - funding;
    const risk = Math.abs(entryCosts.fillPrice - signal.stopPrice);
    const rMultiple = risk > 0 ? (exitCosts.fillPrice - entryCosts.fillPrice) / risk : 0;

    trades.push({
      id: `${input.strategyId}-${trades.length}`,
      symbol: input.symbol,
      strategyId: input.strategyId,
      direction: signal.direction,
      entryTime: entryCandle.timestamp,
      exitTime: input.candles[exitIndex].timestamp,
      entryPrice: entryCosts.fillPrice,
      exitPrice: exitCosts.fillPrice,
      size,
      grossPnl: gross,
      fees,
      slippage,
      funding,
      netPnl: net,
      rMultiple: signal.direction === "long" ? rMultiple : -rMultiple,
      exitReason,
      sessionHour: new Date(entryCandle.timestamp).getUTCHours(),
      regime: signal.regime,
      parameters: input.parameters,
    });

    i = exitIndex + 5;
  }

  const metrics = computeMetrics(trades);

  return {
    strategyId: input.strategyId,
    symbol: input.symbol,
    period: input.period,
    dataSource: input.dataSource,
    startDate: input.candles[0].timestamp,
    endDate: input.candles[input.candles.length - 1].timestamp,
    assumptions: input.feeModel,
    trades,
    metrics,
    status: trades.length === 0 ? "NO_TRADES" : "COMPLETED",
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export { computeMetrics };
