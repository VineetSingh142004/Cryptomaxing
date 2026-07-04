import type { ProviderType } from "@prisma/client";
import { decryptSecret } from "@/lib/security/encryption";
import { getProviderEnvSettings } from "@/lib/vault/provider-settings";
import { isExchangeCategory } from "@/lib/vault/categories";
import { providerMetaForType, type ConnectionTestResult } from "@/lib/vault/types";

const FETCH_TIMEOUT_MS = 10_000;
const COINGECKO_PING_URL = "https://api.coingecko.com/api/v3/ping";
const COINGECKO_MARKET_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&per_page=1";

export function buildCoinGeckoAuthHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  if (!trimmed) return {};
  const headerName = trimmed.startsWith("CG-") ? "x-cg-demo-api-key" : "x-cg-pro-api-key";
  return { [headerName]: trimmed };
}

function coinGeckoHeaderVariants(apiKey: string): Record<string, string>[] {
  const trimmed = apiKey.trim();
  if (!trimmed) return [{}];
  const primary = buildCoinGeckoAuthHeaders(trimmed);
  const alternateHeader =
    "x-cg-pro-api-key" in primary ? "x-cg-demo-api-key" : "x-cg-pro-api-key";
  return [primary, { [alternateHeader]: trimmed }];
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ response: Response; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testPublicProvider(provider: ProviderType): Promise<ConnectionTestResult> {
  switch (provider) {
    case "COINGECKO":
      return testCoinGeckoPublic();
    case "DEX_SCREENER":
      return testDexScreener();
    case "GECKOTERMINAL":
      return testGeckoTerminal();
    case "DEFILLAMA":
      return testDefiLlama();
    case "LUNARCRUSH":
      return testLunarCrushPublic();
    case "GOPLUS":
      return testGoPlus();
    case "KRAKEN":
      return testKrakenPublic();
    case "COINBASE_ADVANCED":
      return testCoinbasePublic();
    case "BINANCE":
      return testBinancePublic("https://api.binance.com");
    case "BINANCE_US":
      return testBinancePublic("https://api.binance.us");
    case "BYBIT":
      return testBybitPublic();
    default:
      return {
        success: false,
        latencyMs: 0,
        status: "NOT_IMPLEMENTED",
        reasonCode: "PROVIDER_TEST_NOT_IMPLEMENTED",
        message: "Provider connection test not implemented.",
      };
  }
}

async function testKrakenPublic(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch("https://api.kraken.com/0/public/Time");
    return formatResult(response.ok, latencyMs, "KRAKEN_PUBLIC_OK", "KRAKEN_PUBLIC_API_ERROR", "Kraken");
  } catch (e) {
    return fail("KRAKEN_CONNECTION_FAILED", e);
  }
}

async function testCoinbasePublic(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch(
      "https://api.coinbase.com/api/v3/brokerage/market/products?limit=1",
    );
    return formatResult(response.ok, latencyMs, "COINBASE_PUBLIC_OK", "COINBASE_PUBLIC_API_ERROR", "Coinbase");
  } catch (e) {
    return fail("COINBASE_CONNECTION_FAILED", e);
  }
}

async function testBinancePublic(baseUrl: string): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch(`${baseUrl}/api/v3/ping`);
    return formatResult(response.ok, latencyMs, "BINANCE_PUBLIC_OK", "BINANCE_PUBLIC_API_ERROR", "Binance");
  } catch (e) {
    return fail("BINANCE_CONNECTION_FAILED", e);
  }
}

async function testBybitPublic(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch("https://api.bybit.com/v5/market/time");
    return formatResult(response.ok, latencyMs, "BYBIT_PUBLIC_OK", "BYBIT_PUBLIC_API_ERROR", "Bybit");
  } catch (e) {
    return fail("BYBIT_CONNECTION_FAILED", e);
  }
}

async function testCoinGeckoPublic(vaultKey?: string): Promise<ConnectionTestResult> {
  const envKey = getProviderEnvSettings().coingeckoApiKey;
  const key = vaultKey || envKey;
  const endpointTested = COINGECKO_MARKET_URL;

  if (!key) {
    try {
      const ping = await timedFetch(COINGECKO_PING_URL);
      if (ping.response.status === 429) {
        return {
          success: false,
          latencyMs: ping.latencyMs,
          status: "error",
          reasonCode: "RATE_LIMITED",
          message: "CoinGecko rate limited the request. Try again later or use a valid API key.",
          endpointTested: COINGECKO_PING_URL,
          keyUsed: false,
          publicFallbackUsed: true,
        };
      }
      if (!ping.response.ok) {
        return {
          success: false,
          latencyMs: ping.latencyMs,
          status: "error",
          reasonCode: "COINGECKO_UNAVAILABLE",
          message: "CoinGecko API is unavailable. Try again later.",
          endpointTested: COINGECKO_PING_URL,
          keyUsed: false,
          publicFallbackUsed: true,
        };
      }

      const market = await timedFetch(COINGECKO_MARKET_URL);
      const rateLimitRemaining = market.response.headers.get("x-ratelimit-remaining");
      if (market.response.status === 429) {
        return {
          success: false,
          latencyMs: ping.latencyMs + market.latencyMs,
          status: "error",
          reasonCode: "RATE_LIMITED",
          message: "CoinGecko rate limited the request. Try again later or use a valid API key.",
          endpointTested,
          keyUsed: false,
          publicFallbackUsed: true,
          rateLimitStatus: rateLimitRemaining ? `remaining:${rateLimitRemaining}` : null,
        };
      }

      return {
        success: market.response.ok,
        latencyMs: ping.latencyMs + market.latencyMs,
        status: market.response.ok ? "ok" : "error",
        reasonCode: market.response.ok ? "READY_PUBLIC_MODE" : "COINGECKO_UNAVAILABLE",
        message: market.response.ok
          ? "CoinGecko public mode active. Rate limits may be lower."
          : "CoinGecko public market data endpoint failed.",
        planTier: "PUBLIC_FREE",
        endpointTested,
        keyUsed: false,
        publicFallbackUsed: true,
        rateLimitStatus: rateLimitRemaining ? `remaining:${rateLimitRemaining}` : null,
      };
    } catch (e) {
      return {
        ...fail("NETWORK_ERROR", e),
        endpointTested: COINGECKO_PING_URL,
        keyUsed: false,
        publicFallbackUsed: true,
      };
    }
  }

  try {
    let lastLatency = 0;
    for (const headers of coinGeckoHeaderVariants(key)) {
      const ping = await timedFetch(COINGECKO_PING_URL, { headers });
      lastLatency += ping.latencyMs;

      if (ping.response.status === 429) {
        return {
          success: false,
          latencyMs: lastLatency,
          status: "error",
          reasonCode: "RATE_LIMITED",
          message: "CoinGecko rate limited the request. Try again later or use a valid API key.",
          endpointTested: COINGECKO_PING_URL,
          keyUsed: true,
          publicFallbackUsed: false,
        };
      }

      if (ping.response.status === 401 || ping.response.status === 403) {
        continue;
      }

      if (!ping.response.ok) {
        return {
          success: false,
          latencyMs: lastLatency,
          status: "error",
          reasonCode: "COINGECKO_UNAVAILABLE",
          message: "CoinGecko API is unavailable. Try again later.",
          endpointTested: COINGECKO_PING_URL,
          keyUsed: true,
          publicFallbackUsed: false,
        };
      }

      const market = await timedFetch(COINGECKO_MARKET_URL, { headers });
      lastLatency += market.latencyMs;
      const rateLimitRemaining = market.response.headers.get("x-ratelimit-remaining");

      if (market.response.status === 429) {
        return {
          success: false,
          latencyMs: lastLatency,
          status: "error",
          reasonCode: "RATE_LIMITED",
          message: "CoinGecko rate limited the request. Try again later or use a valid API key.",
          endpointTested,
          keyUsed: true,
          publicFallbackUsed: false,
          rateLimitStatus: rateLimitRemaining ? `remaining:${rateLimitRemaining}` : null,
        };
      }

      if (market.response.status === 401 || market.response.status === 403) {
        continue;
      }

      if (market.response.ok) {
        return {
          success: true,
          latencyMs: lastLatency,
          status: "ok",
          reasonCode: "READY_WITH_KEY",
          message: "CoinGecko ping and market data verified with API key.",
          planTier: "API_KEY_CONFIGURED",
          endpointTested,
          keyUsed: true,
          publicFallbackUsed: false,
          rateLimitStatus: rateLimitRemaining ? `remaining:${rateLimitRemaining}` : null,
        };
      }
    }

    return {
      success: false,
      latencyMs: lastLatency,
      status: "error",
      reasonCode: "INVALID_API_KEY",
      message: "CoinGecko key was found but rejected. Recheck the key or delete and re-add it.",
      endpointTested,
      keyUsed: true,
      publicFallbackUsed: false,
    };
  } catch (e) {
    return {
      ...fail("NETWORK_ERROR", e),
      endpointTested: COINGECKO_PING_URL,
      keyUsed: Boolean(key),
      publicFallbackUsed: false,
    };
  }
}

async function testDexScreener(): Promise<ConnectionTestResult> {
  const endpointTested = "https://api.dexscreener.com/latest/dex/search?q=ETH";
  try {
    const { response, latencyMs } = await timedFetch(endpointTested);
    return {
      ...formatResult(
        response.ok,
        latencyMs,
        "DEX_SCREENER_OK",
        "DEX_SCREENER_API_ERROR",
        "DEX Screener",
        "DexScreener public search endpoint reachable.",
      ),
      endpointTested,
      keyUsed: false,
      publicFallbackUsed: true,
    };
  } catch (e) {
    return { ...fail("NETWORK_ERROR", e), endpointTested, keyUsed: false, publicFallbackUsed: true };
  }
}

async function testGeckoTerminal(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch("https://api.geckoterminal.com/api/v2/networks");
    return formatResult(response.ok, latencyMs, "GECKOTERMINAL_OK", "GECKOTERMINAL_API_ERROR", "GeckoTerminal");
  } catch (e) {
    return fail("GECKOTERMINAL_CONNECTION_FAILED", e);
  }
}

async function testDefiLlama(): Promise<ConnectionTestResult> {
  const chainsUrl = "https://api.llama.fi/v2/chains";
  const protocolsUrl = "https://api.llama.fi/protocols";
  try {
    const chains = await timedFetch(chainsUrl);
    if (!chains.response.ok) {
      return {
        ...formatResult(false, chains.latencyMs, "DEFILLAMA_OK", "DEFILLAMA_API_ERROR", "DeFiLlama"),
        endpointTested: chainsUrl,
        keyUsed: false,
        publicFallbackUsed: true,
      };
    }
    const protocols = await timedFetch(protocolsUrl);
    return {
      ...formatResult(
        protocols.response.ok,
        chains.latencyMs + protocols.latencyMs,
        "DEFILLAMA_OK",
        "DEFILLAMA_API_ERROR",
        "DeFiLlama",
        "DeFiLlama chains and protocols endpoints reachable.",
      ),
      endpointTested: protocolsUrl,
      keyUsed: false,
      publicFallbackUsed: true,
    };
  } catch (e) {
    return {
      ...fail("NETWORK_ERROR", e),
      endpointTested: chainsUrl,
      keyUsed: false,
      publicFallbackUsed: true,
    };
  }
}

async function testLunarCrushPublic(apiKey?: string): Promise<ConnectionTestResult> {
  const env = getProviderEnvSettings();
  const key = apiKey || env.lunarcrushApiKey;
  if (!key) {
    return {
      success: false,
      latencyMs: 0,
      status: "degraded",
      reasonCode: "LUNARCRUSH_KEY_NOT_CONFIGURED",
      message: "LunarCrush requires an API key. Set LUNARCRUSH_API_KEY or store a vault credential.",
    };
  }
  if (!env.lunarcrushEnabled) {
    return {
      success: false,
      latencyMs: 0,
      status: "disabled",
      reasonCode: "LUNARCRUSH_DISABLED",
      message: "LunarCrush is disabled. Set LUNARCRUSH_ENABLED=true to enable.",
    };
  }
  try {
    const { response, latencyMs } = await timedFetch(
      "https://lunarcrush.com/api4/public/coins/list/v1?limit=1",
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return formatResult(
      response.ok,
      latencyMs,
      "LUNARCRUSH_OK",
      "LUNARCRUSH_API_ERROR",
      "LunarCrush",
      "LunarCrush social data endpoint reachable.",
    );
  } catch (e) {
    return fail("LUNARCRUSH_CONNECTION_FAILED", e);
  }
}

async function testGoPlus(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch(
      "https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=0xdAC17F958D2ee523a2206206994597C13D831ec7",
    );
    return formatResult(response.ok, latencyMs, "GOPLUS_OK", "GOPLUS_API_ERROR", "GoPlus");
  } catch (e) {
    return fail("GOPLUS_CONNECTION_FAILED", e);
  }
}

function formatResult(
  ok: boolean,
  latencyMs: number,
  okCode: string,
  errCode: string,
  name: string,
  okMessage?: string,
): ConnectionTestResult {
  return ok
    ? {
        success: true,
        latencyMs,
        status: "ok",
        reasonCode: okCode,
        message: okMessage ?? `${name} API reachable.`,
      }
    : { success: false, latencyMs, status: "error", reasonCode: errCode, message: `${name} API error.` };
}

function fail(code: string, error: unknown): ConnectionTestResult {
  return {
    success: false,
    latencyMs: 0,
    status: "error",
    reasonCode: code,
    message: error instanceof Error ? error.message : "Connection failed",
  };
}

export async function testProviderConnection(input: {
  provider: ProviderType;
  encryptedKey: string;
  encryptedSecret: string | null;
  encryptedPassphrase: string | null;
  encryptionMethod: "DEV_AES256_GCM" | "AES256_GCM";
}): Promise<ConnectionTestResult> {
  void input.encryptedPassphrase;
  let apiKey: string | undefined;
  try {
    apiKey = decryptSecret(input.encryptedKey, input.encryptionMethod);
    if (input.encryptedSecret) decryptSecret(input.encryptedSecret, input.encryptionMethod);
  } catch {
    return {
      success: false,
      latencyMs: 0,
      status: "error",
      reasonCode: "DECRYPT_FAILED",
      message: "Failed to decrypt stored credentials",
    };
  }

  const meta = providerMetaForType(input.provider);

  if (input.provider === "COINGECKO") {
    const storedKey = apiKey === "PUBLIC_ENDPOINT" ? undefined : apiKey;
    return testCoinGeckoPublic(storedKey);
  }

  if (input.provider === "LUNARCRUSH") {
    const storedKey = apiKey === "PUBLIC_ENDPOINT" ? undefined : apiKey;
    return testLunarCrushPublic(storedKey);
  }

  const publicTest = await testPublicProvider(input.provider);
  if (!publicTest.success) return publicTest;

  if (isExchangeCategory(meta.providerCategory)) {
    if (input.provider === "KRAKEN" && input.encryptedSecret) {
      try {
        const apiSecret = decryptSecret(input.encryptedSecret, input.encryptionMethod);
        const { verifyKrakenReadOnlyKey } = await import("@/lib/trading/exchange/kraken-readonly");
        const verification = await verifyKrakenReadOnlyKey({ apiKey: apiKey!, apiSecret });
        if (verification.canReadBalance) {
          return {
            success: verification.safeToUseForReadOnly,
            latencyMs: publicTest.latencyMs,
            status: verification.providerHealthy ? "ok" : "error",
            reasonCode: verification.reasonCode,
            message: verification.safeToUseForReadOnly
              ? "Kraken read-only key verified via private Balance endpoint."
              : "Kraken key decrypt OK but read-only verification incomplete.",
          };
        }
        return {
          success: false,
          latencyMs: publicTest.latencyMs,
          status: "error",
          reasonCode: verification.reasonCode,
          message: "Kraken read-only verification failed.",
        };
      } catch {
        return {
          success: false,
          latencyMs: publicTest.latencyMs,
          status: "error",
          reasonCode: "READ_ONLY_API_SECRET_DECRYPT_FAILED",
          message: "Failed to decrypt or verify Kraken credentials",
        };
      }
    }
    return {
      ...publicTest,
      reasonCode: `${input.provider}_PUBLIC_OK`,
      message: `${publicTest.message} Private authenticated test NOT_IMPLEMENTED.`,
    };
  }

  return publicTest;
}
