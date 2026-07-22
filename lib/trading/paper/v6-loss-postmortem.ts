import type { PaperTrade } from "@prisma/client";

export interface V6ClosedTradePostmortem {
  tradeId: string;
  symbol: string;
  entryTime: string | null;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number;
  netPnl: number;
  entryReason: string;
  setupLabel: string;
  strategyName: string;
  stopDistancePct: number | null;
  tpDistancePct: number | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  hitStop: boolean;
  exitTooLate: boolean;
  thesisInvalidatedBeforeStop: boolean;
  spreadSlippageHurt: boolean;
  enteredTooEarly: boolean;
  weakMomentumAtEntry: boolean;
  btcEthRegimeAgainst: boolean;
  shouldBlockInFuture: boolean;
  avoidable: boolean;
  lesson: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface V6LossLesson {
  commonPattern: string;
  ruleToAdd: string;
  thresholdToReview: string;
  prevention: string;
  lossCharacter: "NORMAL" | "AVOIDABLE";
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface V6LossPostmortemReport {
  recordNumber: number;
  recordName: string;
  totalPnl: number;
  openedTrades: number;
  closedTrades: number;
  winRate: number;
  profitFactor: number;
  closedTradeDetails: V6ClosedTradePostmortem[];
  lessons: V6LossLesson[];
  summaryVerdict: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function toNum(v: { toNumber?: () => number } | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toNumber === "function") return v.toNumber();
  return Number(v) || 0;
}

function parseSetupLabel(reason: string): string {
  if (/TINY B/i.test(reason)) return "Tiny B";
  if (/vwap/i.test(reason)) return "A — VWAP Reclaim";
  if (/breakout/i.test(reason)) return "A+ — Breakout";
  if (/pullback/i.test(reason)) return "A — Pullback";
  return "Unknown";
}

export function analyzeV6ClosedTrade(trade: PaperTrade): V6ClosedTradePostmortem {
  const entry = toNum(trade.entryPrice);
  const exit = toNum(trade.exitPrice);
  const sl = toNum(trade.plannedStopLoss);
  const tp = toNum(trade.plannedTakeProfit);
  const net = toNum(trade.netPaperPnl);
  const reason = trade.reason ?? "";
  const exitMatch = reason.match(/\|\s*closed:\s*([^|]+)/i);
  const exitReason = exitMatch?.[1]?.trim() ?? "";
  const hitStop = exitReason.includes("STOP") || trade.result === "LOSS";
  const spreadMatch = reason.match(/spread:\s*([\d.]+)/i);
  const entrySpread = spreadMatch ? parseFloat(spreadMatch[1]) : null;

  const stopDist = entry > 0 && sl ? Math.abs(((entry - sl) / entry) * 100) : null;
  const tpDist = entry > 0 && tp ? Math.abs(((tp - entry) / entry) * 100) : null;
  const weakMomentum = /score:\s*(\d+)/i.test(reason) && parseInt(reason.match(/score:\s*(\d+)/i)![1], 10) < 55;
  const enteredTooEarly = weakMomentum && net < 0;
  const avoidable = hitStop && (weakMomentum || enteredTooEarly || /TINY B/i.test(reason));

  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    entryTime: trade.openedAt?.toISOString() ?? null,
    exitTime: trade.closedAt?.toISOString() ?? null,
    entryPrice: entry,
    exitPrice: exit,
    netPnl: net,
    entryReason: reason.split("|")[0]?.trim() ?? reason,
    setupLabel: parseSetupLabel(reason),
    strategyName: trade.strategyName,
    stopDistancePct: stopDist,
    tpDistancePct: tpDist,
    maxFavorableExcursion: null,
    maxAdverseExcursion: net < 0 ? Math.abs(net) : null,
    hitStop,
    exitTooLate: hitStop && net < -(toNum(trade.riskAmount) * 0.8),
    thesisInvalidatedBeforeStop: false,
    spreadSlippageHurt: entrySpread != null && entrySpread > 30,
    enteredTooEarly,
    weakMomentumAtEntry: weakMomentum,
    btcEthRegimeAgainst: false,
    shouldBlockInFuture: avoidable,
    avoidable,
    lesson: avoidable
      ? `Avoid ${parseSetupLabel(reason)} on ${trade.symbol} with weak momentum — add entry quality gate`
      : "Loss within stop plan — review R:R not forced entry",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function buildV6LossLessons(trades: V6ClosedTradePostmortem[]): V6LossLesson[] {
  const losers = trades.filter((t) => t.netPnl < 0);
  const tinyBLosses = losers.filter((t) => t.setupLabel === "Tiny B").length;
  const weakMom = losers.filter((t) => t.weakMomentumAtEntry).length;
  const lessons: V6LossLesson[] = [];

  if (losers.length === 0) {
    return [{
      commonPattern: "No closed losses in sample",
      ruleToAdd: "Continue paper evidence",
      thresholdToReview: "N/A",
      prevention: "N/A",
      lossCharacter: "NORMAL",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    }];
  }

  if (weakMom >= losers.length * 0.5) {
    lessons.push({
      commonPattern: "negative momentum at entry",
      ruleToAdd: "Block entry when shortTermReturn negative without pullback confirm",
      thresholdToReview: "momentumScore >= 45 for Tiny B",
      prevention: "Require candle-confirmed momentum before Tiny B open",
      lossCharacter: "AVOIDABLE",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    });
  }
  if (tinyBLosses >= 2) {
    lessons.push({
      commonPattern: "Tiny B entries without full candle confirmation",
      ruleToAdd: "Tiny B requires confirmed tradable pair + real candles + strategy component",
      thresholdToReview: "Tiny B allocation cap",
      prevention: "Do not open Tiny B on fallback-only CoinGecko data",
      lossCharacter: "AVOIDABLE",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    });
  }
  lessons.push({
    commonPattern: `${losers.length} closed losses, 0% win rate`,
    ruleToAdd: "Raise profit quality score minimum before open",
    thresholdToReview: "opportunityScore and profit quality >= 55",
    prevention: "Exit early on thesis invalidation before full stop",
    lossCharacter: losers.every((t) => t.avoidable) ? "AVOIDABLE" : "NORMAL",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  });
  return lessons;
}

export function buildV6LossPostmortemReport(input: {
  recordNumber: number;
  recordName: string;
  totalPnl: number;
  trades: PaperTrade[];
}): V6LossPostmortemReport {
  const closed = input.trades.filter((t) => t.status === "CLOSED" || t.status === "EXPIRED");
  const details = closed.map(analyzeV6ClosedTrade);
  const wins = closed.filter((t) => t.result === "WIN").length;
  const losses = closed.filter((t) => t.result === "LOSS").length;
  const grossWin = closed.filter((t) => toNum(t.netPaperPnl) > 0).reduce((s, t) => s + toNum(t.netPaperPnl), 0);
  const grossLoss = Math.abs(
    closed.filter((t) => toNum(t.netPaperPnl) < 0).reduce((s, t) => s + toNum(t.netPaperPnl), 0),
  );
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0;

  return {
    recordNumber: input.recordNumber,
    recordName: input.recordName,
    totalPnl: input.totalPnl,
    openedTrades: input.trades.filter((t) => t.side !== "NO_TRADE").length,
    closedTrades: closed.length,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    profitFactor: pf ?? 0,
    closedTradeDetails: details,
    lessons: buildV6LossLessons(details),
    summaryVerdict:
      input.totalPnl < 0
        ? `V6 lost ${input.totalPnl.toFixed(4)} SIM with ${losses} losses — review entry quality and provider health before V8`
        : "V6 break-even or positive",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
