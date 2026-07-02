import type { PaperDailySummary } from "@/lib/trading/paper/types";
import type { ShadowTradeRecord } from "@/lib/trading/shadow/types";
import type { TodayMarketProof, TodayProofVerdict } from "@/lib/trading/proof/types";
import type { MoneyProtectedSummary } from "@/lib/trading/proof/types";
import type { TodayAlphaBetaResult } from "@/lib/trading/proof/alpha-beta";

export interface TodayProofInput {
  reportDate: string;
  scannedAssets: string[];
  approvedAssets: string[];
  blockedAssets: string[];
  marketRegime: string;
  bestSessions: string[];
  worstSessions: string[];
  aPlusSetupsFound: number;
  bcSetupsRejected: number;
  noTradeDecisions: number;
  tradeCandidates: number;
  shadowTrades: ShadowTradeRecord[];
  paperSummary: PaperDailySummary | null;
  moneyProtected: MoneyProtectedSummary;
  alphaBeta: TodayAlphaBetaResult | null;
  liveModeEnabled?: boolean;
  realLiveNetPnl?: number | null;
  liquidityQualityScore?: number;
  executionQualityScore?: number;
}

export function buildTodayMarketProof(input: TodayProofInput): TodayMarketProof {
  const closedShadow = input.shadowTrades.filter((s) => s.status === "CLOSED");
  const shadowNet = closedShadow.reduce((s, t) => s + (t.netPnlEstimate ?? 0), 0);
  const grossTheoretical = closedShadow.reduce((s, t) => s + (t.grossPnl ?? 0), 0);

  const paper = input.paperSummary;
  const reasonCodes: string[] = [];

  let verdict: TodayProofVerdict = "IN_PROGRESS";

  const hasCandidates = input.tradeCandidates > 0 || closedShadow.length > 0 || (paper?.tradeCount ?? 0) > 0;

  if (!hasCandidates && input.noTradeDecisions > 0) {
    verdict = input.moneyProtected.estimatedLossAvoided > 0 ? "NO_TRADES_PROTECTED_CAPITAL" : "NO_EDGE_TODAY";
    reasonCodes.push("NO_VALID_TRADES_TODAY");
  }

  if (input.alphaBeta?.flags.includes("BETA_NOT_ALPHA")) {
    verdict = "BETA_NOT_ALPHA";
    reasonCodes.push("BETA_NOT_ALPHA");
  } else if (input.alphaBeta?.flags.includes("COST_KILLED")) {
    verdict = "WEAK_EDGE";
    reasonCodes.push("COST_KILLED");
  } else if (input.alphaBeta?.flags.includes("NO_SIGNAL_EDGE")) {
    verdict = "NO_EDGE_TODAY";
    reasonCodes.push("NO_SIGNAL_EDGE");
  }

  if (paper && paper.netPnl > 0 && paper.missedFills > 0 && paper.missedFills >= paper.tradeCount) {
    verdict = "WEAK_EDGE";
    reasonCodes.push("MISSED_FILLS_WOULD_ERASE_EDGE");
  }

  const execScore = input.executionQualityScore ?? 50;
  if (hasCandidates && execScore < 45 && (paper?.netPnl ?? 0) <= 0) {
    verdict = "EDGE_FOUND_EXECUTION_FAILED";
    reasonCodes.push("EXECUTION_QUALITY_POOR");
  }

  if (
    input.alphaBeta?.flags.includes("TODAY_EDGE_OBSERVED") &&
    (paper?.netPnl ?? 0) > 0 &&
    verdict !== "BETA_NOT_ALPHA"
  ) {
    verdict = "TODAY_EDGE_OBSERVED";
    reasonCodes.push("TODAY_EDGE_OBSERVED_NOT_PROOF");
  }

  return {
    reportDate: input.reportDate,
    scannedAssets: input.scannedAssets,
    approvedAssets: input.approvedAssets,
    blockedAssets: input.blockedAssets,
    marketRegime: input.marketRegime,
    bestSessions: input.bestSessions,
    worstSessions: input.worstSessions,
    aPlusSetupsFound: input.aPlusSetupsFound,
    bcSetupsRejected: input.bcSetupsRejected,
    noTradeDecisions: input.noTradeDecisions,
    tradeCandidates: input.tradeCandidates,
    shadowTrades: input.shadowTrades.length,
    paperTrades: paper?.tradeCount ?? 0,
    missedOpportunities: input.bcSetupsRejected,
    fakeoutsAvoided: input.moneyProtected.blockedByFakeout,
    lossesAvoided: input.moneyProtected.correctBlocks,
    moneyProtected: input.moneyProtected.estimatedLossAvoided,
    grossTheoreticalPnl: grossTheoretical,
    realisticPaperNetPnl: paper?.netPnl ?? 0,
    shadowLiveNetPnlEstimate: shadowNet,
    realLiveNetPnl: input.liveModeEnabled ? (input.realLiveNetPnl ?? null) : null,
    fees: paper?.feesPaid ?? 0,
    spreadCosts: paper?.spreadCost ?? 0,
    slippageAssumptions: {
      entryBps: 5,
      exitBps: 5,
      stopBps: 12,
    },
    missedFills: paper?.missedFills ?? 0,
    partialFills: input.shadowTrades.filter((s) => s.reasonCodes.includes("PARTIAL_FILL")).length,
    fundingCosts: paper?.fundingPaid ?? 0,
    stopSlippageEstimate: 12,
    liquidityQualityScore: input.liquidityQualityScore ?? 50,
    executionQualityScore: execScore,
    benchmarkComparison: input.alphaBeta?.benchmarkReturns ?? {},
    randomBaselineComparison: input.alphaBeta?.randomBaseline ?? {},
    verdict,
    reasonCodes,
    generatedAt: new Date().toISOString(),
  };
}
