import type { LiveTradeRecord } from "@/lib/trading/live/types";
import type { ProfitAttributionResult } from "@/lib/trading/live/types";
import type { ReconciliationResult } from "@/lib/trading/live/types";
import type { EvidenceLevelNumber } from "@/lib/trading/proof/types";

export interface ProfitabilityReportInput {
  dateRange: { start: string; end: string };
  startingEquity: number;
  endingEquity: number;
  trades: LiveTradeRecord[];
  paperTrades?: LiveTradeRecord[];
  shadowTrades?: LiveTradeRecord[];
  backtestNetPnl?: number;
  benchmarkNetPnl?: number;
  randomBaselineNetPnl?: number;
  reconciliation?: ReconciliationResult | null;
  evidenceLevel: EvidenceLevelNumber;
  evidenceLevelChanges?: { from: EvidenceLevelNumber; to: EvidenceLevelNumber; reason: string }[];
  strategyPromotions?: { strategyId: string; from: string; to: string }[];
  strategyDemotions?: { strategyId: string; from: string; to: string }[];
  autoBlocks?: { reason: string; count: number; moneyProtected?: number }[];
  moneyProtectedTotal?: number;
  executionQualityScore?: number;
  attribution?: ProfitAttributionResult | null;
  sampleSize: number;
  statisticallyMeaningful: boolean;
  edgeTrend: "IMPROVING" | "STABLE" | "DECAYING" | "UNKNOWN";
}

export interface ProfitabilityReport {
  dateRange: { start: string; end: string };
  startingEquity: number;
  endingEquity: number;
  /** Net P&L — primary metric */
  realizedNetPnl: number;
  unrealizedPnl: number;
  grossPnl: number;
  totalFees: number;
  totalSlippage: number;
  totalFunding: number;
  totalSpreadCost: number;
  tradeCount: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  largestLoss: number;
  consecutiveLosses: number;
  strategyBreakdown: Record<string, number>;
  assetBreakdown: Record<string, number>;
  venueBreakdown: Record<string, number>;
  regimeBreakdown: Record<string, number>;
  benchmarkComparison: { benchmarkNet: number; alphaVsBenchmark: number } | null;
  randomBaselineComparison: { randomNet: number; alphaVsRandom: number } | null;
  liveVsPaper: { liveNet: number; paperNet: number; delta: number } | null;
  liveVsBacktest: { liveNet: number; backtestNet: number; delta: number } | null;
  executionQualityScore: number | null;
  reconciliationStatus: string;
  evidenceLevel: EvidenceLevelNumber;
  evidenceLevelChanges: ProfitabilityReportInput["evidenceLevelChanges"];
  strategyPromotions: ProfitabilityReportInput["strategyPromotions"];
  strategyDemotions: ProfitabilityReportInput["strategyDemotions"];
  autoBlocks: ProfitabilityReportInput["autoBlocks"];
  moneyProtectedTotal: number;
  statisticallyMeaningful: boolean;
  edgeTrend: ProfitabilityReportInput["edgeTrend"];
  annualizedReturnPct: number | null;
  annualizationWarning: string | null;
  profitabilityClaim: "NOT_PROVEN" | "INSUFFICIENT_LIVE" | "RECONCILED_EDGE" | "NEGATIVE";
  disclaimers: string[];
  generatedAt: string;
}

export type TradeLike = Pick<
  LiveTradeRecord,
  | "strategyId"
  | "symbol"
  | "venue"
  | "regime"
  | "grossPnl"
  | "fees"
  | "spreadCost"
  | "slippage"
  | "funding"
  | "stopSlippage"
  | "entryTime"
  | "exitTime"
  | "reconciled"
>;
