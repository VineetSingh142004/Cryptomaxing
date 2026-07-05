import type { PaperTrade as DbPaperTrade } from "@prisma/client";

export interface LossAnalysisEntry {
  tradeId: string;
  symbol: string;
  entryPrice: number | null;
  exitPrice: number | null;
  entryReason: string;
  exitReason: string | null;
  scoreAtEntry: number | null;
  allocationPct: number | null;
  stopLossDistancePct: number | null;
  takeProfitDistancePct: number | null;
  spreadAtEntry: string;
  volumeLiquidity: string;
  lossAmount: number | null;
  lossPct: number | null;
  averageLossTooLarge: boolean | null;
  exitTooLate: boolean | null;
  stopLossHit: boolean | null;
  momentumReversed: boolean | null;
  volumeWeakened: boolean | null;
  spreadWidened: boolean | null;
  fakePumpRisk: boolean | null;
  suggestedFix: string;
  netPnl: number | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface LossAnalysisPanel {
  losses: LossAnalysisEntry[];
  analyzedCount: number;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
  note: string;
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function parseScore(reason: string): number | null {
  const m = reason.match(/score[:\s]+([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseAlloc(reason: string): number | null {
  const m = reason.match(/alloc:\s*([\d.]+)%/i);
  return m ? parseFloat(m[1]) : null;
}

function parseSpread(reason: string): number | null {
  const m = reason.match(/spread:\s*([\d.]+)\s*bps/i);
  return m ? parseFloat(m[1]) : null;
}

function parseExitReason(reason: string): string | null {
  const closed = reason.match(/\|\s*closed:\s*([^|]+)/i);
  return closed ? closed[1].trim() : null;
}

function parseEntryReason(reason: string): string {
  return reason.split("|")[0]?.trim() ?? reason;
}

function distancePct(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.abs((to - from) / from) * 100;
}

function lossPctFromPrices(
  side: DbPaperTrade["side"],
  entry: number | null,
  exit: number | null,
): number | null {
  if (entry === null || exit === null || entry <= 0) return null;
  const dir = side === "SHORT" ? -1 : 1;
  return ((exit - entry) / entry) * 100 * dir;
}

function suggestFix(input: {
  entryReason: string;
  exitReason: string | null;
  scoreAtEntry: number | null;
  fakePumpRisk: boolean;
  momentumReversed: boolean | null;
  stopDist: number | null;
  averageLossTooLarge: boolean;
  exitTooLate: boolean;
  stopLossHit: boolean;
}): string {
  if (input.averageLossTooLarge) {
    return "Tighten risk sizing or widen stop-to-target ratio so average loss stays closer to average win.";
  }
  if (input.exitTooLate) {
    return "Exit earlier when thesis weakens — do not wait for expiry or full stop if momentum reverses.";
  }
  if (input.fakePumpRisk) {
    return "Tighten fake-pump filter — require higher volume before entry on extreme movers.";
  }
  if (input.momentumReversed) {
    return "Require stronger momentum confirmation or wait for pullback before entry.";
  }
  if (input.stopLossHit) {
    return input.stopDist !== null && input.stopDist < 0.5
      ? "Stop may be too tight for volatility tier — consider wider tier-based stop."
      : "Stop worked as designed — review entry score threshold if repeated.";
  }
  if ((input.scoreAtEntry ?? 0) < 65) {
    return "Raise minimum opportunity score for entries — loss entered on moderate score.";
  }
  return "Review spread/volume gates at entry — ensure liquidity supports the thesis.";
}

export function analyzeLosingTrades(
  trades: DbPaperTrade[],
  options?: {
    candidateScores?: Map<string, number>;
    averageWinningTrade?: number | null;
    averageLosingTrade?: number | null;
    limit?: number | null;
  },
): LossAnalysisPanel {
  const avgWin = options?.averageWinningTrade ?? null;
  const avgLoss = options?.averageLosingTrade ?? null;

  const losers = trades
    .filter((t) => t.result === "LOSS" && t.status !== "NO_TRADE")
    .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));

  const limited =
    options?.limit === null || options?.limit === undefined
      ? losers
      : losers.slice(0, options.limit);

  const losses: LossAnalysisEntry[] = limited.map((trade) => {
    const entry = toNumber(trade.entryPrice);
    const exit = toNumber(trade.exitPrice);
    const stop = toNumber(trade.plannedStopLoss);
    const tp = toNumber(trade.plannedTakeProfit);
    const net = toNumber(trade.netPaperPnl);
    const riskPct = toNumber(trade.riskPercent);

    const scoreAtEntry =
      parseScore(trade.reason) ?? options?.candidateScores?.get(trade.symbol) ?? null;
    const allocationPct = parseAlloc(trade.reason) ?? (riskPct !== null ? riskPct : null);
    const spreadBps = parseSpread(trade.reason);
    const exitReason = parseExitReason(trade.reason);
    const entryReason = parseEntryReason(trade.reason);
    const exitUpper = exitReason?.toUpperCase() ?? "";

    const stopLossDistancePct =
      entry !== null && stop !== null ? distancePct(entry, stop) : null;
    const takeProfitDistancePct =
      entry !== null && tp !== null ? distancePct(entry, tp) : null;
    const lossPct = lossPctFromPrices(trade.side, entry, exit);
    const lossAmount = net !== null && net < 0 ? Math.abs(net) : net;

    const stopLossHit = exitUpper.includes("STOP_LOSS") ? true : exitReason ? false : null;
    const momentumReversed =
      exitUpper.includes("MOMENTUM") || exitUpper.includes("THESIS") ? true : exitReason ? false : null;
    const volumeWeakened = exitUpper.includes("VOLUME") ? true : exitReason ? false : null;
    const spreadWidened: boolean | null = null;

    const fakePumpRisk =
      /EXTREME_RISK|pump|PUMP/i.test(trade.reason) ||
      (scoreAtEntry !== null && scoreAtEntry >= 80 && /HIGH_VOLATILITY/i.test(trade.reason));

    const averageLossTooLarge =
      avgWin !== null && avgLoss !== null && avgLoss > 0
        ? Math.abs(net ?? 0) > avgWin * 1.5 || avgLoss > avgWin * 1.5
        : null;

    let exitTooLate: boolean | null = null;
    if (exitReason) {
      exitTooLate =
        exitUpper.includes("EXPIRY") ||
        exitUpper.includes("THESIS") ||
        (trade.openedAt &&
          trade.closedAt &&
          (trade.closedAt.getTime() - trade.openedAt.getTime()) / 3_600_000 > 12 &&
          !exitUpper.includes("STOP_LOSS"));
    }

    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      entryPrice: entry,
      exitPrice: exit,
      entryReason,
      exitReason,
      scoreAtEntry,
      allocationPct,
      stopLossDistancePct,
      takeProfitDistancePct,
      spreadAtEntry: spreadBps !== null ? `${spreadBps.toFixed(1)} bps` : "UNKNOWN",
      volumeLiquidity: /volume|liquidity|spread/i.test(entryReason)
        ? entryReason
        : "UNKNOWN — not stored on trade record",
      lossAmount,
      lossPct,
      averageLossTooLarge,
      exitTooLate,
      stopLossHit,
      momentumReversed,
      volumeWeakened,
      spreadWidened,
      fakePumpRisk: fakePumpRisk || null,
      suggestedFix: suggestFix({
        entryReason,
        exitReason,
        scoreAtEntry,
        fakePumpRisk: Boolean(fakePumpRisk),
        momentumReversed,
        stopDist: stopLossDistancePct,
        averageLossTooLarge: Boolean(averageLossTooLarge),
        exitTooLate: Boolean(exitTooLate),
        stopLossHit: Boolean(stopLossHit),
      }),
      netPnl: net,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  });

  return {
    losses,
    analyzedCount: losses.length,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
    note: "Loss diagnosis uses stored paper trade records — simulated only, not live P&L.",
  };
}

export interface TradeLossAuditReport {
  symbol: string;
  entryTime: string | null;
  exitTime: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  quantity: number | null;
  allocationPct: number | null;
  riskTier: string | null;
  entryScore: number | null;
  confidence: number | null;
  rewardRiskRatio: number | null;
  stopLossDistancePct: number | null;
  takeProfitDistancePct: number | null;
  spreadBps: number | null;
  volumeLiquidityNote: string;
  thesisStatusAtEntry: string;
  whyAllowed: string;
  ruleAllowed: string;
  lossBreakdown: {
    grossPnl: number | null;
    fees: number | null;
    slippage: number | null;
    netPnl: number | null;
  };
  riskSizingTooLarge: boolean;
  stopLossTooWide: boolean;
  thesisShouldHaveExitedEarlier: boolean;
  shouldHaveBeenRejectedByLossShield: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function parseRiskTier(reason: string): string | null {
  const m = reason.match(/\b(MAJOR|ALT_LIQUID|HIGH_VOLATILITY|EXTREME_RISK)\b/);
  return m?.[1] ?? null;
}

function parseRewardRisk(reason: string): number | null {
  const m = reason.match(/R:R\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

/** Structured audit for a single closed losing paper trade. */
export function buildTradeLossAuditReport(trade: DbPaperTrade): TradeLossAuditReport {
  const entry = toNumber(trade.entryPrice);
  const exit = toNumber(trade.exitPrice);
  const stop = toNumber(trade.plannedStopLoss);
  const tp = toNumber(trade.plannedTakeProfit);
  const size = toNumber(trade.simulatedSize);
  const scoreAtEntry = parseScore(trade.reason);
  const allocationPct = parseAlloc(trade.reason);
  const spreadBps = parseSpread(trade.reason);
  const rr = parseRewardRisk(trade.reason);
  const riskTier = parseRiskTier(trade.reason);
  const stopLossDistancePct = entry !== null && stop !== null ? distancePct(entry, stop) : null;
  const takeProfitDistancePct = entry !== null && tp !== null ? distancePct(entry, tp) : null;
  const gross = toNumber(trade.grossPaperPnl);
  const fees = toNumber(trade.estimatedFees);
  const slippage = toNumber(trade.estimatedSlippage);
  const net = toNumber(trade.netPaperPnl);
  const riskAmt = toNumber(trade.riskAmount);
  const riskSizingTooLarge =
    riskAmt !== null && net !== null && Math.abs(net) > riskAmt * 1.5;
  const stopLossTooWide =
    stopLossDistancePct !== null && stopLossDistancePct > 2.5 && (riskTier === "MAJOR" || !riskTier);
  const shouldHaveBeenRejectedByLossShield =
    (scoreAtEntry !== null && scoreAtEntry < 65) ||
    (allocationPct !== null && allocationPct > 15) ||
    Boolean(riskSizingTooLarge);
  const exitReason = parseExitReason(trade.reason);
  const thesisShouldHaveExitedEarlier =
    exitReason?.includes("STOP_LOSS") === true &&
    stopLossDistancePct !== null &&
    stopLossDistancePct < 1.2;

  return {
    symbol: trade.symbol,
    entryTime: trade.openedAt?.toISOString() ?? null,
    exitTime: trade.closedAt?.toISOString() ?? null,
    entryPrice: entry,
    exitPrice: exit,
    quantity: size,
    allocationPct,
    riskTier,
    entryScore: scoreAtEntry,
    confidence: toNumber(trade.confidence),
    rewardRiskRatio: rr,
    stopLossDistancePct,
    takeProfitDistancePct,
    spreadBps,
    volumeLiquidityNote: "See scanner candidate volume/liquidity scores at entry run",
    thesisStatusAtEntry: parseEntryReason(trade.reason),
    whyAllowed: parseEntryReason(trade.reason),
    ruleAllowed: trade.reason.includes("TRADE_READY") ? "TRADE_READY / evaluateTradeSelection" : "controlled-active-paper-v1",
    lossBreakdown: { grossPnl: gross, fees, slippage, netPnl: net },
    riskSizingTooLarge,
    stopLossTooWide,
    thesisShouldHaveExitedEarlier,
    shouldHaveBeenRejectedByLossShield,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
