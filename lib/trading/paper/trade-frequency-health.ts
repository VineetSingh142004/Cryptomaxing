export interface TradeFrequencyHealthInput {
  runsCompleted: number;
  candidatesScanned: number;
  candidatesEvaluated: number;
  tradesOpened: number;
  tradesClosed: number;
  rejections: number;
  noTradeRuns: number;
  averageHoldingHours: number | null;
  openSlotsUsed: number;
  maxOpenSlots: number;
}

export interface TradeFrequencyHealth {
  candidatesPerOpenedTrade: number | null;
  rejectionRatePct: number | null;
  noTradeRatePct: number | null;
  openSlotUsagePct: number | null;
  tooStrict: boolean;
  overtrading: boolean;
  recommendation: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateTradeFrequencyHealth(
  input: TradeFrequencyHealthInput,
): TradeFrequencyHealth {
  const cpo =
    input.tradesOpened > 0 ? input.candidatesScanned / input.tradesOpened : null;
  const rejectionRate =
    input.candidatesScanned > 0 ? (input.rejections / input.candidatesScanned) * 100 : null;
  const noTradeRate =
    input.runsCompleted > 0 ? (input.noTradeRuns / input.runsCompleted) * 100 : null;
  const slotUsage =
    input.maxOpenSlots > 0 ? (input.openSlotsUsed / input.maxOpenSlots) * 100 : null;

  const tooStrict =
    input.candidatesScanned >= 500 &&
    input.tradesOpened <= 2 &&
    input.runsCompleted >= 10 &&
    (cpo === null || cpo > 800);

  const overtrading =
    input.tradesOpened >= 8 &&
    input.runsCompleted > 0 &&
    input.tradesOpened / input.runsCompleted > 0.35;

  let recommendation = "Trade frequency within blueprint range — quality over quantity.";
  if (tooStrict) {
    recommendation =
      "Bot may be too strict. Review thresholds or allow tiny B setups in paper mode.";
  } else if (overtrading) {
    recommendation = "Bot may be overtrading. Tighten filters.";
  } else if (input.tradesOpened === 0 && input.runsCompleted >= 5) {
    recommendation =
      "No trades opened yet — verify blockers in why-no-trade report; do not force entries.";
  }

  return {
    candidatesPerOpenedTrade: cpo,
    rejectionRatePct: rejectionRate,
    noTradeRatePct: noTradeRate,
    openSlotUsagePct: slotUsage,
    tooStrict,
    overtrading,
    recommendation,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
