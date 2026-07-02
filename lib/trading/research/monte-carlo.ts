import type { BacktestTrade, MonteCarloResult } from "@/lib/trading/research/types";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function maxDrawdown(equity: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDd = Math.max(maxDd, peak - e);
  }
  return maxDd;
}

function longestLosingStreak(trades: BacktestTrade[]): number {
  let max = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.netPnl <= 0) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 0;
  }
  return max;
}

export function runMonteCarlo(input: {
  trades: BacktestTrade[];
  iterations?: number;
  initialCapital?: number;
  weeklyLossLimitPct?: number;
  ruinThresholdPct?: number;
  seed?: number;
}): MonteCarloResult {
  const iterations = input.iterations ?? 1000;
  const capital = input.initialCapital ?? 10_000;
  const weeklyLimit = input.weeklyLossLimitPct ?? 5;
  const ruinPct = input.ruinThresholdPct ?? 50;
  const rng = seededRng(input.seed ?? 42);

  if (input.trades.length < 5) {
    return {
      iterations: 0,
      probDrawdownGt5Pct: 0,
      probDrawdownGt10Pct: 0,
      probDrawdownGt20Pct: 0,
      probLosingStreakGe5: 0,
      probWeeklyLossLimitHit: 0,
      probAccountRuin: 0,
      worst5PctOutcome: 0,
      medianOutcome: 0,
      best5PctOutcome: 0,
      expectancyCiLower: 0,
      expectancyCiUpper: 0,
      blocked: true,
      blockReasons: ["INSUFFICIENT_TRADES_FOR_MONTE_CARLO"],
      assumptions: { minTrades: 5, actual: input.trades.length },
    };
  }

  const outcomes: number[] = [];
  const drawdowns: number[] = [];
  const streaks: number[] = [];
  let ruinCount = 0;
  let weeklyHit = 0;
  let dd5 = 0;
  let dd10 = 0;
  let dd20 = 0;
  let streak5 = 0;

  const slipWorse = DEFAULT_FEE_MODEL.slippageBps * 1.5;

  for (let i = 0; i < iterations; i++) {
    let shuffled = shuffle(input.trades, rng);

    if (rng() < 0.3) {
      shuffled = shuffled.map((t) => ({
        ...t,
        netPnl: t.netPnl - Math.abs(t.netPnl) * (slipWorse / 10_000) - t.netPnl * 0.02,
      }));
    }

    if (rng() < 0.1) {
      shuffled = shuffled.filter((_, idx) => rng() > 0.05);
    }

    let equity = capital;
    const curve = [equity];
    for (const t of shuffled) {
      equity += t.netPnl;
      curve.push(equity);
    }

    const dd = maxDrawdown(curve);
    const ddPct = (dd / capital) * 100;
    drawdowns.push(ddPct);
    outcomes.push(equity - capital);

    if (ddPct > 5) dd5++;
    if (ddPct > 10) dd10++;
    if (ddPct > 20) dd20++;
    if ((equity - capital) / capital * 100 <= -ruinPct) ruinCount++;

    const streak = longestLosingStreak(shuffled);
    streaks.push(streak);
    if (streak >= 5) streak5++;

    const weeklyLoss = shuffled.slice(0, Math.min(20, shuffled.length))
      .reduce((s, t) => s + t.netPnl, 0);
    if (weeklyLoss / capital * 100 <= -weeklyLimit) weeklyHit++;
  }

  outcomes.sort((a, b) => a - b);
  const expectancies = input.trades.map((t) => t.netPnl);
  const meanExp = expectancies.reduce((a, b) => a + b, 0) / expectancies.length;
  const stdExp = Math.sqrt(
    expectancies.reduce((s, v) => s + (v - meanExp) ** 2, 0) / expectancies.length,
  );

  const blockReasons: string[] = [];
  const worst5 = outcomes[Math.floor(iterations * 0.05)] ?? outcomes[0];
  const probRuin = ruinCount / iterations;

  if (probRuin > 0.05) blockReasons.push("ACCOUNT_THREATENING_WORST_CASE");
  if (worst5 / capital * 100 < -ruinPct * 0.8) blockReasons.push("WORST_5PCT_SEVERE");
  if (meanExp <= 0) blockReasons.push("NEGATIVE_EXPECTANCY");
  if (stdExp > Math.abs(meanExp) * 3 && meanExp > 0) blockReasons.push("HIGH_VARIANCE_EDGE");

  return {
    iterations,
    probDrawdownGt5Pct: dd5 / iterations,
    probDrawdownGt10Pct: dd10 / iterations,
    probDrawdownGt20Pct: dd20 / iterations,
    probLosingStreakGe5: streak5 / iterations,
    probWeeklyLossLimitHit: weeklyHit / iterations,
    probAccountRuin: probRuin,
    worst5PctOutcome: worst5,
    medianOutcome: outcomes[Math.floor(iterations / 2)] ?? 0,
    best5PctOutcome: outcomes[Math.floor(iterations * 0.95)] ?? 0,
    expectancyCiLower: meanExp - 1.96 * (stdExp / Math.sqrt(expectancies.length)),
    expectancyCiUpper: meanExp + 1.96 * (stdExp / Math.sqrt(expectancies.length)),
    blocked: blockReasons.length > 0,
    blockReasons,
    assumptions: {
      slippageWorseningBps: slipWorse,
      missedFillRate: 0.05,
      iterations,
      initialCapital: capital,
    },
  };
}
