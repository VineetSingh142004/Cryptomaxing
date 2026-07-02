import type { ComputedFeatures } from "@/lib/trading/features/compute";
import type { TrueInvalidationStopResult } from "@/lib/trading/stops/true-invalidation";
import type { ExecutionQualityResult } from "@/lib/trading/execution/types";

export interface LeverageIntelligenceResult {
  maxSafeLeverage: number;
  recommendedLeverage: number;
  liquidationPrice: number | null;
  stopDistancePct: number;
  stopToLiquidationGapPct: number | null;
  volatilityAdjustedLeverage: number;
  accountSizeAdjustedLeverage: number;
  proofAdjustedLeverage: number;
  losingStreakAdjustedLeverage: number;
  sessionAdjustedLeverage: number;
  liveDriftAdjustedLeverage: number;
  decision: "ALLOW" | "BLOCK";
  blockReasons: string[];
  gatesPassed: string[];
  gatesFailed: string[];
  computedAt: string;
}

export interface KellySizingInput {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  accountEquity: number;
  sampleSize: number;
  correlatedExposure?: number;
  dailyRiskUsedPct?: number;
  weeklyRiskUsedPct?: number;
  riskBand?: "conservative" | "normal" | "aggressive";
  kellyCapFraction?: number;
}

export interface KellySizingResult {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number | null;
  kellyFraction: number | null;
  cappedKellyFraction: number | null;
  riskPerTradePct: number;
  losingStreakProbability: number | null;
  maxExpectedDrawdownPct: number | null;
  accountRiskOfRuin: number | null;
  correlationExposurePenalty: number;
  dailyRiskRemainingPct: number;
  weeklyRiskRemainingPct: number;
  decision: "ALLOW" | "BLOCK";
  blockReasons: string[];
  computedAt: string;
}

export interface DailyPnLState {
  netDailyPct: number;
  consecutiveLosses: number;
  tradesToday: number;
}

export interface DailyGuardrailResult {
  netDailyPct: number;
  riskMultiplier: number;
  liveTradingAllowed: boolean;
  setupFilter: "ALL" | "A_PLUS_ONLY" | "NONE";
  recommendations: string[];
  reasonCodes: string[];
  evaluatedAt: string;
}

export interface LeverageInput {
  entryPrice: number;
  direction: "long" | "short";
  stop: TrueInvalidationStopResult;
  execution: ExecutionQualityResult;
  features: ComputedFeatures;
  accountEquity: number;
  proofGateApproved?: boolean;
  riskOfRuinApproved?: boolean;
  losingStreak?: number;
  sessionExpectancyPositive?: boolean;
  liveDriftDetected?: boolean;
  expectedRewardPct?: number;
}
