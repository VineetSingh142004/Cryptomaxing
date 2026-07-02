export const PROOF_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/proof/types";
export { assessEvidenceLevel, autoSizeBandForLevel, canPromoteOneStage } from "@/lib/trading/proof/evidence-level";
export { buildTodayMarketProof } from "@/lib/trading/proof/today-proof";
export { analyzeTodayAlphaBeta } from "@/lib/trading/proof/alpha-beta";
export type { TodayAlphaBetaInput, TodayAlphaBetaResult } from "@/lib/trading/proof/alpha-beta";
export { decideGoNoGo } from "@/lib/trading/proof/go-no-go";
export type { GoNoGoInput, GoNoGoResult } from "@/lib/trading/proof/go-no-go";
export { buildProfitabilityScorecard } from "@/lib/trading/proof/scorecard";
export type { ScorecardInput } from "@/lib/trading/proof/scorecard";
export { recordBlockedTrade, updateBlockOutcome, summarizeMoneyProtected } from "@/lib/trading/proof/money-protected";
export {
  persistEvidenceLevel,
  persistTodayMarketProof,
  persistGoNoGoDecision,
  persistScorecard,
  persistMoneyProtectedEvent,
  persistMoneyProtectedSummary,
} from "@/lib/trading/proof/store";
