import type {
  TradePermissionInput,
  TradePermissionOutcome,
  TradePermissionResult,
} from "@/lib/trading/permission/types";

function push(out: TradePermissionOutcome[], code: TradePermissionOutcome): void {
  if (!out.includes(code)) out.push(code);
}

export function evaluateTradePermission(input: TradePermissionInput): TradePermissionResult {
  const reasonCodes: TradePermissionOutcome[] = [];
  const gatesPassed: string[] = [];
  const gatesFailed: string[] = [];

  if (input.exchangeFailureFreeze) {
    push(reasonCodes, "BLOCK");
    push(reasonCodes, "API_UNHEALTHY");
    gatesFailed.push("EXCHANGE_FAILURE");
  }

  if (!input.apiHealthy) {
    push(reasonCodes, "API_UNHEALTHY");
    gatesFailed.push("API");
  } else gatesPassed.push("API");

  if (input.dataStale || !input.dataTradable) {
    push(reasonCodes, "DATA_STALE");
    gatesFailed.push("DATA");
  } else gatesPassed.push("DATA");

  if (input.reconciliationPassed === false) {
    push(reasonCodes, "UNRECONCILED_PNL");
    gatesFailed.push("RECONCILIATION");
  }

  if (input.smallAccountBlock) push(reasonCodes, input.smallAccountBlock);
  if (input.memeBlock) push(reasonCodes, input.memeBlock);

  if (input.spreadBps > 22) push(reasonCodes, "SPREAD_TOO_WIDE");
  if (input.liquidityUsd < 500_000) push(reasonCodes, "LIQUIDITY_TOO_LOW");
  if (!input.stopValid) push(reasonCodes, "STOP_NOT_SAFE");
  if (input.leverageRecommended > 3 && input.mode === "AUTO") push(reasonCodes, "LEVERAGE_TOO_DANGEROUS");
  if (input.riskOfRuinBlocked) push(reasonCodes, "RISK_OF_RUIN_TOO_HIGH");
  if (input.executionQualityScore < 45) push(reasonCodes, "EXECUTION_QUALITY_TOO_LOW");
  if (input.venueQualityScore < 40) push(reasonCodes, "VENUE_QUALITY_TOO_LOW");
  if (input.fakeoutRiskScore > 70) push(reasonCodes, "FAKEOUT_RISK_TOO_HIGH");
  if (input.lateEntryRiskScore > 65) push(reasonCodes, "LATE_ENTRY");
  if ((input.fundingBpsPer8h ?? 0) > 15) push(reasonCodes, "FUNDING_TOO_HIGH");
  if (input.sessionEdgeBlock) push(reasonCodes, "SESSION_EDGE_NEGATIVE");
  if (input.liveDriftDetected) push(reasonCodes, "LIVE_DRIFT_DETECTED");
  if (input.edgeDecayDetected) push(reasonCodes, "EDGE_DECAY_DETECTED");
  if (input.strategyDegraded || input.lifecycleBlocked) push(reasonCodes, "STRATEGY_DEGRADED");
  if (input.regimeMismatch) push(reasonCodes, "REGIME_MISMATCH");
  if (input.profitDensityScore < 40) push(reasonCodes, "PROFIT_DENSITY_TOO_LOW");
  if ((input.opportunityCostPenalty ?? 0) > 60) push(reasonCodes, "OPPORTUNITY_COST_TOO_HIGH");
  if (input.expectedEdgeAfterCosts < 3) push(reasonCodes, "EXPECTED_EDGE_TOO_SMALL");
  if (input.benchmarkAlphaPassed === false) push(reasonCodes, "BENCHMARK_ALPHA_FAILED");
  if (input.monteCarloBlocked) push(reasonCodes, "MONTE_CARLO_FAILED");
  if (input.adversarialPassed === false) push(reasonCodes, "ADVERSARIAL_TEST_FAILED");
  if (input.microstructureDecision === "BLOCK" || input.microstructureDecision === "CONTRADICT") {
    push(reasonCodes, "MICROSTRUCTURE_CONFLICT");
  }
  if (input.todayProofWeak) push(reasonCodes, "TODAY_PROOF_WEAK");
  if (input.betaNotAlpha) push(reasonCodes, "BETA_NOT_ALPHA");
  if (input.costKilled) push(reasonCodes, "COST_KILLED");
  if (!input.proofGateApproved && input.evidenceLevel < 8) push(reasonCodes, "PROOF_REQUIRED");
  if (input.mode === "AUTO" && !input.autoExecutionEnabled) push(reasonCodes, "AUTO_LOCKED");

  if (input.accountEquity > 0 && input.accountEquity < 25 && input.expectedEdgeAfterCosts < 5) {
    push(reasonCodes, "ACCOUNT_TOO_SMALL");
  }

  if (input.explosiveScore < 45 && input.profitMaximizationScore < 50) {
    push(reasonCodes, "NO_EDGE");
  }

  for (const r of input.routerHardRejects) {
    if (r.includes("FAKEOUT")) push(reasonCodes, "FAKEOUT_RISK_TOO_HIGH");
    if (r.includes("LATE")) push(reasonCodes, "LATE_ENTRY");
    if (r.includes("LIQUIDITY")) push(reasonCodes, "LIQUIDITY_TOO_LOW");
    if (r.includes("SPREAD")) push(reasonCodes, "SPREAD_TOO_WIDE");
    if (r.includes("EXECUTION")) push(reasonCodes, "EXECUTION_QUALITY_TOO_LOW");
    if (r.includes("MONTE_CARLO")) push(reasonCodes, "MONTE_CARLO_FAILED");
    if (r.includes("ADVERSARIAL")) push(reasonCodes, "ADVERSARIAL_TEST_FAILED");
    if (r.includes("BENCHMARK")) push(reasonCodes, "BENCHMARK_ALPHA_FAILED");
    if (r.includes("RISK_OF_RUIN")) push(reasonCodes, "RISK_OF_RUIN_TOO_HIGH");
  }

  const hardBlock = reasonCodes.some((c) =>
    [
      "BLOCK",
      "UNRECONCILED_PNL",
      "API_UNHEALTHY",
      "DATA_STALE",
      "AUTO_LOCKED",
      "STRATEGY_DEGRADED",
      "EDGE_DECAY_DETECTED",
    ].includes(c),
  );

  const waitCodes = reasonCodes.filter((c) =>
    ["WAIT", "NO_EDGE", "PROOF_REQUIRED", "TODAY_PROOF_WEAK", "EXPECTED_EDGE_TOO_SMALL"].includes(c),
  );

  let decision: TradePermissionOutcome = "ALLOW";

  if (hardBlock) {
    decision = reasonCodes.includes("BLOCK") ? "BLOCK" : reasonCodes[0] ?? "BLOCK";
  } else if (waitCodes.length > 0 || input.routerPermission === "WAIT") {
    decision = "WAIT";
  } else if (
    reasonCodes.some((c) =>
      ["MANUAL_ONLY", "ACCOUNT_TOO_SMALL", "FEES_TOO_HIGH", "PROOF_REQUIRED"].includes(c),
    ) ||
    input.mode === "MANUAL" ||
    input.evidenceLevel < 10
  ) {
    decision = reasonCodes.includes("MANUAL_ONLY") ? "MANUAL_ONLY" : "MANUAL_ONLY";
    if (reasonCodes.length === 0 || (reasonCodes.length === 1 && reasonCodes[0] === "ALLOW")) {
      decision = input.evidenceLevel >= 8 ? "MANUAL_ONLY" : "WATCH_ONLY";
    }
  } else if (input.profitMaximizationScore >= 55 && reasonCodes.length === 0) {
    decision = "ALLOW";
  } else if (input.profitMaximizationScore >= 45) {
    decision = "WATCH_ONLY";
  } else {
    decision = "WAIT";
  }

  if (decision === "ALLOW" && reasonCodes.length > 0 && !hardBlock) {
    decision = "MANUAL_ONLY";
  }

  const autoAllowed =
    decision === "ALLOW" &&
    input.mode === "AUTO" &&
    input.autoExecutionEnabled === true &&
    input.evidenceLevel >= 10 &&
    !reasonCodes.length;

  const manualAllowed = ["ALLOW", "MANUAL_ONLY"].includes(decision) && !hardBlock;
  const paperAllowed =
    !hardBlock &&
    !reasonCodes.includes("DATA_STALE") &&
    !reasonCodes.includes("API_UNHEALTHY");

  return {
    decision,
    autoAllowed,
    manualAllowed,
    paperAllowed,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : decision === "ALLOW" ? [] : [decision],
    gatesPassed,
    gatesFailed,
    evaluatedAt: new Date().toISOString(),
  };
}

export const PERMISSION_ENGINE_STATUS = "ACTIVE" as const;
