import { getProviderEnvSettings } from "@/lib/vault/provider-settings";
import { getAllPublicProviderTests } from "@/lib/vault/public-provider-store";
import { categoryLabel } from "@/lib/vault/categories";
import { PROVIDER_METADATA } from "@/lib/vault/types";

export interface PublicProviderVaultCard {
  provider: "DEX_SCREENER" | "DEFILLAMA";
  label: string;
  category: string;
  mode: "PUBLIC_ENDPOINT";
  apiKeyRequired: false;
  vaultCredentialRequired: false;
  enabledFromConfig: boolean;
  connectionStatus: "OK" | "ERROR" | "UNKNOWN" | "DISABLED";
  lastTestedAt: string | null;
  endpointTested: string | null;
  latencyMs: number | null;
  reasonCode: string | null;
  usedByScanner: boolean;
  dataUsedFor: string[];
  message: string;
}

export function buildPublicProviderVaultCards(): PublicProviderVaultCard[] {
  const env = getProviderEnvSettings();
  const tests = getAllPublicProviderTests();

  return (["DEX_SCREENER", "DEFILLAMA"] as const).map((provider) => {
    const meta = PROVIDER_METADATA[provider];
    const test = tests[provider];
    const enabled =
      provider === "DEX_SCREENER" ? env.dexscreenerEnabled : env.defillamaEnabled;

    let connectionStatus: PublicProviderVaultCard["connectionStatus"] = "UNKNOWN";
    if (!enabled) connectionStatus = "DISABLED";
    else if (test?.success) connectionStatus = "OK";
    else if (test && !test.success) connectionStatus = "ERROR";

    return {
      provider,
      label: meta.label,
      category: categoryLabel(meta.providerCategory),
      mode: "PUBLIC_ENDPOINT",
      apiKeyRequired: false,
      vaultCredentialRequired: false,
      enabledFromConfig: enabled,
      connectionStatus,
      lastTestedAt: test?.testedAt ?? null,
      endpointTested: test?.endpointTested ?? null,
      latencyMs: test?.latencyMs ?? null,
      reasonCode: test?.reasonCode ?? null,
      usedByScanner: enabled,
      dataUsedFor:
        provider === "DEX_SCREENER"
          ? [
              "DEX liquidity",
              "DEX volume",
              "DEX momentum",
              "Buy/sell pressure (when available)",
            ]
          : ["TVL (global ecosystem)", "Protocol activity", "Chain activity", "Ecosystem strength"],
      message: enabled
        ? "No API key is needed for this provider. Use Test Connection to verify public endpoint access."
        : `${meta.label} is disabled in server config.`,
    };
  });
}
