import { NextResponse } from "next/server";
import { getOrCreateModeState } from "@/lib/trading/mode-service";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { runSameDayRealityCheck } from "@/lib/trading/reality";
import { runFinalReadinessCheck } from "@/lib/trading/readiness";
import { getWorkerRegistrySummary, DEPLOYMENT_SERVICES } from "@/workers";
import { getRedisConnectionInfo } from "@/lib/config/redis";
import { APP_VERSION } from "@/lib/config/constants";
import { getEncryptionStatusPublic, getVaultWritePolicy } from "@/lib/security/vault-policy";
import { getAuthStatus } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const mode = await getOrCreateModeState();
    const unlock = evaluateAutoUnlock(defaultAutoUnlockInput());
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
    const readiness = runFinalReadinessCheck();
    const encryption = getEncryptionStatusPublic();
    const auth = getAuthStatus();
    const vaultPolicy = getVaultWritePolicy();

    return NextResponse.json({
      version: APP_VERSION,
      mode,
      auto_unlock: {
        decision: unlock.decision,
        auto_execution_enabled: unlock.autoExecutionEnabled,
        failed_gates: unlock.failedGateIds.slice(0, 10),
        failed_gate_count: unlock.failedGateIds.length,
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
      auth,
      encryption: {
        production_safe: encryption.productionSafe,
        vault_writes_allowed: vaultPolicy.allowed,
        block_reasons: vaultPolicy.blockReasons,
        warning: encryption.warning,
      },
      next_steps: [
        "Paper Mode is safe to test — no real orders are placed",
        "Auto execution is locked — do not enable live trading",
        "Live trading is NOT ready — execution engine not wired",
        vaultPolicy.allowed
          ? "Vault writes allowed — still use read-only keys only until auth exists"
          : "Do NOT add real API keys until ENCRYPTION_KEY is set and auth is implemented",
        "Recommended now: Paper Mode + same-day shadow evidence only",
      ],
      paper_mode: {
        safe_to_test: true,
        places_real_orders: false,
        shows_verified_pnl: false,
        note: "Paper profit is simulated — never labeled as real profit",
      },
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
