export type AutoUnlockDecision =
  | "BLOCK"
  | "WATCH"
  | "WAIT"
  | "MANUAL_ONLY"
  | "PAPER_ONLY"
  | "TINY_CANARY_ONLY"
  | "REVALIDATION_REQUIRED";

export interface AutoUnlockGate {
  id: string;
  label: string;
  passed: boolean;
  required: boolean;
}

export interface AutoUnlockInput {
  emergencyPaused: boolean;
  paperRealistic: boolean;
  manualWorking: boolean;
  apiSecure: boolean;
  noWithdrawalPermission: boolean;
  exactStrategyApproved: boolean;
  parametersApproved: boolean;
  dataQualityPasses: boolean;
  alphaResearchSupportsEdge: boolean;
  todayMarketProofAvailable: boolean;
  todayAlphaBetaPasses: boolean;
  todayExecutionRealismPasses: boolean;
  todayCostSurvivalPasses: boolean;
  todayFillRealismPasses: boolean;
  todayGoNoGoAllows: boolean;
  scorecardAllowsStage: boolean;
  moneyProtectedEngineActive: boolean;
  sameDayRealityCheckVisible: boolean;
  benchmarkAlphaPasses: boolean;
  monteCarloSurvivalPasses: boolean;
  adversarialSurvivalPasses: boolean;
  microstructureConflictClear: boolean;
  backtestPasses: boolean;
  validationPasses: boolean;
  outOfSamplePasses: boolean;
  walkForwardPasses: boolean;
  stressTestPasses: boolean;
  paperForwardPasses: boolean;
  shadowLivePasses: boolean;
  tinyLiveCanaryPasses: boolean;
  liveExecutionAuditPasses: boolean;
  liveSlippageAuditPasses: boolean;
  liveFeeFundingAuditPasses: boolean;
  liveReconciliationPasses: boolean;
  liveSampleSizePasses: boolean;
  evidenceLevelAllowsSize: boolean;
  strategyNotDegraded: boolean;
  edgeDecayClear: boolean;
  liveDriftClear: boolean;
  sessionEdgePositiveOrAPlus: boolean;
  riskOfRuinAcceptable: boolean;
  profitAttributionSupportsEdge: boolean;
  profitDensityAcceptable: boolean;
  executionQualityAcceptable: boolean;
  venueQualityAcceptable: boolean;
  exchangeHealthAcceptable: boolean;
  opportunityCostAcceptable: boolean;
  stopExecutable: boolean;
  exitReady: boolean;
  killSwitchClear: boolean;
  dailyWeeklyLossAvailable: boolean;
  userApprovedAutoStage: boolean;
  executionEngineWired: boolean;
  authConfigured?: boolean;
  authReady?: boolean;
  encryptionProductionSafe?: boolean;
  oneBigLiveWin?: boolean;
  backtestProfitOnly?: boolean;
  unreconciledPnl?: boolean;
  weakTodayProof?: boolean;
  luckyTradeDependence?: boolean;
  lowProfitDensity?: boolean;
  evidenceLevel: number;
}

export interface AutoUnlockResult {
  decision: AutoUnlockDecision;
  autoExecutionEnabled: boolean;
  gatesPassed: AutoUnlockGate[];
  gatesFailed: AutoUnlockGate[];
  failedGates: AutoUnlockGate[];
  failedGateIds: string[];
  failedGateCount: number;
  nextGateToFix: string | null;
  safestNextAction: string;
  reasonCodes: string[];
  scalingAllowed: boolean;
  maxMode: AutoUnlockDecision;
  evaluatedAt: string;
}
