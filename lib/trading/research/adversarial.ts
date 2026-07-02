import type { AdversarialScenarioResult } from "@/lib/trading/research/types";
import type { NormalizedCandle } from "@/lib/trading/data/types";
import { runBacktest } from "@/lib/trading/research/backtest-engine";
import { DEFAULT_FEE_MODEL, STRESS_FEE_MODEL } from "@/lib/trading/research/cost-model";

export const ADVERSARIAL_SCENARIOS = [
  "sudden_spread_widening",
  "fake_breakout",
  "liquidity_rug",
  "stop_hunt_wick",
  "exchange_latency_spike",
  "btc_crash_during_alt",
  "funding_spike",
  "candle_gap",
  "partial_fill_reversal",
  "stop_order_failure",
  "delayed_exit",
  "volatility_explosion",
  "chop_regime_after_entry",
] as const;

export type AdversarialScenario = (typeof ADVERSARIAL_SCENARIOS)[number];

function applyScenarioToCandles(
  candles: NormalizedCandle[],
  scenario: AdversarialScenario,
): NormalizedCandle[] {
  const copy = candles.map((c) => ({ ...c }));

  switch (scenario) {
    case "stop_hunt_wick":
      for (let i = 10; i < copy.length; i += 50) {
        copy[i] = {
          ...copy[i],
          low: copy[i].low * 0.985,
          high: copy[i].high * 1.005,
        };
      }
      break;
    case "fake_breakout":
      for (let i = 15; i < copy.length; i += 40) {
        copy[i] = {
          ...copy[i],
          high: copy[i].high * 1.02,
          close: copy[i].open * 0.998,
        };
      }
      break;
    case "volatility_explosion":
      for (let i = 0; i < copy.length; i++) {
        const mid = (copy[i].high + copy[i].low) / 2;
        copy[i] = {
          ...copy[i],
          high: mid * 1.015,
          low: mid * 0.985,
        };
      }
      break;
    case "candle_gap":
      if (copy.length > 100) {
        const idx = Math.floor(copy.length / 2);
        copy[idx] = {
          ...copy[idx],
          open: copy[idx - 1].close * 1.02,
          low: copy[idx - 1].close * 1.01,
        };
      }
      break;
    case "chop_regime_after_entry":
      for (let i = 20; i < copy.length; i += 3) {
        copy[i] = {
          ...copy[i],
          close: copy[i - 1].close * (1 + (Math.sin(i) * 0.002)),
        };
      }
      break;
    default:
      break;
  }

  return copy;
}

function feeModelForScenario(scenario: AdversarialScenario) {
  switch (scenario) {
    case "sudden_spread_widening":
    case "liquidity_rug":
      return { ...STRESS_FEE_MODEL, slippageBps: 40, stopSlippageBps: 60 };
    case "exchange_latency_spike":
    case "delayed_exit":
      return { ...STRESS_FEE_MODEL, slippageBps: 25, missedFillRate: 0.2 };
    case "funding_spike":
      return { ...DEFAULT_FEE_MODEL, fundingBpsPer8h: 15 };
    case "stop_order_failure":
      return { ...STRESS_FEE_MODEL, stopSlippageBps: 50, missedFillRate: 0.1 };
    case "partial_fill_reversal":
      return { ...STRESS_FEE_MODEL, partialFillRate: 0.4, slippageBps: 20 };
    case "btc_crash_during_alt":
      return { ...STRESS_FEE_MODEL, slippageBps: 30 };
    default:
      return STRESS_FEE_MODEL;
  }
}

export function runAdversarialScenario(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  scenario: AdversarialScenario;
  parameters: Record<string, number>;
}): AdversarialScenarioResult {
  const modified = applyScenarioToCandles(input.candles, input.scenario);
  const feeModel = feeModelForScenario(input.scenario);

  const baseline = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: input.candles,
    period: "in_sample",
    parameters: input.parameters,
    feeModel: DEFAULT_FEE_MODEL,
    dataSource: "adversarial_baseline",
  });

  const stressed = runBacktest({
    strategyId: input.strategyId,
    symbol: input.symbol,
    candles: modified,
    period: "in_sample",
    parameters: input.parameters,
    feeModel,
    dataSource: `adversarial_${input.scenario}`,
    rng: () => 0.99,
  });

  const baselineExp = baseline.metrics.expectancy ?? 0;
  const stressedExp = stressed.metrics.expectancy ?? 0;
  const survivalRate =
    baselineExp !== 0
      ? Math.max(0, Math.min(1, stressedExp / baselineExp))
      : stressedExp >= 0
        ? 1
        : 0;

  const passed =
    (stressed.metrics.expectancy ?? -Infinity) >= 0 &&
    stressed.metrics.maxDrawdownPct < 35 &&
    stressed.metrics.tradeCount >= 3;

  return {
    scenario: input.scenario,
    survivalRate,
    netExpectancy: stressed.metrics.expectancy,
    maxDrawdown: stressed.metrics.maxDrawdown,
    passed,
    reasonCode: passed ? "SCENARIO_SURVIVED" : "SCENARIO_FAILED",
  };
}

export function runAllAdversarialTests(input: {
  strategyId: string;
  symbol: string;
  candles: NormalizedCandle[];
  parameters: Record<string, number>;
}): {
  results: AdversarialScenarioResult[];
  overallPass: boolean;
  failedScenarios: string[];
} {
  const results = ADVERSARIAL_SCENARIOS.map((scenario) =>
    runAdversarialScenario({ ...input, scenario }),
  );
  const failedScenarios = results.filter((r) => !r.passed).map((r) => r.scenario);
  const passRate = results.filter((r) => r.passed).length / results.length;

  return {
    results,
    overallPass: passRate >= 0.6 && failedScenarios.length < 5,
    failedScenarios,
  };
}
