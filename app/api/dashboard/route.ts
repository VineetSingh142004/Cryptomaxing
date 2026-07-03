import { NextResponse } from "next/server";
import { getOrCreateModeState } from "@/lib/trading/mode-service";
import { evaluateAutoUnlock, buildAutoUnlockInput } from "@/lib/trading/auto";
import { runSameDayRealityCheck } from "@/lib/trading/reality";
import { runFinalReadinessCheck } from "@/lib/trading/readiness";
import { buildNextStepsChecklist } from "@/lib/trading/dashboard/next-steps";
import { getWorkerRegistrySummary, DEPLOYMENT_SERVICES } from "@/workers";
import { getRedisConnectionInfo } from "@/lib/config/redis";
import { APP_VERSION } from "@/lib/config/constants";
import { getEncryptionStatusPublic, getVaultWritePolicy } from "@/lib/security/vault-policy";
import { getAuthStatus } from "@/lib/security/auth";
import { getMarketDataProviderStatus } from "@/lib/trading/paper/safe-check";
import { getAccountStatus } from "@/lib/trading/exchange/account-service";
import { getPaperStatus, getPaperEvidenceStats } from "@/lib/trading/paper/evidence-service";
import { resolveUserId } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const mode = await getOrCreateModeState();
    const auth = await getAuthStatus();
    const unlockInput = await buildAutoUnlockInput();
    const unlock = evaluateAutoUnlock(unlockInput);
    const reality = runSameDayRealityCheck({
      evidenceLevel: 0,
      todayProofAvailable: false,
      todayGoNoGoAllows: false,
      paperProfitToday: null,
      shadowProfitToday: null,
      liveNetToday: null,
      liveReconciled: false,
      liveTradeCount: 0,
      edgeDecaySeverity: "NONE",
      liveDriftDetected: false,
      strategyDegraded: false,
      statisticallyMeaningful: false,
    });
    const readiness = await runFinalReadinessCheck();
    const encryption = getEncryptionStatusPublic();
    const vaultPolicy = await getVaultWritePolicy();
    const marketData = getMarketDataProviderStatus();

    let paperEvidence: Awaited<ReturnType<typeof getPaperStatus>> | null = null;
    let paperForwardStatus: "NOT_CONFIGURED" | "COLLECTING" | "PASS" = "NOT_CONFIGURED";
    let paperForwardNote: string | undefined;
    try {
      const userId = await resolveUserId();
      const stats = await getPaperEvidenceStats(userId);
      paperEvidence = await getPaperStatus();
      paperForwardStatus = stats.evidenceStatus;
      paperForwardNote = stats.evidenceNote;
    } catch {
      paperEvidence = null;
    }

    const nextSteps = await buildNextStepsChecklist({
      authStatus: auth.status,
      authConfigured: auth.configured,
      modePaperEnabled: mode.paper_enabled,
      autoExecutionEnabled: unlock.autoExecutionEnabled,
      sameDayEvidenceExists: reality.evidencePresent.length > 0,
      paperForwardEvidenceStatus: paperForwardStatus,
      paperForwardEvidenceNote: paperForwardNote,
    });

    let exchangeAccountReadiness: Awaited<ReturnType<typeof getAccountStatus>> | null = null;
    if (auth.status === "AUTH_READY" || auth.status === "LOCAL_OWNER_MODE") {
      try {
        exchangeAccountReadiness = await getAccountStatus();
      } catch {
        exchangeAccountReadiness = null;
      }
    }

    return NextResponse.json({
      version: APP_VERSION,
      mode,
      auth,
      auto_unlock: {
        decision: unlock.decision,
        auto_execution_enabled: unlock.autoExecutionEnabled,
        failed_gates: unlock.failedGateIds.slice(0, 10),
        failed_gate_count: unlock.failedGateCount,
        next_gate_to_fix: unlock.nextGateToFix,
        safest_next_action: unlock.safestNextAction,
        scaling_allowed: unlock.scalingAllowed,
      },
      why_waiting: unlock.decision === "WAIT" ? unlock.reasonCodes : [],
      why_blocked: unlock.decision === "BLOCK" ? unlock.failedGateIds.slice(0, 5) : [],
      same_day_reality: reality,
      readiness: readiness.summary,
      workers: getWorkerRegistrySummary(),
      services: DEPLOYMENT_SERVICES,
      redis: getRedisConnectionInfo(),
      balance: null,
      gross_net_pnl: { gross: null, net: null, note: "Requires verified live trades" },
      fees_slippage_funding: { fees: null, slippage: null, funding: null },
      current_risk: null,
      evidence_level: 0,
      money_protected: null,
      api_health: "UNKNOWN",
      encryption: {
        production_safe: encryption.productionSafe,
        vault_writes_allowed: vaultPolicy.allowed,
        block_reasons: vaultPolicy.blockReasons,
        warning: encryption.warning,
        reason_code: encryption.reasonCode,
      },
      next_steps_checklist: nextSteps.items,
      next_steps: nextSteps.messages,
      market_data: marketData,
      exchange_account_readiness: exchangeAccountReadiness,
      local_owner_mode: auth.localOwnerMode ?? auth.status === "LOCAL_OWNER_MODE",
      paper_mode: {
        safe_to_test: true,
        places_real_orders: false,
        shows_verified_pnl: false,
        note: "Paper profit is simulated — never labeled as real profit",
        status: "PAPER_MODE_READY",
      },
      paper_evidence: paperEvidence,
      disclaimers: [
        "Dashboard shows system state — not fabricated P&L",
        "Paper/shadow profits are never labeled as real profit",
        "Auto execution locked until all gates pass and engine is wired",
      ],
    });
  } catch (error) {
    logger.error({ err: error }, "GET /api/dashboard failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
