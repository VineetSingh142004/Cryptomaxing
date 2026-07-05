import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";

export type OpportunityCostVerdict =
  | "HOLD_BETTER_THAN_WAITING"
  | "WAIT_BETTER_THAN_TRADE"
  | "OPPORTUNITY_COST_EXIT"
  | "BETTER_SETUP_ROTATION_EXIT"
  | "CAPITAL_LOCKUP_EXIT"
  | "LOW_PROFIT_DENSITY_EXIT";

export interface OpenTradeOpportunityInput {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  tpProgressPct: number | null;
  thesisStatus: string;
  staleTrade: boolean;
  ageHours: number;
  capitalLockedUsd: number;
  opportunityScoreAtEntry: number | null;
}

export interface OpportunityCostResult {
  verdict: OpportunityCostVerdict;
  currentExpectedProfitPerHour: number | null;
  profitDensity: number | null;
  bestAlternativeSymbol: string | null;
  bestAlternativeScore: number | null;
  bestAlternativeRewardRisk: number | null;
  scoreAdvantage: number | null;
  shouldExitForBetterSetup: boolean;
  shouldExitStaleCapital: boolean;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function profitPerHour(pnl: number, ageHours: number): number | null {
  if (ageHours <= 0) return null;
  return pnl / ageHours;
}

export function evaluateOpportunityCost(input: {
  openTrade: OpenTradeOpportunityInput;
  bestCandidate: ScanCandidate | null;
  minScoreAdvantageForRotation?: number;
}): OpportunityCostResult {
  const minAdv = input.minScoreAdvantageForRotation ?? 12;
  const alt = input.bestCandidate;
  const altScore = alt?.opportunityScore ?? null;
  const entryScore = input.openTrade.opportunityScoreAtEntry ?? 0;
  const scoreAdv = altScore !== null ? altScore - entryScore : null;
  const pph = profitPerHour(input.openTrade.unrealizedPnl, input.openTrade.ageHours);
  const density =
    input.openTrade.capitalLockedUsd > 0
      ? input.openTrade.unrealizedPnl / input.openTrade.capitalLockedUsd
      : null;

  const weakStale =
    input.openTrade.staleTrade ||
    (input.openTrade.thesisStatus === "WEAKENING" && input.openTrade.unrealizedPnl < 0) ||
    (input.openTrade.tpProgressPct !== null && input.openTrade.tpProgressPct < 15 && input.openTrade.ageHours > 2);

  const betterSetup =
    alt !== null &&
    alt.action === "OPEN_TRADE" &&
    scoreAdv !== null &&
    scoreAdv >= minAdv &&
    weakStale;

  if (betterSetup) {
    return {
      verdict: "BETTER_SETUP_ROTATION_EXIT",
      currentExpectedProfitPerHour: pph,
      profitDensity: density,
      bestAlternativeSymbol: alt.symbol,
      bestAlternativeScore: altScore,
      bestAlternativeRewardRisk: null,
      scoreAdvantage: scoreAdv,
      shouldExitForBetterSetup: true,
      shouldExitStaleCapital: false,
      summary: `${input.openTrade.symbol} is weak/stale; ${alt.symbol} scores ${altScore} vs entry ${entryScore} — rotate capital`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (weakStale && input.openTrade.unrealizedPnl <= 0 && input.openTrade.ageHours >= 3) {
    return {
      verdict: "CAPITAL_LOCKUP_EXIT",
      currentExpectedProfitPerHour: pph,
      profitDensity: density,
      bestAlternativeSymbol: alt?.symbol ?? null,
      bestAlternativeScore: altScore,
      bestAlternativeRewardRisk: null,
      scoreAdvantage: scoreAdv,
      shouldExitForBetterSetup: true,
      shouldExitStaleCapital: true,
      summary: "Capital locked in stale/weak trade with no improvement — release slot",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (density !== null && density < -0.02 && input.openTrade.ageHours >= 1) {
    return {
      verdict: "LOW_PROFIT_DENSITY_EXIT",
      currentExpectedProfitPerHour: pph,
      profitDensity: density,
      bestAlternativeSymbol: alt?.symbol ?? null,
      bestAlternativeScore: altScore,
      bestAlternativeRewardRisk: null,
      scoreAdvantage: scoreAdv,
      shouldExitForBetterSetup: input.openTrade.unrealizedPnl < 0,
      shouldExitStaleCapital: false,
      summary: "Low profit density — holding destroys capital efficiency",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (alt === null || alt.action !== "OPEN_TRADE") {
    return {
      verdict: "WAIT_BETTER_THAN_TRADE",
      currentExpectedProfitPerHour: pph,
      profitDensity: density,
      bestAlternativeSymbol: alt?.symbol ?? null,
      bestAlternativeScore: altScore,
      bestAlternativeRewardRisk: null,
      scoreAdvantage: scoreAdv,
      shouldExitForBetterSetup: false,
      shouldExitStaleCapital: false,
      summary: "No stronger alternative — waiting beats forcing a mediocre trade",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  return {
    verdict: "HOLD_BETTER_THAN_WAITING",
    currentExpectedProfitPerHour: pph,
    profitDensity: density,
    bestAlternativeSymbol: alt.symbol,
    bestAlternativeScore: altScore,
    bestAlternativeRewardRisk: null,
    scoreAdvantage: scoreAdv,
    shouldExitForBetterSetup: false,
    shouldExitStaleCapital: false,
    summary:
      scoreAdv !== null && scoreAdv < minAdv
        ? `Holding ${input.openTrade.symbol} — alternative ${alt.symbol} not materially better (+${scoreAdv.toFixed(0)} score)`
        : `Holding ${input.openTrade.symbol} — current trade still competitive after costs`,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
