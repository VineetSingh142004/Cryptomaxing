/** Live trade record — must come from verified fills/reconciliation, never fabricated */

export interface LiveTradeRecord {
  id: string;
  strategyId: string;
  symbol: string;
  venue: string;
  direction: "long" | "short";
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  grossPnl: number;
  fees: number;
  spreadCost: number;
  slippage: number;
  funding: number;
  stopSlippage?: number;
  emergencyExitSlippage?: number;
  missedFill?: boolean;
  partialFill?: boolean;
  rejected?: boolean;
  entryQualityScore?: number;
  exitQualityScore?: number;
  fillProbability?: number;
  regime?: string;
  session?: string;
  benchmarkReturnPct?: number;
  leverage?: number;
  reconciled?: boolean;
}

export type CanaryStage =
  | "NO_LIVE"
  | "TINY_CANARY"
  | "MICRO_LIVE"
  | "SMALL_LIVE"
  | "CONTROLLED_LIVE"
  | "NORMAL_AUTO";

export type DecaySeverity = "NONE" | "MILD" | "MODERATE" | "SEVERE";

export interface LiveProfitabilityAuditResult {
  strategyId: string;
  period: string;
  grossPnl: number;
  netPnl: number;
  realizedFees: number;
  realizedSpreadCost: number;
  realizedSlippage: number;
  realizedFunding: number;
  missedFills: number;
  partialFills: number;
  rejectedOrders: number;
  stopSlippageTotal: number;
  emergencyExitSlippageTotal: number;
  averageEntryQuality: number | null;
  averageExitQuality: number | null;
  fillProbability: number | null;
  averageHoldTimeHours: number | null;
  averageTimeToTargetHours: number | null;
  maxDrawdown: number;
  consecutiveLosses: number;
  liveExpectancy: number | null;
  liveProfitFactor: number | null;
  liveWinRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  largestLoss: number;
  bestTradeContribution: number | null;
  worstTradeContribution: number | null;
  luckyTradeDominance: number | null;
  tradeCount: number;
  decision: "APPROVE" | "DEMOTE" | "DISABLE_AUTO" | "REDUCE" | "INSUFFICIENT_DATA";
  reasonCodes: string[];
  auditedAt: string;
}

export interface SampleConfidenceResult {
  strategyId: string;
  liveTradeCount: number;
  winningTradeCount: number;
  losingTradeCount: number;
  confidenceIntervalExpectancy: { lower: number; upper: number } | null;
  probabilityExpectancyPositive: number | null;
  probabilityProfitFactorAboveThreshold: number | null;
  probabilityStrategyIsRandom: number | null;
  largestTradeDependency: number | null;
  liveSampleReliabilityScore: number;
  regimeCoverageScore: number;
  sessionCoverageScore: number;
  assetCoverageScore: number;
  maxAllowedStage: CanaryStage;
  scalingAllowed: boolean;
  reasonCodes: string[];
  auditedAt: string;
}

export interface CanaryScalingInput {
  strategyId: string;
  currentStage: CanaryStage;
  requestedStage: CanaryStage;
  audit: LiveProfitabilityAuditResult;
  sample: SampleConfidenceResult;
  userApproved?: boolean;
  oneBigWinDetected?: boolean;
  luckyStreakWithoutSample?: boolean;
  liveSlippageWorseThanModel?: boolean;
  stopExecutionUnreliable?: boolean;
  exchangeReliabilityPoor?: boolean;
  profitableBeforeFeesOnly?: boolean;
}

export interface CanaryScalingResult {
  strategyId: string;
  fromStage: CanaryStage;
  toStage: CanaryStage;
  direction: "SCALE_UP" | "SCALE_DOWN" | "HOLD" | "BLOCKED";
  accountRiskBandPct: { min: number; max: number } | null;
  reasonCodes: string[];
  requiresUserApproval: boolean;
  decidedAt: string;
}

export interface ReconciliationInput {
  exchangeBalance: number;
  internalLedgerBalance: number;
  openOrders: { id: string; status: string }[];
  openPositions: { symbol: string; size: number; status: string }[];
  fills: { id: string; fee: number | null; price: number; size: number }[];
  realizedPnl: number;
  unrealizedPnl: number | null;
  fundingTotal: number | null;
  deposits: number;
  withdrawalsBlocked: boolean;
  leveraged: boolean;
  fillDataComplete: boolean;
  feeDataComplete: boolean;
  fundingDataComplete: boolean;
  afterRestart?: boolean;
}

export interface ReconciliationResult {
  status: "RECONCILED" | "MISMATCH" | "UNCERTAIN" | "INCOMPLETE";
  balanceMatch: boolean;
  discrepancy: number;
  mismatches: string[];
  blockNewTrades: boolean;
  blockPnlApproval: boolean;
  blockProofUpgrade: boolean;
  autoLocked: boolean;
  reasonCodes: string[];
  reconciledAt: string;
}

export interface DecayAnalysisResult {
  strategyId: string;
  severity: DecaySeverity;
  windows: Record<string, { expectancy: number | null; profitFactor: number | null; tradeCount: number }>;
  signals: string[];
  action: "NONE" | "REDUCE_RISK" | "DEMOTE" | "DISABLE_AUTO" | "RETURN_TO_PAPER";
  reasonCodes: string[];
  analyzedAt: string;
}

export interface ProfitAttributionResult {
  period: string;
  strategyId: string;
  netProfit: number;
  byStrategy: Record<string, number>;
  byAsset: Record<string, number>;
  byVenue: Record<string, number>;
  bySession: Record<string, number>;
  byRegime: Record<string, number>;
  byComponent: {
    entryTiming: number;
    exitTiming: number;
    leverage: number;
    executionQuality: number;
    spreadCost: number;
    slippageCost: number;
    fundingCost: number;
    marketDirection: number;
    benchmarkMovement: number;
    luckConcentration: number;
  };
  betaShare: number;
  leverageShare: number;
  oneTradeShare: number;
  unexplainedShare: number;
  entryBeatsRandom: boolean;
  exitReducesExpectancy: boolean;
  scalingAllowed: boolean;
  reasonCodes: string[];
  generatedAt: string;
}
