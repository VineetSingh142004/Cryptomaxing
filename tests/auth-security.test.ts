import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { evaluateAutoUnlock, defaultAutoUnlockInput, buildAutoUnlockInput } from "@/lib/trading/auto";
import {
  getMarketDataProviderStatus,
  isMarketDataProviderConfigured,
} from "@/lib/trading/paper/safe-check";
import { getVaultReadinessStatus } from "@/lib/security/vault-policy";
import { isLocalOwnerModeAllowed, isLocalOwnerModeUnsafeInProduction } from "@/lib/security/local-owner";

describe("auth gates on auto unlock", () => {
  it("Auto blocked without auth ready", () => {
    const result = evaluateAutoUnlock(
      defaultAutoUnlockInput({ authConfigured: false, authReady: false }),
    );
    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.failedGateIds).toContain("auth_configured");
  });

  it("Auto remains locked in local owner mode with auth gates passed", () => {
    const result = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        executionEngineWired: false,
      }),
    );
    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.reasonCodes).toContain("EXECUTION_ENGINE_NOT_WIRED");
  });

  it("Auto blocked without live evidence even when auth ready", () => {
    const result = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        paperForwardPasses: false,
        shadowLivePasses: false,
      }),
    );
    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.reasonCodes).toContain("PAPER_SHADOW_ONLY");
  });

  it("Auto blocked when today proof weak", () => {
    const result = evaluateAutoUnlock(
      defaultAutoUnlockInput({ weakTodayProof: true, todayMarketProofAvailable: false }),
    );
    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.reasonCodes).toContain("TODAY_PROOF_WEAK");
  });

  it("local owner mode does not bypass reconciliation", () => {
    const result = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        liveReconciliationPasses: false,
      }),
    );
    expect(result.autoExecutionEnabled).toBe(false);
    expect(result.reasonCodes).toContain("NO_LIVE_RECONCILIATION");
  });

  it("returns nextGateToFix and safestNextAction", () => {
    const result = evaluateAutoUnlock(defaultAutoUnlockInput());
    expect(result.failedGateCount).toBeGreaterThan(0);
    expect(result.nextGateToFix).toBeTruthy();
    expect(result.safestNextAction.length).toBeGreaterThan(10);
  });
});

describe("local owner mode auth", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.stubEnv("APP_MODE", "local");
    vi.stubEnv("LOCAL_OWNER_MODE", "true");
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it("isLocalOwnerModeAllowed when flags set", () => {
    expect(isLocalOwnerModeAllowed()).toBe(true);
  });

  it("local owner blocked in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalOwnerModeUnsafeInProduction()).toBe(true);
    expect(isLocalOwnerModeAllowed()).toBe(false);
  });
});

describe("market data provider status", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it("returns NOT_CONFIGURED when missing", () => {
    vi.stubEnv("MARKET_DATA_PROVIDER", "");
    expect(getMarketDataProviderStatus().status).toBe("NOT_CONFIGURED");
    expect(isMarketDataProviderConfigured()).toBe(false);
  });

  it("returns CONFIGURED for kraken", () => {
    vi.stubEnv("MARKET_DATA_PROVIDER", "kraken");
    expect(getMarketDataProviderStatus().status).toBe("CONFIGURED");
    expect(isMarketDataProviderConfigured()).toBe(true);
  });

  it("returns NOT_IMPLEMENTED for unsupported provider", () => {
    vi.stubEnv("MARKET_DATA_PROVIDER", "coingecko");
    expect(getMarketDataProviderStatus().status).toBe(
      "MARKET_DATA_PROVIDER_CONFIGURED_BUT_NOT_IMPLEMENTED",
    );
  });
});

describe("encryption safety", () => {
  it("encryption readiness never exposes key material", () => {
    const status = getVaultReadinessStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
    expect(serialized).not.toContain("secret");
  });
});

describe("buildAutoUnlockInput", () => {
  it("includes auth and encryption status from environment", async () => {
    const input = await buildAutoUnlockInput();
    if (isLocalOwnerModeAllowed()) {
      expect(input.authReady).toBe(true);
    }
    expect(input.encryptionProductionSafe).toBe(false);
  });
});
