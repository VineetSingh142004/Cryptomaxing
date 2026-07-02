import type { DecayAnalysisResult, DecaySeverity, LiveTradeRecord } from "@/lib/trading/live/types";

function netPnl(t: LiveTradeRecord): number {
  return t.grossPnl - t.fees - t.spreadCost - t.slippage - t.funding;
}

function windowMetrics(trades: LiveTradeRecord[]): {
  expectancy: number | null;
  profitFactor: number | null;
  tradeCount: number;
  avgWin: number | null;
  avgLoss: number | null;
  stopOutRate: number | null;
  avgSlippage: number | null;
} {
  if (trades.length === 0) {
    return { expectancy: null, profitFactor: null, tradeCount: 0, avgWin: null, avgLoss: null, stopOutRate: null, avgSlippage: null };
  }
  const nets = trades.map(netPnl);
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n <= 0);
  const gp = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    expectancy: nets.reduce((a, b) => a + b, 0) / nets.length,
    profitFactor: gl > 0 ? gp / gl : null,
    tradeCount: trades.length,
    avgWin: wins.length > 0 ? gp / wins.length : null,
    avgLoss: losses.length > 0 ? gl / losses.length : null,
    stopOutRate: trades.filter((t) => (t.stopSlippage ?? 0) > 0).length / trades.length,
    avgSlippage: trades.reduce((s, t) => s + t.slippage, 0) / trades.length,
  };
}

function filterByDays(trades: LiveTradeRecord[], days: number, now = Date.now()): LiveTradeRecord[] {
  const cutoff = now - days * 86_400_000;
  return trades.filter((t) => new Date(t.exitTime).getTime() >= cutoff);
}

function groupBy<T extends string>(trades: LiveTradeRecord[], key: (t: LiveTradeRecord) => T): Record<string, LiveTradeRecord[]> {
  const out: Record<string, LiveTradeRecord[]> = {};
  for (const t of trades) {
    const k = key(t);
    (out[k] ??= []).push(t);
  }
  return out;
}

export function analyzeForwardDecay(input: {
  strategyId: string;
  trades: LiveTradeRecord[];
  priorExpectancy?: number;
  priorProfitFactor?: number;
  priorSlippage?: number;
  benchmarkAlphaPrior?: number;
  benchmarkAlphaCurrent?: number;
}): DecayAnalysisResult {
  const trades = [...input.trades]
    .filter((t) => t.strategyId === input.strategyId)
    .sort((a, b) => b.exitTime.localeCompare(a.exitTime));

  const signals: string[] = [];
  const reasonCodes: string[] = [];

  const windows: DecayAnalysisResult["windows"] = {
    last_10: windowMetrics(trades.slice(0, 10)),
    last_25: windowMetrics(trades.slice(0, 25)),
    last_50: windowMetrics(trades.slice(0, 50)),
    last_100: windowMetrics(trades.slice(0, 100)),
    last_7d: windowMetrics(filterByDays(trades, 7)),
    last_30d: windowMetrics(filterByDays(trades, 30)),
  };

  const recent = windows.last_10;
  const baseline = windows.last_50.tradeCount >= 20 ? windows.last_50 : windows.last_25;

  if (
    input.priorExpectancy !== undefined &&
    recent.expectancy !== null &&
    recent.expectancy < input.priorExpectancy * 0.7
  ) {
    signals.push("FALLING_EXPECTANCY");
  }

  if (
    input.priorProfitFactor !== undefined &&
    recent.profitFactor !== null &&
    baseline.profitFactor !== null &&
    recent.profitFactor < input.priorProfitFactor * 0.75
  ) {
    signals.push("FALLING_PROFIT_FACTOR");
  }

  if (
    input.priorSlippage !== undefined &&
    recent.avgSlippage !== null &&
    recent.avgSlippage > input.priorSlippage * 1.3
  ) {
    signals.push("RISING_SLIPPAGE");
  }

  if (recent.stopOutRate !== null && recent.stopOutRate > 0.5) {
    signals.push("RISING_STOP_OUT_RATE");
  }

  if (
    baseline.avgWin !== null &&
    recent.avgWin !== null &&
    recent.avgWin < baseline.avgWin * 0.8
  ) {
    signals.push("SHRINKING_AVERAGE_WIN");
  }

  if (
    baseline.avgLoss !== null &&
    recent.avgLoss !== null &&
    recent.avgLoss > baseline.avgLoss * 1.2
  ) {
    signals.push("GROWING_AVERAGE_LOSS");
  }

  if (
    input.benchmarkAlphaPrior !== undefined &&
    input.benchmarkAlphaCurrent !== undefined &&
    input.benchmarkAlphaCurrent < input.benchmarkAlphaPrior * 0.6
  ) {
    signals.push("WEAKER_BENCHMARK_ALPHA");
  }

  const bySession = groupBy(trades.slice(0, 30), (t) => t.session ?? "unknown");
  const sessionExpectancies = Object.values(bySession).map((g) => windowMetrics(g).expectancy ?? 0);
  if (sessionExpectancies.filter((e) => e < 0).length > sessionExpectancies.length / 2) {
    signals.push("SESSION_EDGE_DECAY");
  }

  let severity: DecaySeverity = "NONE";
  if (signals.length >= 5 || signals.includes("FALLING_EXPECTANCY") && (recent.expectancy ?? 0) < 0) {
    severity = "SEVERE";
  } else if (signals.length >= 3) {
    severity = "MODERATE";
  } else if (signals.length >= 1) {
    severity = "MILD";
  }

  let action: DecayAnalysisResult["action"] = "NONE";
  if (severity === "SEVERE") {
    action = recent.expectancy !== null && recent.expectancy < 0 ? "RETURN_TO_PAPER" : "DISABLE_AUTO";
    reasonCodes.push("SEVERE_DECAY");
  } else if (severity === "MODERATE") {
    action = "DEMOTE";
    reasonCodes.push("MODERATE_DECAY");
  } else if (severity === "MILD") {
    action = "REDUCE_RISK";
    reasonCodes.push("MILD_DECAY");
  }

  return {
    strategyId: input.strategyId,
    severity,
    windows,
    signals,
    action,
    reasonCodes,
    analyzedAt: new Date().toISOString(),
  };
}
