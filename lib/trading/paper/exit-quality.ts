export type ExitRecommendation =
  | "HOLD"
  | "TIGHTEN_STOP"
  | "EXIT_EARLY"
  | "STOP_HIT"
  | "TAKE_PROFIT_HIT"
  | "PROFIT_LOCK_EXIT"
  | "TIME_STOP_EXIT"
  | "THESIS_INVALIDATED_EXIT";

export interface ExitQualityEvaluation {
  recommendation: ExitRecommendation;
  reasons: string[];
  thesisInvalidated: boolean;
  momentumFading: boolean;
  spreadWidening: boolean;
  regimeAgainst: boolean;
  failedToProgress: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateExitQuality(input: {
  side: string;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  peakUnrealizedPnl?: number;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  runsHeld: number;
  thesisStatus?: string;
  thesisRecommendation?: string;
  spreadBps?: number | null;
  entrySpreadBps?: number | null;
  btcShortReturnPct?: number | null;
  ethShortReturnPct?: number | null;
  closeReason?: string;
}): ExitQualityEvaluation {
  const reasons: string[] = [];
  const isLong = input.side !== "SHORT";

  if (input.closeReason === "STOP_LOSS_HIT") {
    return { recommendation: "STOP_HIT", reasons: ["Stop-loss hit"], thesisInvalidated: false, momentumFading: false, spreadWidening: false, regimeAgainst: false, failedToProgress: false, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (input.closeReason === "TAKE_PROFIT_HIT") {
    return { recommendation: "TAKE_PROFIT_HIT", reasons: ["Take-profit hit"], thesisInvalidated: false, momentumFading: false, spreadWidening: false, regimeAgainst: false, failedToProgress: false, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (input.closeReason === "EXPIRY_EXIT") {
    return { recommendation: "TIME_STOP_EXIT", reasons: ["Trade expired"], thesisInvalidated: false, momentumFading: false, spreadWidening: false, regimeAgainst: false, failedToProgress: true, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }

  const thesisInvalidated =
    input.thesisStatus === "INVALIDATED" ||
    input.thesisRecommendation === "EXIT" ||
    input.thesisRecommendation === "EXIT_EARLY";
  const momentumFading = isLong && input.markPrice < input.entryPrice && input.unrealizedPnl < 0;
  const spreadWidening =
    input.spreadBps != null &&
    input.entrySpreadBps != null &&
    input.spreadBps > input.entrySpreadBps * 1.5;
  const regimeAgainst =
    isLong &&
    (input.btcShortReturnPct ?? 0) < -0.5 &&
    (input.ethShortReturnPct ?? 0) < -0.5;
  const giveback =
    input.peakUnrealizedPnl != null &&
    input.peakUnrealizedPnl > 0 &&
    input.unrealizedPnl < input.peakUnrealizedPnl * 0.5;
  const failedToProgress = input.runsHeld >= 5 && input.unrealizedPnl <= 0;

  if (thesisInvalidated && input.unrealizedPnl < 0 && Math.abs(input.unrealizedPnl) < Math.abs(input.entryPrice * 0.02)) {
    reasons.push("Thesis invalidated with small loss — exit early");
    return { recommendation: "THESIS_INVALIDATED_EXIT", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (giveback && input.unrealizedPnl > 0) {
    reasons.push("Profit giveback from peak — profit lock exit");
    return { recommendation: "PROFIT_LOCK_EXIT", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (regimeAgainst && input.unrealizedPnl < 0) {
    reasons.push("BTC/ETH regime turned against alt long");
    return { recommendation: "EXIT_EARLY", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (spreadWidening) {
    reasons.push("Spread widened sharply");
    return { recommendation: "EXIT_EARLY", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (failedToProgress) {
    reasons.push(`No progress after ${input.runsHeld} runs`);
    return { recommendation: "EXIT_EARLY", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }
  if (momentumFading && thesisInvalidated) {
    reasons.push("Momentum fading with thesis weakening");
    return { recommendation: "TIGHTEN_STOP", reasons, thesisInvalidated, momentumFading, spreadWidening, regimeAgainst, failedToProgress, simulatedLabel: "SIMULATED_PAPER_ONLY" };
  }

  return {
    recommendation: "HOLD",
    reasons: ["Thesis intact — hold simulated position"],
    thesisInvalidated: false,
    momentumFading,
    spreadWidening,
    regimeAgainst,
    failedToProgress,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
