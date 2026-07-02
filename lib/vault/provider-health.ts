import type { ProviderType } from "@prisma/client";
import { decryptSecret } from "@/lib/security/encryption";
import type { ConnectionTestResult } from "@/lib/vault/types";

const FETCH_TIMEOUT_MS = 10_000;

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

async function testCoinGeckoPublic(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch("https://api.coingecko.com/api/v3/ping");
    return formatResult(response.ok, latencyMs, "COINGECKO_OK", "COINGECKO_API_ERROR", "CoinGecko");
  } catch (e) {
    return fail("COINGECKO_CONNECTION_FAILED", e);
  }
}

async function testDexScreener(): Promise<ConnectionTestResult> {
  try {
    const { response, latencyMs } = await timedFetch("https://api.dexscreener.com/latest/dex/search?q=ETH");
    return formatResult(response.ok, latencyMs, "DEX_SCREENER_OK", "DEX_SCREENER_API_ERROR", "DEX Screener");
  } catch (e) {
    return fail("DEX_SCREENER_CONNECTION_FAILED", e);
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
): ConnectionTestResult {
  return ok
    ? { success: true, latencyMs, status: "ok", reasonCode: okCode, message: `${name} API reachable.` }
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
  // Data/security providers use public endpoints; exchange providers test public + note auth NOT_IMPLEMENTED
  void input.encryptedPassphrase;
  try {
    decryptSecret(input.encryptedKey, input.encryptionMethod);
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

  const publicTest = await testPublicProvider(input.provider);
  if (!publicTest.success) return publicTest;

  if (PROVIDER_EXCHANGE.has(input.provider)) {
    return {
      ...publicTest,
      reasonCode: `${input.provider}_PUBLIC_OK`,
      message: `${publicTest.message} Private authenticated test NOT_IMPLEMENTED.`,
    };
  }

  return publicTest;
}

const PROVIDER_EXCHANGE = new Set<ProviderType>([
  "KRAKEN",
  "COINBASE_ADVANCED",
  "BINANCE",
  "BINANCE_US",
  "BYBIT",
]);
