import { analyzeOpportunity, type FullOpportunityAnalysis } from "@/lib/trading/profit/analyze-opportunity";
import { evaluateTradePermission } from "@/lib/trading/permission";
import { evaluateSmallAccountMode } from "@/lib/trading/accounts/small-account";
import { evaluateMemeSurvival } from "@/lib/trading/accounts/meme-survival";
import { evaluateEmergencyPlaybook } from "@/lib/trading/emergency";
import { openPaperTrade, closePaperTrade } from "@/lib/trading/paper/forward-tracker";
import type { PaperTradeRecord } from "@/lib/trading/paper/types";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";
import type { PermissionMode } from "@/lib/trading/permission/types";

export interface PaperBrokerInput {
  symbol: string;
  strategyId: string;
  mode?: PermissionMode;
  accountEquity?: number;
  direction?: "long" | "short";
  signalTimestamp?: string;
  isMeme?: boolean;
  exchangeFailures?: string[];
  hasOpenPosition?: boolean;
  proofGateApproved?: boolean;
  evidenceLevel?: number;
  rng?: () => number;
}

export interface PaperBrokerSession {
  analysis: FullOpportunityAnalysis;
  permission: ReturnType<typeof evaluateTradePermission>;
  emergency: ReturnType<typeof evaluateEmergencyPlaybook>;
  paperTrade: PaperTradeRecord | null;
  ledgerBalance: number;
  reasonCodes: string[];
  sessionAt: string;
}

export async function runPaperBrokerSession(input: PaperBrokerInput): Promise<PaperBrokerSession> {
  const accountEquity = input.accountEquity ?? 10_000;
  const mode = input.mode ?? "PAPER";
  const signalTimestamp = input.signalTimestamp ?? new Date().toISOString();
  const reportDate = signalTimestamp.slice(0, 10);

  const analysis = await analyzeOpportunity({
    symbol: input.symbol,
    strategyId: input.strategyId,
    direction: input.direction,
    accountEquity,
    proofGateApproved: input.proofGateApproved ?? false,
  });

  const small = evaluateSmallAccountMode({
    accountEquityUsd: accountEquity,
    spreadBps: analysis.execution.estimates.entrySlippageBps,
    feeBps: DEFAULT_FEE_MODEL.takerBps,
    minOrderSizeUsd: 10,
    isScalping: false,
  });

  const meme = input.isMeme
    ? evaluateMemeSurvival({
        symbol: input.symbol,
        security: null,
        exitLiquidityUsd: analysis.execution.estimates.depthAtPositionUsd,
        spreadBps: analysis.execution.estimates.spreadExpansionRisk * 20,
        relativeVolume: analysis.explosive.scores.volume_acceleration_score,
        mode,
      })
    : null;

  const emergency = evaluateEmergencyPlaybook({
    failures: (input.exchangeFailures ?? []) as never[],
    hasOpenPosition: input.hasOpenPosition ?? false,
    stopStatusKnown: true,
    cancelConfirmed: true,
    positionCertain: true,
    duplicateOrderRisk: false,
    allProvidersFailed: false,
    emergencyExitFailed: false,
    reconciliationMismatch: false,
  });

  const permission = evaluateTradePermission({
    mode,
    routerHardRejects: analysis.router.hardRejects,
    routerPermission: analysis.router.permission,
    profitMaximizationScore: analysis.router.profitMaximizationScore,
    fakeoutRiskScore: analysis.explosive.scores.fakeout_risk_score,
    lateEntryRiskScore: analysis.explosive.scores.late_entry_risk_score,
    explosiveScore: analysis.explosive.scores.explosive_move_score,
    executionQualityScore: analysis.execution.executionQualityScore,
    spreadBps: analysis.execution.estimates.spreadExpansionRisk * 20,
    liquidityUsd: analysis.execution.estimates.depthAtPositionUsd,
    venueQualityScore: analysis.venue.edgeAfterExecutionScore ?? 0,
    dataTradable: analysis.dataQuality.tradable,
    dataStale: analysis.dataQuality.reasonCodes.includes("DATA_STALE"),
    apiHealthy: !emergency.blockNewTrades,
    stopValid: analysis.stop.decision === "VALID",
    leverageRecommended: analysis.leverage.recommendedLeverage,
    riskOfRuinBlocked: analysis.kelly.decision === "BLOCK",
    sessionEdgeBlock: false,
    liveDriftDetected: false,
    edgeDecayDetected: false,
    accountEquity,
    expectedEdgeAfterCosts: analysis.router.breakdown.expected_net_profit_after_costs,
    profitDensityScore: analysis.profitPlan.profitDensityScore,
    microstructureDecision: analysis.microstructure.decision,
    evidenceLevel: input.evidenceLevel ?? 0,
    proofGateApproved: input.proofGateApproved ?? false,
    smallAccountBlock: small.blockReason,
    memeBlock: meme?.blockReason ?? null,
    exchangeFailureFreeze: emergency.freezeEntries,
    autoExecutionEnabled: false,
  });

  let paperTrade: PaperTradeRecord | null = null;
  const reasonCodes = [...permission.reasonCodes];

  if (permission.paperAllowed && permission.decision !== "WAIT" && permission.decision !== "BLOCK") {
    const size = accountEquity * (analysis.kelly.riskPerTradePct / 100) / (analysis.stop.stopDistancePct / 100 || 0.01);
    paperTrade = openPaperTrade({
      signalTimestamp,
      symbol: input.symbol,
      strategyId: input.strategyId,
      direction: input.direction ?? "long",
      entryPrice: analysis.stop.entryPrice,
      size: Math.max(size, 0.001),
      feeModel: DEFAULT_FEE_MODEL,
      spreadBps: analysis.execution.estimates.spreadExpansionRisk * 20,
      reportDate,
      rng: input.rng,
    });
    if (paperTrade.status === "OPEN" || paperTrade.status === "PARTIAL_FILL") {
      paperTrade = closePaperTrade({
        trade: paperTrade,
        exitPrice: analysis.profitPlan.partialTpPrice,
        holdHours: analysis.profitPlan.capitalLockupMinutes / 60,
        rng: input.rng,
      });
    }
  } else {
    reasonCodes.push("PAPER_BLOCKED_BY_PERMISSION");
  }

  const net = paperTrade?.netPnl ?? 0;

  return {
    analysis,
    permission,
    emergency,
    paperTrade,
    ledgerBalance: accountEquity + net,
    reasonCodes,
    sessionAt: new Date().toISOString(),
  };
}

export const PAPER_BROKER_STATUS = "ACTIVE" as const;
