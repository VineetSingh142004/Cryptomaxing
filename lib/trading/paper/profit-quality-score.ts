import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { V6LossLesson } from "@/lib/trading/paper/v6-loss-postmortem";

export interface ProfitQualityScore {
  total: number;
  expectedNetReward: number;
  rewardRisk: number;
  momentumQuality: number;
  breakoutQuality: number;
  trendQuality: number;
  dataQuality: number;
  executionQuality: number;
  spreadLiquidity: number;
  regimeAlignment: number;
  lossPatternPenalty: number;
  whyBetterThanWaiting: string;
  whyMayFail: string;
  invalidationTriggers: string[];
  similarV6Loss: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function computeProfitQualityScore(input: {
  candidate: ScanCandidate;
  rewardRiskRatio?: number;
  btcEthAligned?: boolean;
  v6Lessons?: V6LossLesson[];
}): ProfitQualityScore {
  const c = input.candidate;
  const rr = input.rewardRiskRatio ?? 1;
  const momentumQ = clamp(c.momentumScore ?? 0);
  const breakoutQ =
    c.breakoutScoreStatus === "NOT_COMPUTED" ? 0 : clamp(c.breakoutScore ?? 0);
  const trendQ = c.trendScoreStatus === "NOT_COMPUTED" ? 0 : clamp(c.trendScore ?? 0);
  const dataQ = clamp(c.dataQualityScore ?? 0);
  const spreadLiq = clamp(100 - (c.spreadBps ?? 50) * 0.5);
  const regime = input.btcEthAligned ? 80 : 50;
  const expectedNet = clamp(rr * 25 + momentumQ * 0.2);
  const rewardRisk = clamp(rr * 30);

  const similarLoss = (input.v6Lessons ?? []).some(
    (l) => l.symbol === c.symbol || l.commonPattern.includes("negative momentum"),
  );
  const lossPenalty = similarLoss ? 25 : c.providerAnomalyFlags?.length ? 15 : 0;

  const total = clamp(
    expectedNet * 0.2 +
      rewardRisk * 0.15 +
      momentumQ * 0.15 +
      breakoutQ * 0.1 +
      trendQ * 0.1 +
      dataQ * 0.1 +
      spreadLiq * 0.1 +
      regime * 0.1 -
      lossPenalty,
  );

  const whyBetter =
    total >= 60
      ? `Profit quality ${total.toFixed(0)} — momentum ${momentumQ.toFixed(0)}, data ${dataQ.toFixed(0)}, R:R ${rr.toFixed(2)}`
      : `Profit quality ${total.toFixed(0)} — marginal edge; waiting may be better`;
  const whyFail =
    c.breakoutScoreStatus === "NOT_COMPUTED"
      ? "Breakout NOT_COMPUTED — data incomplete"
      : similarLoss
        ? "Similar setup lost in V6 postmortem"
        : momentumQ < 40
          ? "Momentum weak"
          : spreadLiq < 50
            ? "Spread/liquidity concern"
            : "Regime or thesis may shift";

  return {
    total,
    expectedNetReward: expectedNet,
    rewardRisk,
    momentumQuality: momentumQ,
    breakoutQuality: breakoutQ,
    trendQuality: trendQ,
    dataQuality: dataQ,
    executionQuality: c.tradableOnConfiguredExchange ? 80 : 20,
    spreadLiquidity: spreadLiq,
    regimeAlignment: regime,
    lossPatternPenalty: lossPenalty,
    whyBetterThanWaiting: whyBetter,
    whyMayFail: whyFail,
    invalidationTriggers: [
      "Thesis invalidation",
      "Momentum fade below entry",
      "BTC/ETH regime turn",
      "Spread widening",
    ],
    similarV6Loss: similarLoss,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
