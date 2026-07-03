export const PAPER_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/paper/types";
export {
  openPaperTrade,
  closePaperTrade,
  summarizePaperDay,
  PAPER_FORWARD_STATUS,
} from "@/lib/trading/paper/forward-tracker";
export { runPaperBrokerSession, PAPER_BROKER_STATUS } from "@/lib/trading/paper/broker";
export {
  runPaperEvidenceStep,
  getPaperStatus,
  getPaperTradesList,
  getPaperEvidenceReport,
  getPaperEvidenceStats,
  getLastRunScannerSummary,
  serializePaperTrade,
} from "@/lib/trading/paper/evidence-service";
export { evaluatePaperForwardEvidence, PAPER_EVIDENCE_REQUIREMENTS } from "@/lib/trading/paper/evidence-requirements";
export { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
export {
  buildPaperSymbolUniverse,
  buildTickerRows,
  fetchKrakenSpotPairs,
  clearUniverseCache,
} from "@/lib/trading/paper/kraken-universe";
export {
  buildScanCandidate,
  quickScoreFromTicker,
  rankCandidates,
  summarizeRejections,
} from "@/lib/trading/paper/opportunity-scanner";
export {
  evaluateControlledActiveStrategy,
  PAPER_TRADE_EXPIRY_HOURS,
} from "@/lib/trading/paper/controlled-active-strategy";
export {
  evaluateConservativePaperStrategy,
  PAPER_STRATEGY_SYMBOLS,
  CONSERVATIVE_PAPER_STRATEGY,
} from "@/lib/trading/paper/conservative-strategy";
export type { OpenPaperTradeInput, ClosePaperTradeInput } from "@/lib/trading/paper/forward-tracker";
export type { PaperBrokerInput, PaperBrokerSession } from "@/lib/trading/paper/broker";
