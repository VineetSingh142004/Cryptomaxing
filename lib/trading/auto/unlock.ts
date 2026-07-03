import type { AutoUnlockDecision, AutoUnlockGate, AutoUnlockInput, AutoUnlockResult } from "@/lib/trading/auto/types";

function gate(id: string, label: string, passed: boolean, required = true): AutoUnlockGate {
  return { id, label, passed, required };
}

export function evaluateAutoUnlock(input: AutoUnlockInput): AutoUnlockResult {
  const reasonCodes: string[] = [];
  const gates: AutoUnlockGate[] = [
    gate("auth_configured", "Auth configured", input.authConfigured ?? false),
    gate("auth_ready", "User authenticated", input.authReady ?? false),
    gate("encryption_safe", "Encryption production-safe", input.encryptionProductionSafe ?? false),
    gate("emergency", "Emergency not paused", !input.emergencyPaused),
    gate("paper_realistic", "Paper realistic", input.paperRealistic),
    gate("manual_working", "Manual working", input.manualWorking),
    gate("api_secure", "API secure", input.apiSecure),
    gate("no_withdrawal", "No withdrawal permission", input.noWithdrawalPermission),
    gate("exact_strategy", "Exact strategy approved", input.exactStrategyApproved),
    gate("parameters", "Approved parameters", input.parametersApproved),
    gate("data_quality", "Data quality passes", input.dataQualityPasses),
    gate("alpha_research", "Alpha research supports edge", input.alphaResearchSupportsEdge),
    gate("today_proof", "Today's market proof available", input.todayMarketProofAvailable),
    gate("today_alpha_beta", "Today's alpha vs beta passes", input.todayAlphaBetaPasses),
    gate("today_execution", "Today's execution realism passes", input.todayExecutionRealismPasses),
    gate("today_cost", "Today's cost survival passes", input.todayCostSurvivalPasses),
    gate("today_fill", "Today's fill realism passes", input.todayFillRealismPasses),
    gate("today_go_no_go", "Today's go/no-go allows", input.todayGoNoGoAllows),
    gate("scorecard", "Profitability scorecard allows stage", input.scorecardAllowsStage),
    gate("money_protected", "Money protected engine active", input.moneyProtectedEngineActive),
    gate("reality_check", "Same-day reality check visible", input.sameDayRealityCheckVisible),
    gate("benchmark", "Benchmark alpha passes", input.benchmarkAlphaPasses),
    gate("monte_carlo", "Monte Carlo survival passes", input.monteCarloSurvivalPasses),
    gate("adversarial", "Adversarial survival passes", input.adversarialSurvivalPasses),
    gate("microstructure", "Microstructure conflict clear", input.microstructureConflictClear),
    gate("backtest", "Backtest passes", input.backtestPasses),
    gate("validation", "Validation passes", input.validationPasses),
    gate("oos", "Out-of-sample passes", input.outOfSamplePasses),
    gate("walk_forward", "Walk-forward passes", input.walkForwardPasses),
    gate("stress", "Stress test passes", input.stressTestPasses),
    gate("paper_forward", "Paper forward passes", input.paperForwardPasses),
    gate("shadow_live", "Shadow live passes", input.shadowLivePasses),
    gate("tiny_canary", "Tiny live canary passes", input.tinyLiveCanaryPasses),
    gate("live_execution_audit", "Live execution audit passes", input.liveExecutionAuditPasses),
    gate("live_slippage", "Live slippage audit passes", input.liveSlippageAuditPasses),
    gate("live_fee_funding", "Live fee/funding audit passes", input.liveFeeFundingAuditPasses),
    gate("live_reconciliation", "Live reconciliation passes", input.liveReconciliationPasses),
    gate("live_sample", "Live sample size passes", input.liveSampleSizePasses),
    gate("evidence_level", "Evidence level allows size", input.evidenceLevelAllowsSize),
    gate("strategy_ok", "Strategy not degraded", input.strategyNotDegraded),
    gate("edge_decay", "Edge decay clear", input.edgeDecayClear),
    gate("live_drift", "Live drift clear", input.liveDriftClear),
    gate("session_edge", "Session edge positive or A+ exception", input.sessionEdgePositiveOrAPlus),
    gate("risk_of_ruin", "Risk of ruin acceptable", input.riskOfRuinAcceptable),
    gate("attribution", "Profit attribution supports edge", input.profitAttributionSupportsEdge),
    gate("profit_density", "Profit density acceptable", input.profitDensityAcceptable),
    gate("execution_quality", "Execution quality acceptable", input.executionQualityAcceptable),
    gate("venue_quality", "Venue quality acceptable", input.venueQualityAcceptable),
    gate("exchange_health", "Exchange health acceptable", input.exchangeHealthAcceptable),
    gate("opportunity_cost", "Opportunity cost acceptable", input.opportunityCostAcceptable),
    gate("stop", "Stop executable", input.stopExecutable),
    gate("exit", "Exit ready", input.exitReady),
    gate("kill_switch", "Kill switch clear", input.killSwitchClear),
    gate("loss_limits", "Daily/weekly loss available", input.dailyWeeklyLossAvailable),
    gate("user_approval", "User manually approved Auto stage", input.userApprovedAutoStage),
    gate("execution_engine", "Execution engine wired", input.executionEngineWired),
  ];

  if (input.backtestProfitOnly) {
    reasonCodes.push("BACKTEST_PROFIT_ONLY");
  }
  if (input.oneBigLiveWin) {
    reasonCodes.push("ONE_BIG_LIVE_WIN");
  }
  if (input.unreconciledPnl) {
    reasonCodes.push("UNRECONCILED_PNL");
  }
  if (input.weakTodayProof) {
    reasonCodes.push("TODAY_PROOF_WEAK");
  }
  if (input.luckyTradeDependence) {
    reasonCodes.push("LUCKY_TRADE_DEPENDENCE");
  }
  if (input.lowProfitDensity) {
    reasonCodes.push("LOW_PROFIT_DENSITY");
  }

  const gatesPassed = gates.filter((g) => g.passed);
  const gatesFailed = gates.filter((g) => !g.passed && g.required);
  const failedGateIds = gatesFailed.map((g) => g.id);

  let decision: AutoUnlockDecision = "BLOCK";
  let scalingAllowed = false;
  let maxMode: AutoUnlockDecision = "BLOCK";

  if (input.emergencyPaused) {
    decision = "BLOCK";
    reasonCodes.push("EMERGENCY_PAUSED");
  } else if (input.evidenceLevel < 8 || input.backtestProfitOnly) {
    decision = "PAPER_ONLY";
    maxMode = "PAPER_ONLY";
  } else if (input.unreconciledPnl || !input.liveReconciliationPasses) {
    decision = "REVALIDATION_REQUIRED";
    reasonCodes.push("RECONCILIATION_REQUIRED");
  } else if (
    input.oneBigLiveWin ||
    input.luckyTradeDependence ||
    !input.liveSampleSizePasses ||
    input.evidenceLevel < 10
  ) {
    decision = "TINY_CANARY_ONLY";
    maxMode = "TINY_CANARY_ONLY";
  } else if (
    gatesFailed.some((g) =>
      ["data_quality", "api_secure", "exchange_health", "microstructure", "live_reconciliation"].includes(g.id),
    )
  ) {
    decision = "BLOCK";
  } else if (gatesFailed.some((g) => ["today_proof", "today_go_no_go", "weakTodayProof"].includes(g.id)) || input.weakTodayProof) {
    decision = "WAIT";
    reasonCodes.push("WAIT_FOR_TODAY_PROOF");
  } else if (
    gatesFailed.some((g) =>
      ["edge_decay", "live_drift", "strategy_ok", "attribution", "benchmark", "monte_carlo", "adversarial"].includes(
        g.id,
      ),
    )
  ) {
    decision = "WATCH";
  } else if (gatesFailed.some((g) => ["user_approval", "execution_engine"].includes(g.id))) {
    decision = "MANUAL_ONLY";
    maxMode = "MANUAL_ONLY";
  } else if (gatesFailed.length === 0 && input.executionEngineWired && input.userApprovedAutoStage) {
    decision = "TINY_CANARY_ONLY";
    maxMode = input.evidenceLevel >= 12 ? "TINY_CANARY_ONLY" : "TINY_CANARY_ONLY";
    scalingAllowed = input.evidenceLevel >= 12 && input.liveSampleSizePasses && !input.oneBigLiveWin;
  } else if (gatesFailed.length > 0) {
    decision = "MANUAL_ONLY";
    maxMode = "MANUAL_ONLY";
  }

  // Never enable full auto execution without wired engine — even if all gates pass
  const autoExecutionEnabled =
    decision !== "BLOCK" &&
    decision !== "REVALIDATION_REQUIRED" &&
    input.executionEngineWired &&
    input.userApprovedAutoStage &&
    input.evidenceLevel >= 10 &&
    input.liveReconciliationPasses &&
    !input.unreconciledPnl &&
    gatesFailed.length === 0;

  if (!input.executionEngineWired) {
    reasonCodes.push("EXECUTION_ENGINE_NOT_WIRED");
  }
  if (!(input.authReady ?? false)) {
    reasonCodes.push("AUTH_REQUIRED");
  }
  if (!(input.encryptionProductionSafe ?? false)) {
    reasonCodes.push("ENCRYPTION_KEY_UNSAFE");
  }
  if (!input.liveReconciliationPasses) {
    reasonCodes.push("NO_LIVE_RECONCILIATION");
  }
  if (!input.liveSampleSizePasses) {
    reasonCodes.push("NO_LIVE_SAMPLE_SIZE");
  }
  if (!input.tinyLiveCanaryPasses) {
    reasonCodes.push("NO_TINY_CANARY");
  }
  if (!input.liveExecutionAuditPasses) {
    reasonCodes.push("NO_LIVE_EXECUTION_AUDIT");
  }
  if (input.weakTodayProof || !input.todayMarketProofAvailable) {
    reasonCodes.push("TODAY_PROOF_WEAK");
  }
  if (!input.todayAlphaBetaPasses) {
    reasonCodes.push("ALPHA_BETA_CHECK_MISSING");
  }
  if (!input.paperForwardPasses && !input.shadowLivePasses) {
    reasonCodes.push("PAPER_SHADOW_ONLY");
  }
  if (!input.userApprovedAutoStage) {
    reasonCodes.push("USER_APPROVAL_MISSING");
  }

  const nextGateToFix = gatesFailed[0]?.id ?? null;
  const safestNextAction = pickSafestNextAction(gatesFailed, decision);

  return {
    decision,
    autoExecutionEnabled,
    gatesPassed,
    gatesFailed,
    failedGates: gatesFailed,
    failedGateIds,
    failedGateCount: gatesFailed.length,
    nextGateToFix,
    safestNextAction,
    reasonCodes,
    scalingAllowed,
    maxMode,
    evaluatedAt: new Date().toISOString(),
  };
}

function pickSafestNextAction(
  failed: AutoUnlockGate[],
  decision: AutoUnlockDecision,
): string {
  const ids = new Set(failed.map((g) => g.id));
  if (ids.has("auth_ready") || ids.has("auth_configured")) {
    return "Sign in and configure Supabase auth before vault or live trading";
  }
  if (ids.has("encryption_safe")) {
    return "Generate ENCRYPTION_KEY (openssl rand -base64 32) before storing API keys";
  }
  if (ids.has("execution_engine")) {
    return "Stay in Paper Mode — execution engine is not wired";
  }
  if (decision === "PAPER_ONLY" || ids.has("paper_forward") || ids.has("shadow_live")) {
    return "Continue Paper Mode and collect same-day shadow/paper evidence only";
  }
  if (ids.has("live_reconciliation") || ids.has("live_sample")) {
    return "Do not trade live — reconciled live sample required";
  }
  return "Stay in Paper Mode — Auto execution remains locked";
}

export function defaultAutoUnlockInput(overrides: Partial<AutoUnlockInput> = {}): AutoUnlockInput {
  return {
    emergencyPaused: false,
    paperRealistic: true,
    manualWorking: true,
    apiSecure: false,
    noWithdrawalPermission: false,
    exactStrategyApproved: false,
    parametersApproved: false,
    dataQualityPasses: false,
    alphaResearchSupportsEdge: false,
    todayMarketProofAvailable: false,
    todayAlphaBetaPasses: false,
    todayExecutionRealismPasses: false,
    todayCostSurvivalPasses: false,
    todayFillRealismPasses: false,
    todayGoNoGoAllows: false,
    scorecardAllowsStage: false,
    moneyProtectedEngineActive: true,
    sameDayRealityCheckVisible: true,
    benchmarkAlphaPasses: false,
    monteCarloSurvivalPasses: false,
    adversarialSurvivalPasses: false,
    microstructureConflictClear: true,
    backtestPasses: false,
    validationPasses: false,
    outOfSamplePasses: false,
    walkForwardPasses: false,
    stressTestPasses: false,
    paperForwardPasses: false,
    shadowLivePasses: false,
    tinyLiveCanaryPasses: false,
    liveExecutionAuditPasses: false,
    liveSlippageAuditPasses: false,
    liveFeeFundingAuditPasses: false,
    liveReconciliationPasses: false,
    liveSampleSizePasses: false,
    evidenceLevelAllowsSize: false,
    strategyNotDegraded: true,
    edgeDecayClear: true,
    liveDriftClear: true,
    sessionEdgePositiveOrAPlus: false,
    riskOfRuinAcceptable: false,
    profitAttributionSupportsEdge: false,
    profitDensityAcceptable: false,
    executionQualityAcceptable: false,
    venueQualityAcceptable: false,
    exchangeHealthAcceptable: true,
    opportunityCostAcceptable: true,
    stopExecutable: true,
    exitReady: true,
    killSwitchClear: true,
    dailyWeeklyLossAvailable: true,
    userApprovedAutoStage: false,
    executionEngineWired: false,
    authConfigured: false,
    authReady: false,
    encryptionProductionSafe: false,
    evidenceLevel: 0,
    ...overrides,
  };
}

export async function buildAutoUnlockInput(
  overrides: Partial<AutoUnlockInput> = {},
): Promise<AutoUnlockInput> {
  const { getAuthStatus } = await import("@/lib/security/auth");
  const { isEncryptionProductionSafe } = await import("@/lib/security/vault-policy");
  const auth = await getAuthStatus();
  const authReady =
    auth.status === "AUTH_READY" || auth.status === "LOCAL_OWNER_MODE";
  return defaultAutoUnlockInput({
    authConfigured: auth.configured || auth.status === "LOCAL_OWNER_MODE",
    authReady,
    encryptionProductionSafe: isEncryptionProductionSafe(),
    ...overrides,
  });
}
