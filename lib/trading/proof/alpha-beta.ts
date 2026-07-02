export interface TradeWindowReturn {
  symbol: string;
  returnPct: number;
  windowStart: string;
  windowEnd: string;
}

export interface TodayAlphaBetaInput {
  reportDate: string;
  strategyNetPnl: number;
  strategyGrossPnl: number;
  notional: number;
  leverage?: number;
  tradeWindows: { start: string; end: string }[];
  benchmarkReturns: {
    btc?: TradeWindowReturn;
    eth?: TradeWindowReturn;
    sol?: TradeWindowReturn;
    assetHold?: TradeWindowReturn;
  };
  randomEntryNetPnl: number;
  randomSameHoldNetPnl: number;
  netPnlBeforeCosts: number;
  netPnlAfterCosts: number;
  totalCosts: number;
  luckyTradeDominance?: number | null;
}

export interface TodayAlphaBetaResult {
  reportDate: string;
  today_alpha_vs_btc: number | null;
  today_alpha_vs_eth: number | null;
  today_alpha_vs_sol: number | null;
  today_alpha_vs_asset_hold: number | null;
  today_alpha_vs_random: number;
  today_net_alpha_after_costs: number;
  beta_dependency_score: number;
  leverage_dependency_score: number;
  luck_dependency_score: number;
  real_edge_score: number;
  flags: string[];
  benchmarkReturns: Record<string, number | null>;
  randomBaseline: Record<string, number | null>;
  generatedAt: string;
}

function windowReturn(notional: number, returnPct: number): number {
  return notional * (returnPct / 100);
}

export function analyzeTodayAlphaBeta(input: TodayAlphaBetaInput): TodayAlphaBetaResult {
  const flags: string[] = [];
  const lev = input.leverage ?? 1;
  const notional = input.notional;

  const stratReturnPct = notional > 0 ? (input.strategyNetPnl / notional) * 100 : 0;

  const alphaBtc = input.benchmarkReturns.btc
    ? stratReturnPct - input.benchmarkReturns.btc.returnPct
    : null;
  const alphaEth = input.benchmarkReturns.eth
    ? stratReturnPct - input.benchmarkReturns.eth.returnPct
    : null;
  const alphaSol = input.benchmarkReturns.sol
    ? stratReturnPct - input.benchmarkReturns.sol.returnPct
    : null;
  const alphaHold = input.benchmarkReturns.assetHold
    ? stratReturnPct - input.benchmarkReturns.assetHold.returnPct
    : null;

  const alphaRandom = input.strategyNetPnl - input.randomEntryNetPnl;
  const today_net_alpha_after_costs = input.netPnlAfterCosts - windowReturn(notional, input.benchmarkReturns.btc?.returnPct ?? 0);

  const btcMove = Math.abs(input.benchmarkReturns.btc?.returnPct ?? 0);
  const ethMove = Math.abs(input.benchmarkReturns.eth?.returnPct ?? 0);
  const beta_dependency_score = Math.min(100, (btcMove + ethMove) * 10 + (alphaBtc !== null && alphaBtc < 0.1 ? 40 : 0));

  const grossWithoutLev = input.netPnlBeforeCosts / lev;
  const leverage_dependency_score =
    lev > 1 && grossWithoutLev <= 0 && input.netPnlAfterCosts > 0 ? 85 : lev > 1 ? 40 : 10;

  const luck_dependency_score = Math.min(100, (input.luckyTradeDominance ?? 0) * 100);

  let real_edge_score = 50;
  if (alphaRandom > 0) real_edge_score += 15;
  if (today_net_alpha_after_costs > 0) real_edge_score += 20;
  if (input.netPnlAfterCosts > input.netPnlBeforeCosts * 0.5) real_edge_score += 10;
  real_edge_score = Math.max(0, Math.min(100, real_edge_score - beta_dependency_score * 0.3));

  if (beta_dependency_score > 60 && (alphaBtc ?? 0) < 0.2) flags.push("BETA_NOT_ALPHA");
  if (leverage_dependency_score > 70) flags.push("LEVERAGE_DEPENDENT");
  if (Math.abs(alphaRandom) < notional * 0.001) flags.push("NO_SIGNAL_EDGE");
  if (input.netPnlAfterCosts <= 0 && input.netPnlBeforeCosts > 0) flags.push("COST_KILLED");
  if (today_net_alpha_after_costs > 0 && input.netPnlAfterCosts > 0 && !flags.includes("BETA_NOT_ALPHA")) {
    flags.push("TODAY_EDGE_OBSERVED");
  }

  return {
    reportDate: input.reportDate,
    today_alpha_vs_btc: alphaBtc,
    today_alpha_vs_eth: alphaEth,
    today_alpha_vs_sol: alphaSol,
    today_alpha_vs_asset_hold: alphaHold,
    today_alpha_vs_random: alphaRandom,
    today_net_alpha_after_costs,
    beta_dependency_score,
    leverage_dependency_score,
    luck_dependency_score,
    real_edge_score,
    flags,
    benchmarkReturns: {
      btc: input.benchmarkReturns.btc?.returnPct ?? null,
      eth: input.benchmarkReturns.eth?.returnPct ?? null,
      sol: input.benchmarkReturns.sol?.returnPct ?? null,
      assetHold: input.benchmarkReturns.assetHold?.returnPct ?? null,
    },
    randomBaseline: {
      randomEntry: input.randomEntryNetPnl,
      randomSameHold: input.randomSameHoldNetPnl,
    },
    generatedAt: new Date().toISOString(),
  };
}
