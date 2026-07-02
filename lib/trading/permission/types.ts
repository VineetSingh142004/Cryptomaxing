/** Trade permission decisions — nothing bypasses the permission engine */

export const TRADE_PERMISSION_OUTCOMES = [
  "ALLOW",
  "MANUAL_ONLY",
  "WATCH_ONLY",
  "WAIT",
  "BLOCK",
  "NO_EDGE",
  "ACCOUNT_TOO_SMALL",
  "FEES_TOO_HIGH",
  "LIQUIDITY_TOO_LOW",
  "SPREAD_TOO_WIDE",
  "STOP_NOT_SAFE",
  "REGIME_MISMATCH",
  "STRATEGY_DEGRADED",
  "EDGE_DECAY_DETECTED",
  "API_UNHEALTHY",
  "DATA_STALE",
  "PROOF_REQUIRED",
  "AUTO_LOCKED",
  "LEVERAGE_TOO_DANGEROUS",
  "EXPECTED_EDGE_TOO_SMALL",
  "LATE_ENTRY",
  "FAKEOUT_RISK_TOO_HIGH",
  "FUNDING_TOO_HIGH",
  "SESSION_EDGE_NEGATIVE",
  "LIVE_DRIFT_DETECTED",
  "OPPORTUNITY_COST_TOO_HIGH",
  "RISK_OF_RUIN_TOO_HIGH",
  "EXECUTION_QUALITY_TOO_LOW",
  "BENCHMARK_ALPHA_FAILED",
  "MONTE_CARLO_FAILED",
  "ADVERSARIAL_TEST_FAILED",
  "PROFIT_DENSITY_TOO_LOW",
  "VENUE_QUALITY_TOO_LOW",
  "MICROSTRUCTURE_CONFLICT",
  "TODAY_PROOF_WEAK",
  "BETA_NOT_ALPHA",
  "COST_KILLED",
  "UNRECONCILED_PNL",
] as const;

export type TradePermissionOutcome = (typeof TRADE_PERMISSION_OUTCOMES)[number];

export type PermissionMode = "PAPER" | "MANUAL" | "AUTO";

export interface TradePermissionInput {
  mode: PermissionMode;
  /** From analyzeOpportunity / profit router */
  routerHardRejects: string[];
  routerPermission: "ALLOW" | "BLOCK" | "WAIT";
  profitMaximizationScore: number;
  /** Scanning */
  fakeoutRiskScore: number;
  lateEntryRiskScore: number;
  explosiveScore: number;
  /** Execution / data */
  executionQualityScore: number;
  spreadBps: number;
  liquidityUsd: number;
  venueQualityScore: number;
  dataTradable: boolean;
  dataStale: boolean;
  apiHealthy: boolean;
  /** Risk / stops */
  stopValid: boolean;
  leverageRecommended: number;
  riskOfRuinBlocked: boolean;
  fundingBpsPer8h?: number;
  /** Proof / research */
  evidenceLevel: number;
  proofGateApproved: boolean;
  benchmarkAlphaPassed?: boolean;
  monteCarloBlocked?: boolean;
  adversarialPassed?: boolean;
  reconciliationPassed?: boolean;
  /** Regime / session */
  sessionEdgeBlock?: boolean;
  regimeMismatch?: boolean;
  liveDriftDetected?: boolean;
  edgeDecayDetected?: boolean;
  strategyDegraded?: boolean;
  /** Economics */
  accountEquity: number;
  expectedEdgeAfterCosts: number;
  profitDensityScore: number;
  opportunityCostPenalty?: number;
  /** Microstructure */
  microstructureDecision: "SUPPORT" | "NEUTRAL" | "CONTRADICT" | "BLOCK";
  /** Today proof */
  todayProofWeak?: boolean;
  betaNotAlpha?: boolean;
  costKilled?: boolean;
  /** Small account / meme */
  smallAccountBlock?: TradePermissionOutcome | null;
  memeBlock?: TradePermissionOutcome | null;
  /** Lifecycle */
  strategyStage?: string;
  lifecycleBlocked?: boolean;
  /** Emergency */
  exchangeFailureFreeze?: boolean;
  autoExecutionEnabled?: boolean;
}

export interface TradePermissionResult {
  decision: TradePermissionOutcome;
  autoAllowed: boolean;
  manualAllowed: boolean;
  paperAllowed: boolean;
  reasonCodes: TradePermissionOutcome[];
  gatesPassed: string[];
  gatesFailed: string[];
  evaluatedAt: string;
}
