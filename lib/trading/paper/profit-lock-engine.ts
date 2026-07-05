export type ProfitLockLabel =
  | "NONE"
  | "PROFIT_LOCK_ACTIVE"
  | "BREAKEVEN_PROTECTED"
  | "TRAILING_STOP_ACTIVE";

export interface ProfitLockState {
  peakUnrealizedPnl: number;
  currentUnrealizedPnl: number;
  tpProgressPct: number | null;
  peakTpProgressPct: number;
  givebackAmount: number;
  givebackPct: number | null;
  protectedProfit: number;
  breakevenProtected: boolean;
  profitLockLabel: ProfitLockLabel;
  trailingStopActive: boolean;
  shouldExitGiveback: boolean;
  shouldTightenStop: boolean;
  suggestedStopPrice: number | null;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface RecordProfitLockState {
  peakRecordUnrealizedPnl: number;
  currentRecordUnrealizedPnl: number;
  givebackAmount: number;
  givebackPct: number | null;
  recordProfitLockActive: boolean;
  shouldReduceExposure: boolean;
  summary: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function evaluateProfitLockState(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  plannedTakeProfit: number | null;
  currentUnrealizedPnl: number;
  peakUnrealizedPnl?: number;
  givebackExitPct?: number;
}): ProfitLockState {
  const peak = Math.max(input.peakUnrealizedPnl ?? input.currentUnrealizedPnl, input.currentUnrealizedPnl, 0);
  const giveback = peak > 0 ? peak - input.currentUnrealizedPnl : 0;
  const givebackPct = peak > 0 ? (giveback / peak) * 100 : null;
  const givebackExitThreshold = input.givebackExitPct ?? 40;

  let tpProgressPct: number | null = null;
  if (input.plannedTakeProfit !== null && input.entryPrice > 0) {
    const total =
      input.side === "LONG"
        ? input.plannedTakeProfit - input.entryPrice
        : input.entryPrice - input.plannedTakeProfit;
    const progress =
      input.side === "LONG"
        ? input.markPrice - input.entryPrice
        : input.entryPrice - input.markPrice;
    tpProgressPct = total !== 0 ? Math.max(0, Math.min(100, (progress / total) * 100)) : null;
  }

  const peakTp = tpProgressPct ?? 0;
  let label: ProfitLockLabel = "NONE";
  let trailing = false;
  let breakeven = false;
  let tighten = false;
  let suggestedStop: number | null = null;

  if (tpProgressPct !== null && tpProgressPct >= 85) {
    label = "TRAILING_STOP_ACTIVE";
    trailing = true;
    tighten = true;
    suggestedStop =
      input.side === "LONG"
        ? Math.max(input.entryPrice * 1.002, input.markPrice * 0.995)
        : Math.min(input.entryPrice * 0.998, input.markPrice * 1.005);
  } else if (tpProgressPct !== null && tpProgressPct >= 70) {
    label = "BREAKEVEN_PROTECTED";
    breakeven = true;
    tighten = true;
    suggestedStop = input.entryPrice;
  } else if (tpProgressPct !== null && tpProgressPct >= 50) {
    label = "PROFIT_LOCK_ACTIVE";
    tighten = true;
    suggestedStop =
      input.side === "LONG" ? input.entryPrice * 0.999 : input.entryPrice * 1.001;
  }

  const shouldExitGiveback =
    peak > 0 && givebackPct !== null && givebackPct >= givebackExitThreshold && peak > 1;

  const protectedProfit = Math.max(0, input.currentUnrealizedPnl);

  let summary = "No profit lock active";
  if (shouldExitGiveback) {
    summary = `Trade gave back ${givebackPct?.toFixed(0)}% of peak open profit — exit (TRADE_PROFIT_GIVEBACK_EXIT)`;
  } else if (label === "TRAILING_STOP_ACTIVE") {
    summary = "85%+ TP progress — trailing stop active; protect open profit";
  } else if (label === "BREAKEVEN_PROTECTED") {
    summary = "70%+ TP progress — stop at breakeven or better";
  } else if (label === "PROFIT_LOCK_ACTIVE") {
    summary = "50%+ TP progress — profit lock tightening stop";
  }

  return {
    peakUnrealizedPnl: peak,
    currentUnrealizedPnl: input.currentUnrealizedPnl,
    tpProgressPct,
    peakTpProgressPct: peakTp,
    givebackAmount: giveback,
    givebackPct,
    protectedProfit,
    breakevenProtected: breakeven,
    profitLockLabel: label,
    trailingStopActive: trailing,
    shouldExitGiveback,
    shouldTightenStop: tighten,
    suggestedStopPrice: suggestedStop,
    summary,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function evaluateRecordProfitLock(input: {
  openTradesUnrealized: number[];
  givebackExitPct?: number;
}): RecordProfitLockState {
  const current = input.openTradesUnrealized.reduce((s, n) => s + n, 0);
  const peak = Math.max(current, ...input.openTradesUnrealized, 0);
  const giveback = peak > 0 ? peak - current : 0;
  const givebackPct = peak > 0 ? (giveback / peak) * 100 : null;
  const threshold = input.givebackExitPct ?? 40;
  const active = peak > 5;
  const shouldReduce =
    active && givebackPct !== null && givebackPct >= threshold && current > 0;

  return {
    peakRecordUnrealizedPnl: peak,
    currentRecordUnrealizedPnl: current,
    givebackAmount: giveback,
    givebackPct,
    recordProfitLockActive: active,
    shouldReduceExposure: shouldReduce,
    summary: shouldReduce
      ? `Record open profit gave back ${givebackPct?.toFixed(0)}% — tighten or exit weakest (RECORD_PROFIT_GIVEBACK_EXIT)`
      : active
        ? "Record unrealized profit tracked — lock rules armed"
        : "No meaningful record open profit yet",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
