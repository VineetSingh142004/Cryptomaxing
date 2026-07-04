import { getProviderEnvSettings } from "@/lib/vault/provider-settings";
import { getAllPublicProviderTests } from "@/lib/vault/public-provider-store";
import type { RunProviderContributions } from "@/lib/trading/paper/provider-contribution";

export type ProviderConnectionStatus =
  | "READY_WITH_KEY"
  | "READY_PUBLIC_MODE"
  | "READY"
  | "ERROR"
  | "DISABLED"
  | "UNKNOWN";

export type ProviderRunContribution =
  | "CONTRIBUTED"
  | "NOT_USED"
  | "FAILED_THIS_RUN"
  | "SKIPPED_BY_PIPELINE"
  | "DISABLED";

export interface VaultConnectionHint {
  provider: "KRAKEN" | "COINGECKO" | "DEX_SCREENER" | "DEFILLAMA" | "LUNARCRUSH";
  lastConnectionStatus: string | null;
  dataAccessVerified?: boolean;
  enabled?: boolean;
}

export interface ScannerProviderStatusEntry {
  provider: string;
  label: string;
  status: string;
  enabled: boolean;
  mode: string;
  apiKeyRequired: boolean;
  vaultCredentialRequired: boolean;
  usedByScanner: boolean;
  contributedLastRun: boolean;
  connectionStatus: "OK" | "ERROR" | "UNKNOWN" | "DISABLED";
  connectionStatusLabel: ProviderConnectionStatus;
  currentRunContribution: ProviderRunContribution;
  currentRunReason: string | null;
  lastTestedAt: string | null;
  endpointTested: string | null;
}

export interface ScannerProviderStatusPanel {
  providers: ScannerProviderStatusEntry[];
  lastRunContributions: RunProviderContributions | null;
}

function mapVaultConnectionStatus(
  hint: VaultConnectionHint | undefined,
  fallback: ProviderConnectionStatus,
): ProviderConnectionStatus {
  if (!hint) return fallback;
  if (hint.enabled === false) return "DISABLED";
  const code = hint.lastConnectionStatus?.toUpperCase() ?? "";
  if (code.includes("READY_WITH_KEY") || code.includes("READ_ONLY_KEY_READY")) return "READY_WITH_KEY";
  if (code.includes("READY_PUBLIC") || code.endsWith("_OK") || code.includes("_PUBLIC_OK")) {
    return code.includes("KEY") ? "READY_WITH_KEY" : "READY_PUBLIC_MODE";
  }
  if (hint.dataAccessVerified) return "READY";
  if (code.includes("ERROR") || code.includes("FAILED") || code.includes("UNAVAILABLE")) return "ERROR";
  if (hint.lastConnectionStatus) return "READY";
  return fallback;
}

function resolveRunContribution(input: {
  enabled: boolean;
  runStatus?: string;
  contributed?: boolean;
  failedThisRun?: boolean;
  skippedByPipeline?: boolean;
  skipReason?: string;
}): { contribution: ProviderRunContribution; reason: string | null } {
  if (!input.enabled) {
    return { contribution: "DISABLED", reason: "Provider disabled in config" };
  }
  if (input.failedThisRun) {
    return {
      contribution: "FAILED_THIS_RUN",
      reason: input.runStatus ? String(input.runStatus) : "Provider failed this run",
    };
  }
  if (input.skippedByPipeline) {
    return {
      contribution: "SKIPPED_BY_PIPELINE",
      reason: input.skipReason ?? "Not used at this pipeline stage",
    };
  }
  if (input.contributed) {
    return { contribution: "CONTRIBUTED", reason: null };
  }
  return { contribution: "NOT_USED", reason: input.skipReason ?? null };
}

function legacyConnectionStatus(label: ProviderConnectionStatus): ScannerProviderStatusEntry["connectionStatus"] {
  if (label === "DISABLED") return "DISABLED";
  if (label === "ERROR") return "ERROR";
  if (label === "UNKNOWN") return "UNKNOWN";
  return "OK";
}

function statusLabelFromConnection(connection: ProviderConnectionStatus): string {
  return connection;
}

export function buildScannerProviderStatus(input?: {
  coingeckoStatus?: string;
  krakenStatus?: string;
  dexscreenerStatus?: string;
  defillamaStatus?: string;
  lunarcrushStatus?: string;
  runContributions?: RunProviderContributions | null;
  vaultConnections?: VaultConnectionHint[];
}): ScannerProviderStatusPanel {
  const env = getProviderEnvSettings();
  const publicTests = getAllPublicProviderTests();
  const contrib = input?.runContributions ?? null;
  const vaultByProvider = new Map(
    (input?.vaultConnections ?? []).map((hint) => [hint.provider, hint]),
  );

  const dexTest = publicTests.DEX_SCREENER;
  const defiTest = publicTests.DEFILLAMA;

  const krakenVault = vaultByProvider.get("KRAKEN");
  const coingeckoVault = vaultByProvider.get("COINGECKO");

  const krakenConnection = mapVaultConnectionStatus(
    krakenVault,
    input?.krakenStatus === "ok" ? "READY" : input?.krakenStatus === "unavailable" ? "ERROR" : "UNKNOWN",
  );
  const coingeckoConnection = mapVaultConnectionStatus(
    coingeckoVault,
    env.coingeckoApiKey
      ? "READY_WITH_KEY"
      : input?.coingeckoStatus === "ok"
        ? "READY_PUBLIC_MODE"
        : input?.coingeckoStatus === "unavailable"
          ? "ERROR"
          : "READY_PUBLIC_MODE",
  );

  const krakenRun = resolveRunContribution({
    enabled: true,
    runStatus: input?.krakenStatus,
    contributed: contrib?.krakenContributed ?? input?.krakenStatus === "ok",
    failedThisRun: input?.krakenStatus === "unavailable",
    skipReason: input?.krakenStatus === "unavailable" ? "KRAKEN_UNAVAILABLE" : null,
  });

  const coingeckoRun = resolveRunContribution({
    enabled: true,
    runStatus: input?.coingeckoStatus,
    contributed: contrib?.coingeckoContributed ?? input?.coingeckoStatus === "ok",
    failedThisRun: input?.coingeckoStatus === "unavailable",
    skipReason:
      input?.coingeckoStatus === "skipped"
        ? "Not configured for discovery"
        : input?.coingeckoStatus === "unavailable"
          ? "CoinGecko fetch failed"
          : null,
  });

  const dexEnabled = env.dexscreenerEnabled;
  const dexConnection: ProviderConnectionStatus = !dexEnabled
    ? "DISABLED"
    : dexTest?.success || input?.dexscreenerStatus === "ok"
      ? "READY_PUBLIC_MODE"
      : dexTest && !dexTest.success
        ? "ERROR"
        : input?.dexscreenerStatus === "unavailable"
          ? "ERROR"
          : "READY_PUBLIC_MODE";

  const dexRun = resolveRunContribution({
    enabled: dexEnabled,
    contributed: contrib?.dexscreenerContributed ?? false,
    skippedByPipeline: dexEnabled && !contrib?.dexscreenerContributed,
    skipReason: "Only used for deep candidate enrichment",
  });

  const defiEnabled = env.defillamaEnabled;
  const defiConnection: ProviderConnectionStatus = !defiEnabled
    ? "DISABLED"
    : defiTest?.success || input?.defillamaStatus === "ok"
      ? "READY_PUBLIC_MODE"
      : defiTest && !defiTest.success
        ? "ERROR"
        : input?.defillamaStatus === "unavailable"
          ? "ERROR"
          : "READY_PUBLIC_MODE";

  const defiRun = resolveRunContribution({
    enabled: defiEnabled,
    contributed: contrib?.defillamaContributed ?? false,
    skippedByPipeline: defiEnabled && !contrib?.defillamaContributed,
    skipReason: "No mapped protocol data for most candidates",
  });

  const providers: ScannerProviderStatusEntry[] = [
    {
      provider: "KRAKEN",
      label: "Kraken",
      status: statusLabelFromConnection(krakenConnection),
      enabled: true,
      mode: "EXCHANGE_READ_ONLY",
      apiKeyRequired: true,
      vaultCredentialRequired: true,
      usedByScanner: true,
      contributedLastRun: krakenRun.contribution === "CONTRIBUTED",
      connectionStatus: legacyConnectionStatus(krakenConnection),
      connectionStatusLabel: krakenConnection,
      currentRunContribution: krakenRun.contribution,
      currentRunReason: krakenRun.reason,
      lastTestedAt: null,
      endpointTested: null,
    },
    {
      provider: "COINGECKO",
      label: "CoinGecko",
      status: statusLabelFromConnection(coingeckoConnection),
      enabled: true,
      mode: env.coingeckoApiKey ? "API_KEY_OR_PUBLIC" : "PUBLIC_ENDPOINT",
      apiKeyRequired: false,
      vaultCredentialRequired: false,
      usedByScanner: true,
      contributedLastRun: coingeckoRun.contribution === "CONTRIBUTED",
      connectionStatus: legacyConnectionStatus(coingeckoConnection),
      connectionStatusLabel: coingeckoConnection,
      currentRunContribution: coingeckoRun.contribution,
      currentRunReason: coingeckoRun.reason,
      lastTestedAt: null,
      endpointTested: null,
    },
    {
      provider: "DEX_SCREENER",
      label: "DexScreener",
      status: statusLabelFromConnection(dexConnection),
      enabled: dexEnabled,
      mode: "PUBLIC_ENDPOINT",
      apiKeyRequired: false,
      vaultCredentialRequired: false,
      usedByScanner: dexEnabled,
      contributedLastRun: dexRun.contribution === "CONTRIBUTED",
      connectionStatus: legacyConnectionStatus(dexConnection),
      connectionStatusLabel: dexConnection,
      currentRunContribution: dexRun.contribution,
      currentRunReason: dexRun.reason,
      lastTestedAt: dexTest?.testedAt ?? null,
      endpointTested: dexTest?.endpointTested ?? null,
    },
    {
      provider: "DEFILLAMA",
      label: "DeFiLlama",
      status: statusLabelFromConnection(defiConnection),
      enabled: defiEnabled,
      mode: "PUBLIC_ENDPOINT",
      apiKeyRequired: false,
      vaultCredentialRequired: false,
      usedByScanner: defiEnabled,
      contributedLastRun: defiRun.contribution === "CONTRIBUTED",
      connectionStatus: legacyConnectionStatus(defiConnection),
      connectionStatusLabel: defiConnection,
      currentRunContribution: defiRun.contribution,
      currentRunReason: defiRun.reason,
      lastTestedAt: defiTest?.testedAt ?? null,
      endpointTested: defiTest?.endpointTested ?? null,
    },
    {
      provider: "LUNARCRUSH",
      label: "LunarCrush",
      status: env.lunarcrushEnabled ? "READY_WITH_KEY" : "DISABLED",
      enabled: env.lunarcrushEnabled,
      mode: env.lunarcrushApiKey ? "API_KEY" : "NOT_CONFIGURED",
      apiKeyRequired: true,
      vaultCredentialRequired: false,
      usedByScanner: env.lunarcrushEnabled && input?.lunarcrushStatus === "ok",
      contributedLastRun: contrib?.lunarcrushContributed ?? false,
      connectionStatus: env.lunarcrushEnabled ? "UNKNOWN" : "DISABLED",
      connectionStatusLabel: env.lunarcrushEnabled ? "UNKNOWN" : "DISABLED",
      currentRunContribution: env.lunarcrushEnabled ? "NOT_USED" : "DISABLED",
      currentRunReason: env.lunarcrushEnabled ? "Not wired into scanner pipeline" : null,
      lastTestedAt: null,
      endpointTested: null,
    },
  ];

  return { providers, lastRunContributions: contrib };
}

export function vaultHintsFromCredentials(
  credentials: Array<{
    provider: string;
    lastConnectionStatus: string | null;
    dataAccessVerified?: boolean;
    status?: string;
  }>,
): VaultConnectionHint[] {
  return credentials
    .filter((c) =>
      ["KRAKEN", "COINGECKO", "DEX_SCREENER", "DEFILLAMA", "LUNARCRUSH"].includes(c.provider),
    )
    .map((c) => ({
      provider: c.provider as VaultConnectionHint["provider"],
      lastConnectionStatus: c.lastConnectionStatus,
      dataAccessVerified: c.dataAccessVerified,
      enabled: c.status !== "DISABLED",
    }));
}
