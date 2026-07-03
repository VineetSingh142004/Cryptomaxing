import { getVaultReadinessStatus, getVaultWritePolicy } from "@/lib/security/vault-policy";
import { getMarketDataProviderStatus } from "@/lib/trading/paper/safe-check";
import type { PaperForwardEvidenceStatus } from "@/lib/trading/paper/evidence-requirements";

export type NextStepStatus =
  | "PASS"
  | "BLOCKED"
  | "PARTIAL"
  | "NOT_IMPLEMENTED"
  | "NOT_CONFIGURED"
  | "COLLECTING"
  | "NOT_ENOUGH_DATA";

export interface NextStepItem {
  id: string;
  label: string;
  status: NextStepStatus;
  note?: string;
}

export async function buildNextStepsChecklist(input: {
  authStatus: string;
  authConfigured: boolean;
  modePaperEnabled: boolean;
  autoExecutionEnabled: boolean;
  sameDayEvidenceExists: boolean;
  paperForwardEvidenceStatus?: PaperForwardEvidenceStatus;
  paperForwardEvidenceNote?: string;
}): Promise<{
  items: NextStepItem[];
  messages: string[];
}> {
  const encryption = getVaultReadinessStatus();
  const vaultPolicy = await getVaultWritePolicy();
  const marketData = getMarketDataProviderStatus();
  const dbConnected = Boolean(process.env.DATABASE_URL);

  const authStepStatus: NextStepStatus =
    input.authStatus === "LOCAL_OWNER_MODE"
      ? "PASS"
      : input.authStatus === "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION"
        ? "BLOCKED"
        : input.authStatus === "AUTH_READY"
          ? "PASS"
          : input.authStatus === "AUTH_REQUIRED"
            ? "BLOCKED"
            : "NOT_CONFIGURED";

  const items: NextStepItem[] = [
    {
      id: "database",
      label: "Database connected",
      status: dbConnected ? "PASS" : "BLOCKED",
    },
    {
      id: "auth",
      label: "Auth mode",
      status: authStepStatus,
      note:
        input.authStatus === "LOCAL_OWNER_MODE"
          ? "Local owner mode is acceptable for personal local testing only. Use real auth before deployment or multi-user use."
          : input.authStatus === "AUTH_NOT_CONFIGURED"
            ? "Set APP_MODE=local + LOCAL_OWNER_MODE=true, or configure Supabase Auth"
            : undefined,
    },
    {
      id: "encryption",
      label: "ENCRYPTION_KEY safe",
      status: encryption.encryptionReady ? "PASS" : "BLOCKED",
      note: encryption.safeMessage,
    },
    {
      id: "vault",
      label: "Vault ready",
      status: vaultPolicy.allowed ? "PASS" : "BLOCKED",
      note: vaultPolicy.localOwnerMode
        ? "Vault writes allowed in Local Owner Mode only after ENCRYPTION_KEY is valid"
        : vaultPolicy.blockReasons.join(", ") || undefined,
    },
    {
      id: "paper_mode",
      label: "Paper Mode selectable",
      status: input.modePaperEnabled ? "PASS" : "BLOCKED",
    },
    {
      id: "market_data",
      label: "Market data provider configured",
      status:
        marketData.status === "CONFIGURED"
          ? "PASS"
          : marketData.status === "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED"
            ? "PARTIAL"
            : "NOT_CONFIGURED",
      note:
        marketData.status === "NOT_CONFIGURED"
          ? "Set MARKET_DATA_PROVIDER=kraken in .env"
          : marketData.status === "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED"
            ? `${marketData.provider} configured but provider wiring not implemented`
            : undefined,
    },
    {
      id: "same_day_proof",
      label: "Same-day proof available",
      status: input.sameDayEvidenceExists ? "PARTIAL" : "NOT_ENOUGH_DATA",
    },
    {
      id: "paper_forward",
      label: "Paper-forward evidence available",
      status: input.paperForwardEvidenceStatus ?? "NOT_CONFIGURED",
      note: input.paperForwardEvidenceNote,
    },
    {
      id: "shadow",
      label: "Shadow evidence available",
      status: "NOT_CONFIGURED",
    },
    {
      id: "live_trading",
      label: "Live trading locked",
      status: "PASS",
      note: "Live trading is not ready",
    },
    {
      id: "auto_execution",
      label: "Auto execution locked",
      status: input.autoExecutionEnabled ? "BLOCKED" : "PASS",
    },
  ];

  const messages = [
    "Paper Mode is the only safe testing mode right now.",
    "Auto execution is locked.",
    "Live trading is not ready.",
    input.authStatus === "LOCAL_OWNER_MODE"
      ? "Local Owner Mode active — do not expose this app publicly."
      : "Real API keys require safe encryption and auth (or Local Owner Mode).",
    "Do not use withdrawal-enabled keys.",
    "No verified live P&L exists yet.",
  ];

  return { items, messages };
}
