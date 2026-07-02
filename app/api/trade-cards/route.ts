import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { analyzeOpportunity } from "@/lib/trading/profit";
import { evaluateTradePermission } from "@/lib/trading/permission";
import { evaluateSmallAccountMode } from "@/lib/trading/accounts";
import { evaluateEmergencyPlaybook } from "@/lib/trading/emergency";
import { evaluateAutoExecution } from "@/lib/trading/mode-evaluation";
import { buildManualTradeCard } from "@/lib/trading/cards";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const accountEquity = body.accountEquity ?? 10_000;

    const analysis = await analyzeOpportunity({
      symbol: body.symbol,
      strategyId: body.strategyId,
      accountEquity,
      proofGateApproved: body.proofGateApproved ?? false,
    });

    const small = evaluateSmallAccountMode({
      accountEquityUsd: accountEquity,
      spreadBps: body.spreadBps ?? 5,
      feeBps: 26,
      minOrderSizeUsd: body.minOrderSizeUsd ?? 10,
    });

    const emergency = evaluateEmergencyPlaybook(body.emergency ?? {
      failures: [],
      hasOpenPosition: false,
      stopStatusKnown: true,
      cancelConfirmed: true,
      positionCertain: true,
      duplicateOrderRisk: false,
      allProvidersFailed: false,
      emergencyExitFailed: false,
      reconciliationMismatch: false,
    });

    const auto = evaluateAutoExecution({
      emergencyPaused: body.emergencyPaused ?? false,
      autoSelected: body.mode === "AUTO",
      currentMode: body.mode ?? "MANUAL",
      evidenceLevel: body.evidenceLevel,
      evidenceAutoAllowed: body.evidenceAutoAllowed,
      reconciliationPassed: body.reconciliationPassed,
    });

    const permission = evaluateTradePermission({
      mode: body.mode ?? "MANUAL",
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
      accountEquity,
      expectedEdgeAfterCosts: analysis.router.breakdown.expected_net_profit_after_costs,
      profitDensityScore: analysis.profitPlan.profitDensityScore,
      microstructureDecision: analysis.microstructure.decision,
      evidenceLevel: body.evidenceLevel ?? 0,
      proofGateApproved: body.proofGateApproved ?? false,
      smallAccountBlock: small.blockReason,
      exchangeFailureFreeze: emergency.freezeEntries,
      autoExecutionEnabled: auto.autoExecutionEnabled,
      benchmarkAlphaPassed: body.benchmarkAlphaPassed,
      monteCarloBlocked: body.monteCarloBlocked,
      adversarialPassed: body.adversarialPassed,
      reconciliationPassed: body.reconciliationPassed,
    });

    const card = buildManualTradeCard({ analysis, permission, accountEquity });

    return NextResponse.json({ card, permission, analysis: { symbol: analysis.symbol, router: analysis.router }, auto });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
