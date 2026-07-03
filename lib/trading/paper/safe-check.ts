import { getAuthStatus } from "@/lib/security/auth";
import { getVaultReadinessStatus, getVaultWritePolicy } from "@/lib/security/vault-policy";
import { runSameDayRealityCheck } from "@/lib/trading/reality";

export type SafeCheckStatus =
  | "READY_FOR_PAPER"
  | "DATA_PROVIDER_NOT_CONFIGURED"
  | "NO_EDGE_TODAY"
  | "PAPER_EVIDENCE_ONLY"
  | "SHADOW_EVIDENCE_ONLY"
  | "NOT_ENOUGH_DATA"
  | "DO_NOT_TRADE_LIVE";

export function isMarketDataProviderConfigured(): boolean {
  return getMarketDataProviderStatus().configured;
}

export function getMarketDataProviderStatus(): {
  configured: boolean;
  status: "NOT_CONFIGURED" | "CONFIGURED" | "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED";
  provider: string | null;
  label: string;
} {
  const provider = process.env.MARKET_DATA_PROVIDER?.trim();
  if (!provider || provider === "none") {
    return {
      configured: false,
      status: "NOT_CONFIGURED",
      provider: null,
      label: "NOT_CONFIGURED",
    };
  }
  if (provider === "kraken") {
    return {
      configured: true,
      status: "CONFIGURED",
      provider,
      label: "CONFIGURED",
    };
  }
  return {
    configured: false,
    status: "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED",
    provider,
    label: "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED",
  };
}

export async function runSafePaperShadowCheck(): Promise<{
  status: SafeCheckStatus;
  dataSource: string;
  liveMarketDataConfigured: boolean;
  paperModeReady: boolean;
  sameDayEvidenceExists: boolean;
  missingRequirements: string[];
  nextRecommendedAction: string;
  paperModeStatus: string;
  reasonCodes: string[];
}> {
  const auth = await getAuthStatus();
  const { getOrCreateModeState } = await import("@/lib/trading/mode-service");
  const mode = await getOrCreateModeState();
  const vaultPolicy = await getVaultWritePolicy();
  const encryption = getVaultReadinessStatus();
  const liveMarketDataConfigured = isMarketDataProviderConfigured();

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

  const missingRequirements: string[] = [];
  const reasonCodes: string[] = [];

  if (auth.status !== "AUTH_READY" && auth.status !== "LOCAL_OWNER_MODE") {
    missingRequirements.push("Sign in or enable LOCAL_OWNER_MODE for vault and mode persistence");
    reasonCodes.push(auth.status);
  }
  if (!encryption.encryptionReady) {
    missingRequirements.push(encryption.safeMessage);
    reasonCodes.push(encryption.reasonCode);
  }
  if (!liveMarketDataConfigured) {
    missingRequirements.push("Market data provider not configured (set MARKET_DATA_PROVIDER in .env)");
    reasonCodes.push("DATA_PROVIDER_NOT_CONFIGURED");
  }
  if (reality.evidenceMissing.length > 0) {
    missingRequirements.push(...reality.evidenceMissing.slice(0, 3));
  }

  const paperModeReady = mode.paper_enabled && mode.current_mode === "paper";
  const sameDayEvidenceExists = reality.evidencePresent.length > 0;

  let status: SafeCheckStatus = "NOT_ENOUGH_DATA";
  if (!liveMarketDataConfigured) {
    status = "DATA_PROVIDER_NOT_CONFIGURED";
  } else if (paperModeReady && sameDayEvidenceExists) {
    status = "READY_FOR_PAPER";
  } else if (paperModeReady) {
    status = "PAPER_EVIDENCE_ONLY";
  } else {
    status = "DO_NOT_TRADE_LIVE";
  }

  let nextRecommendedAction =
    "Stay in Paper Mode — run same-day checks only, no live trading";
  if (auth.status === "AUTH_REQUIRED") {
    nextRecommendedAction = "Sign in, then select Paper Mode and run this check again";
  } else if (!encryption.encryptionReady) {
    nextRecommendedAction = "Generate ENCRYPTION_KEY before storing any real API keys";
  } else if (!liveMarketDataConfigured) {
    nextRecommendedAction =
      "Set MARKET_DATA_PROVIDER=kraken in .env for realistic forward tests, or continue with labeled sample data";
  } else if (status === "READY_FOR_PAPER") {
    nextRecommendedAction = "Paper Mode ready — use /api/paper-forward for simulated trades only";
  }

  return {
    status,
    dataSource: liveMarketDataConfigured ? (process.env.MARKET_DATA_PROVIDER ?? "unknown") : "SAMPLE_DATA",
    liveMarketDataConfigured,
    paperModeReady,
    sameDayEvidenceExists,
    missingRequirements,
    nextRecommendedAction,
    paperModeStatus: paperModeReady ? "PAPER_MODE_READY" : "SELECT_PAPER_MODE",
    reasonCodes: [...reasonCodes, ...(vaultPolicy.allowed ? ["VAULT_READY"] : vaultPolicy.blockReasons)],
  };
}
