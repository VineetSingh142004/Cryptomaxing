import type { LiveTradeRecord, ProfitAttributionResult } from "@/lib/trading/live/types";

function netPnl(t: LiveTradeRecord): number {
  return t.grossPnl - t.fees - t.spreadCost - t.slippage - t.funding;
}

function sumByGroup(trades: LiveTradeRecord[], key: (t: LiveTradeRecord) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of trades) {
    const k = key(t);
    out[k] = (out[k] ?? 0) + netPnl(t);
  }
  return out;
}

export function attributeProfit(input: {
  period: string;
  strategyId: string;
  trades: LiveTradeRecord[];
  randomBaselineNet?: number;
  benchmarkNet?: number;
}): ProfitAttributionResult {
  const reasonCodes: string[] = [];
  const trades = input.trades.filter((t) => t.strategyId === input.strategyId && t.reconciled !== false);

  if (trades.length === 0) {
    return {
      period: input.period,
      strategyId: input.strategyId,
      netProfit: 0,
      byStrategy: {},
      byAsset: {},
      byVenue: {},
      bySession: {},
      byRegime: {},
      byComponent: {
        entryTiming: 0,
        exitTiming: 0,
        leverage: 0,
        executionQuality: 0,
        spreadCost: 0,
        slippageCost: 0,
        fundingCost: 0,
        marketDirection: 0,
        benchmarkMovement: 0,
        luckConcentration: 0,
      },
      betaShare: 0,
      leverageShare: 0,
      oneTradeShare: 0,
      unexplainedShare: 1,
      entryBeatsRandom: false,
      exitReducesExpectancy: false,
      scalingAllowed: false,
      reasonCodes: ["NO_VERIFIED_TRADES"],
      generatedAt: new Date().toISOString(),
    };
  }

  const netProfit = trades.reduce((s, t) => s + netPnl(t), 0);
  const grossTotal = trades.reduce((s, t) => s + t.grossPnl, 0);

  const spreadCost = trades.reduce((s, t) => s + t.spreadCost, 0);
  const slippageCost = trades.reduce((s, t) => s + t.slippage + (t.stopSlippage ?? 0), 0);
  const fundingCost = trades.reduce((s, t) => s + t.funding, 0);

  const benchmarkMovement = trades.reduce(
    (s, t) => s + (t.benchmarkReturnPct ?? 0) / 100 * t.entryPrice * t.size,
    0,
  );

  const leveragePnL = trades.reduce((s, t) => {
    const lev = t.leverage ?? 1;
    return s + (lev > 1 ? netPnl(t) * (1 - 1 / lev) : 0);
  }, 0);

  const nets = trades.map(netPnl);
  const best = Math.max(...nets);
  const oneTradeShare = netProfit > 0 ? best / netProfit : 0;

  const betaShare =
    netProfit !== 0 ? Math.min(1, Math.abs(benchmarkMovement) / Math.abs(netProfit)) : 0;
  const leverageShare =
    netProfit !== 0 ? Math.min(1, Math.abs(leveragePnL) / Math.abs(netProfit)) : 0;

  const explained =
    Math.abs(spreadCost) +
    Math.abs(slippageCost) +
    Math.abs(fundingCost) +
    Math.abs(benchmarkMovement) +
    Math.abs(leveragePnL);
  const unexplainedShare =
    Math.abs(netProfit) > 0 ? Math.max(0, 1 - explained / (Math.abs(netProfit) + explained)) : 1;

  const entryBeatsRandom =
    input.randomBaselineNet !== undefined ? netProfit > input.randomBaselineNet : false;

  const exitDrag = trades.filter((t) => (t.exitQualityScore ?? 50) < 40);
  const exitReducesExpectancy =
    exitDrag.length > 0 &&
    exitDrag.reduce((s, t) => s + netPnl(t), 0) / exitDrag.length <
      netProfit / trades.length;

  let scalingAllowed = true;
  if (betaShare > 0.6) {
    scalingAllowed = false;
    reasonCodes.push("BETA_NOT_STRATEGY_EDGE");
  }
  if (leverageShare > 0.5 && grossTotal / (trades.reduce((s, t) => s + (t.leverage ?? 1), 0) / trades.length) <= 0) {
    scalingAllowed = false;
    reasonCodes.push("LEVERAGE_NOT_STRATEGY_EDGE");
  }
  if (oneTradeShare > 0.3) {
    scalingAllowed = false;
    reasonCodes.push("ONE_TRADE_DOMINATES");
  }
  if (unexplainedShare > 0.4) {
    scalingAllowed = false;
    reasonCodes.push("PROFIT_UNEXPLAINED");
  }
  if (!entryBeatsRandom && input.randomBaselineNet !== undefined) {
    scalingAllowed = false;
    reasonCodes.push("ENTRY_NOT_BEAT_RANDOM");
  }
  if (exitReducesExpectancy) reasonCodes.push("EXIT_LOGIC_REDUCES_EXPECTANCY");

  return {
    period: input.period,
    strategyId: input.strategyId,
    netProfit,
    byStrategy: sumByGroup(trades, (t) => t.strategyId),
    byAsset: sumByGroup(trades, (t) => t.symbol),
    byVenue: sumByGroup(trades, (t) => t.venue),
    bySession: sumByGroup(trades, (t) => t.session ?? "unknown"),
    byRegime: sumByGroup(trades, (t) => t.regime ?? "unknown"),
    byComponent: {
      entryTiming: trades.reduce((s, t) => s + ((t.entryQualityScore ?? 50) / 100) * netPnl(t), 0),
      exitTiming: trades.reduce((s, t) => s + ((t.exitQualityScore ?? 50) / 100) * netPnl(t), 0),
      leverage: leveragePnL,
      executionQuality: trades.reduce((s, t) => s + ((t.fillProbability ?? 0.5) * netPnl(t)), 0),
      spreadCost: -spreadCost,
      slippageCost: -slippageCost,
      fundingCost: -fundingCost,
      marketDirection: benchmarkMovement,
      benchmarkMovement,
      luckConcentration: oneTradeShare * netProfit,
    },
    betaShare,
    leverageShare,
    oneTradeShare,
    unexplainedShare,
    entryBeatsRandom,
    exitReducesExpectancy,
    scalingAllowed,
    reasonCodes,
    generatedAt: new Date().toISOString(),
  };
}
