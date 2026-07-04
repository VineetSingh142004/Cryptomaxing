import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", () => ({
  env: {
    DATABASE_URL: "postgresql://localhost/test",
    NODE_ENV: "test",
    LOG_LEVEL: "error",
  },
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/security/encryption", () => ({
  decryptSecret: vi.fn((value: string) => value),
}));

import { assertVaultSaveInput } from "@/lib/vault/save-validation";
import { AppError } from "@/lib/security/errors";
import { PROVIDER_METADATA } from "@/lib/vault/types";
import {
  buildCoinGeckoAuthHeaders,
  testProviderConnection,
  testPublicProvider,
} from "@/lib/vault/provider-health";
import * as providerSettings from "@/lib/vault/provider-settings";
import { decryptSecret } from "@/lib/security/encryption";

describe("public-only providers", () => {
  it("DeFiLlama does not require API key in metadata", () => {
    expect(PROVIDER_METADATA.DEFILLAMA.requiresApiKey).toBe(false);
  });

  it("DexScreener does not require API key in metadata", () => {
    expect(PROVIDER_METADATA.DEX_SCREENER.requiresApiKey).toBe(false);
  });

  it("CoinGecko API key is optional in metadata", () => {
    expect(PROVIDER_METADATA.COINGECKO.requiresApiKey).toBe(false);
  });

  it("DeFiLlama save without key returns PROVIDER_KEY_NOT_REQUIRED", () => {
    try {
      assertVaultSaveInput({
        provider: "DEFILLAMA",
        label: "DeFiLlama",
        apiKey: "",
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).reasonCode).toBe("PROVIDER_KEY_NOT_REQUIRED");
      expect((e as AppError).message).toContain("Test Connection");
    }
  });

  it("DexScreener save without key returns PROVIDER_KEY_NOT_REQUIRED", () => {
    try {
      assertVaultSaveInput({
        provider: "DEX_SCREENER",
        label: "DexScreener",
        apiKey: "",
      });
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).reasonCode).toBe("PROVIDER_KEY_NOT_REQUIRED");
    }
  });

  it("CoinGecko save without key is allowed", () => {
    expect(() =>
      assertVaultSaveInput({
        provider: "COINGECKO",
        label: "CoinGecko public",
        apiKey: "",
      }),
    ).not.toThrow();
  });
});

describe("CoinGecko connection test", () => {
  beforeEach(() => {
    vi.spyOn(providerSettings, "getProviderEnvSettings").mockReturnValue({
      coingeckoApiKey: undefined,
      dexscreenerEnabled: true,
      defillamaEnabled: true,
      lunarcrushApiKey: undefined,
      lunarcrushEnabled: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses demo header for CG- prefixed keys", () => {
    expect(buildCoinGeckoAuthHeaders("CG-demo-key")).toEqual({
      "x-cg-demo-api-key": "CG-demo-key",
    });
    expect(buildCoinGeckoAuthHeaders("pro-key")).toEqual({
      "x-cg-pro-api-key": "pro-key",
    });
  });

  it("public fallback returns READY_PUBLIC_MODE when no key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ id: "bitcoin" }]), {
          status: 200,
          headers: { "x-ratelimit-remaining": "10" },
        }),
      ),
    );

    const result = await testPublicProvider("COINGECKO");
    expect(result.reasonCode).toBe("READY_PUBLIC_MODE");
    expect(result.publicFallbackUsed).toBe(true);
    expect(result.keyUsed).toBe(false);
  });

  it("prefers env key over public mode", async () => {
    vi.spyOn(providerSettings, "getProviderEnvSettings").mockReturnValue({
      coingeckoApiKey: "env-pro-key",
      dexscreenerEnabled: true,
      defillamaEnabled: true,
      lunarcrushApiKey: undefined,
      lunarcrushEnabled: false,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["x-cg-pro-api-key"]).toBe("env-pro-key");
        return new Response(JSON.stringify([{ id: "bitcoin" }]), { status: 200 });
      }),
    );

    const result = await testPublicProvider("COINGECKO");
    expect(result.reasonCode).toBe("READY_WITH_KEY");
    expect(result.keyUsed).toBe(true);
  });

  it("vault key is used when env key missing", async () => {
    vi.mocked(decryptSecret).mockReturnValue("vault-pro-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["x-cg-pro-api-key"]).toBe("vault-pro-key");
        return new Response(JSON.stringify([{ id: "bitcoin" }]), { status: 200 });
      }),
    );

    const result = await testProviderConnection({
      provider: "COINGECKO",
      encryptedKey: "encrypted",
      encryptedSecret: null,
      encryptedPassphrase: null,
      encryptionMethod: "DEV_AES256_GCM",
    });
    expect(result.reasonCode).toBe("READY_WITH_KEY");
    expect(result.keyUsed).toBe(true);
  });

  it("invalid key returns INVALID_API_KEY", async () => {
    vi.mocked(decryptSecret).mockReturnValue("bad-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );

    const result = await testProviderConnection({
      provider: "COINGECKO",
      encryptedKey: "encrypted",
      encryptedSecret: null,
      encryptedPassphrase: null,
      encryptionMethod: "DEV_AES256_GCM",
    });
    expect(result.reasonCode).toBe("INVALID_API_KEY");
  });

  it("rate limit returns RATE_LIMITED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/coins/markets")) {
          return new Response("Too Many Requests", { status: 429 });
        }
        return new Response(JSON.stringify({ gecko_says: "ok" }), { status: 200 });
      }),
    );

    const result = await testPublicProvider("COINGECKO");
    expect(result.reasonCode).toBe("RATE_LIMITED");
  });

  it("DeFiLlama test uses public endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toMatch(/llama\.fi/);
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const result = await testPublicProvider("DEFILLAMA");
    expect(result.success).toBe(true);
    expect(result.publicFallbackUsed).toBe(true);
    expect(result.keyUsed).toBe(false);
  });
});
