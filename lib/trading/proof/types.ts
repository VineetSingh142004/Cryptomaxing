/** Evidence levels 0–14 — numeric for ordering; string for storage */

export const EVIDENCE_LEVEL_NAMES = [
  "IDEA_ONLY",
  "FORMULA_DEFINED",
  "BACKTESTED",
  "VALIDATED",
  "OUT_OF_SAMPLE_PASSED",
  "WALK_FORWARD_PASSED",
  "MONTE_CARLO_PASSED",
  "ADVERSARIAL_PASSED",
  "PAPER_FORWARD_PASSED",
  "SHADOW_LIVE_PASSED",
  "TINY_LIVE_CANARY_PASSED",
  "LIVE_EXECUTION_VERIFIED",
  "LIVE_EXPECTANCY_VERIFIED",
  "REGIME_SURVIVAL_VERIFIED",
  "SCALABLE_LIVE_EDGE",
] as const;

export type EvidenceLevelName = (typeof EVIDENCE_LEVEL_NAMES)[number];
export type EvidenceLevelNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface EvidenceArtifact {
  dataSource: string;
  timeRange: { start: string; end: string } | null;
  assumptions: Record<string, unknown>;
  costs: Record<string, unknown>;
  sampleSize: number;
  recordedAt: string;
  mocked?: boolean;
}

export interface EvidenceAssessmentInput {
  entityType: "strategy" | "variant";
  entityId: string;
  /** Research gates — must come from real research runs, not mocked */
  formulaDefined?: boolean;
  backtestCompleted?: boolean;
  validated?: boolean;
  outOfSamplePassed?: boolean;
  walkForwardPassed?: boolean;
  monteCarloPassed?: boolean;
  adversarialPassed?: boolean;
  paperForwardPassed?: boolean;
  shadowLivePassed?: boolean;
  tinyLiveCanaryPassed?: boolean;
  liveExecutionVerified?: boolean;
  liveExpectancyVerified?: boolean;
  regimeSurvivalVerified?: boolean;
  scalableLiveEdge?: boolean;
  /** Demotion triggers */
  livePerformanceDecay?: boolean;
  edgeDecayDetected?: boolean;
  unreconciledPnL?: boolean;
  artifacts?: EvidenceArtifact[];
}

export interface EvidenceAssessmentResult {
  entityType: string;
  entityId: string;
  level: EvidenceLevelNumber;
  levelName: EvidenceLevelName;
  previousLevel: EvidenceLevelNumber | null;
  direction: "PROMOTED" | "DEMOTED" | "UNCHANGED" | "INITIAL";
  autoAllowed: boolean;
  autoMaxSizeBand: "NONE" | "TINY" | "SMALL" | "NORMAL_WITH_APPROVAL";
  manualAllowed: boolean;
  reasonCodes: string[];
  artifacts: EvidenceArtifact[];
  assessedAt: string;
}

export type TodayProofVerdict =
  | "NO_EDGE_TODAY"
  | "EDGE_FOUND_EXECUTION_FAILED"
  | "WEAK_EDGE"
  | "BETA_NOT_ALPHA"
  | "TODAY_EDGE_OBSERVED"
  | "NO_TRADES_PROTECTED_CAPITAL"
  | "IN_PROGRESS";

export interface TodayMarketProof {
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
  shadowTrades: number;
  paperTrades: number;
  missedOpportunities: number;
  fakeoutsAvoided: number;
  lossesAvoided: number;
  moneyProtected: number;
  grossTheoreticalPnl: number;
  realisticPaperNetPnl: number;
  shadowLiveNetPnlEstimate: number;
  realLiveNetPnl: number | null;
  fees: number;
  spreadCosts: number;
  slippageAssumptions: Record<string, number>;
  missedFills: number;
  partialFills: number;
  fundingCosts: number;
  stopSlippageEstimate: number;
  liquidityQualityScore: number;
  executionQualityScore: number;
  benchmarkComparison: Record<string, number | null>;
  randomBaselineComparison: Record<string, number | null>;
  verdict: TodayProofVerdict;
  reasonCodes: string[];
  generatedAt: string;
}

export type GoNoGoDecision =
  | "DISABLE_STRATEGY"
  | "RESEARCH_ONLY"
  | "CONTINUE_PAPER"
  | "CONTINUE_SHADOW"
  | "MANUAL_ONLY"
  | "TINY_CANARY_ELIGIBLE"
  | "STAY_TINY_CANARY"
  | "SCALE_DOWN"
  | "HOLD_CURRENT_STAGE"
  | "REVALIDATION_REQUIRED";

export type ScorecardStatus =
  | "NOT_TESTED"
  | "BAD_DATA"
  | "NO_EDGE"
  | "WEAK_EDGE"
  | "PAPER_EDGE_ONLY"
  | "SHADOW_EDGE_ONLY"
  | "TINY_LIVE_EDGE"
  | "LIVE_EDGE_UNDER_REVIEW"
  | "SCALABLE_LIVE_EDGE"
  | "DECAYING_EDGE"
  | "DISABLED";

export interface ProfitabilityScorecard {
  period: string;
  categories: {
    dataQualityScore: number;
    signalQualityScore: number;
    executionQualityScore: number;
    fillRealismScore: number;
    costSurvivalScore: number;
    alphaVsBetaScore: number;
    randomBaselineScore: number;
    drawdownControlScore: number;
    sampleSizeScore: number;
    liveReconciliationScore: number;
    edgeDecayScore: number;
    regimeSurvivalScore: number;
    profitAttributionScore: number;
  };
  overallScore: number;
  status: ScorecardStatus;
  reasonCodes: string[];
  generatedAt: string;
}

export interface BlockedTradeRecord {
  id: string;
  symbol: string;
  strategyId: string;
  blockReason: string;
  blockCategory: string;
  estimatedLossAvoided: number | null;
  signalTimestamp: string;
  laterOutcome: "LOST" | "WON" | "UNKNOWN" | null;
  outcomeCheckedAt: string | null;
}

export interface MoneyProtectedSummary {
  reportDate: string;
  blockedByRisk: number;
  blockedByDataQuality: number;
  blockedBySpread: number;
  blockedByLiquidity: number;
  blockedByFakeout: number;
  blockedByLateEntry: number;
  blockedByStrategyDecay: number;
  blockedByBadSession: number;
  blockedByMicrostructure: number;
  estimatedLossAvoided: number;
  correctBlocks: number;
  falsePositiveBlocks: number;
  missedWinnersDueToBlock: number;
  blockPrecision: number | null;
  blockRecall: number | null;
  records: BlockedTradeRecord[];
  generatedAt: string;
}
