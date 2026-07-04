import "server-only";

export interface ProviderEnvSettings {
  coingeckoApiKey: string | undefined;
  dexscreenerEnabled: boolean;
  defillamaEnabled: boolean;
  lunarcrushApiKey: string | undefined;
  lunarcrushEnabled: boolean;
}

/** Server-side provider env flags — never expose secrets to client. */
export function getProviderEnvSettings(): ProviderEnvSettings {
  return {
    coingeckoApiKey: process.env.COINGECKO_API_KEY?.trim() || undefined,
    dexscreenerEnabled: process.env.DEXSCREENER_ENABLED !== "false",
    defillamaEnabled: process.env.DEFILLAMA_ENABLED !== "false",
    lunarcrushApiKey: process.env.LUNARCRUSH_API_KEY?.trim() || undefined,
    lunarcrushEnabled: process.env.LUNARCRUSH_ENABLED === "true",
  };
}

export function getProviderEnvSettingsPublic(): Omit<ProviderEnvSettings, "coingeckoApiKey" | "lunarcrushApiKey"> & {
  coingeckoConfigured: boolean;
  lunarcrushConfigured: boolean;
} {
  const env = getProviderEnvSettings();
  return {
    coingeckoConfigured: Boolean(env.coingeckoApiKey),
    dexscreenerEnabled: env.dexscreenerEnabled,
    defillamaEnabled: env.defillamaEnabled,
    lunarcrushConfigured: Boolean(env.lunarcrushApiKey),
    lunarcrushEnabled: env.lunarcrushEnabled,
  };
}
