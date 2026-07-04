import { describe, expect, it } from "vitest";
import { validatePermissionsForStorage } from "@/lib/vault/permissions";
import { buildProfitabilityReport } from "@/lib/trading/reports";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { maskSecret } from "@/lib/security/crypto-core";
import type { ProviderCredentialPublic } from "@/lib/vault/types";

describe("vault read-only permissions", () => {
  it("blocks trading permission on save", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: true,
      canWithdraw: false,
      detected: true,
      reasonCode: "TRADING_DETECTED",
    });
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("TRADING_PERMISSION_BLOCKED");
  });

  it("blocks withdrawal-enabled keys", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: true,
      detected: true,
      reasonCode: "WITHDRAWAL_DETECTED",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows read-only with unknown detection", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      detected: false,
      reasonCode: "KRAKEN_READ_ONLY_UNVERIFIED_PERMISSIONS",
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("PERMISSION_UNKNOWN");
  });
});

describe("public credential shape", () => {
  it("never exposes raw secrets in public credential", () => {
    const pub: ProviderCredentialPublic = {
      id: "1",
      provider: "KRAKEN",
      label: "test",
      providerCategory: "EXCHANGE",
      providerCategoryLabel: "Exchange",
      status: "ACTIVE",
      encryptionMethod: "AES256_GCM",
      ipWhitelistRecommended: true,
      ipWhitelistConfigured: true,
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      permissionDetected: false,
      permissionReasonCode: "KRAKEN_READ_ONLY_UNVERIFIED_PERMISSIONS",
      tradingPermissionPossible: true,
      withdrawalPermissionPossible: true,
      dataAccessVerified: false,
      permissionSelfAttestation: {
        noWithdrawalPermission: true,
        noTradingPermission: true,
        readOnlyConfirmed: true,
        ipWhitelistConfirmed: true,
        confirmedAt: new Date().toISOString(),
      },
      lastReadOnlyVerifiedAt: null,
      lastConnectionTestAt: null,
      lastConnectionStatus: null,
      lastHealthCheckAt: null,
      lastHealthStatus: null,
      lastLatencyMs: null,
      keyPreview: maskSecret("encrypted-preview"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toMatch(/apiSecret|encryptedSecret|encrypted_key/i);
    expect(pub.keyPreview).not.toContain("encrypted-preview");
  });
});

describe("reports read-only separation", () => {
  it("read-only account data does not become fake live P&L", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_000,
      trades: [],
      paperTrades: [
        {
          id: "p1",
          strategyId: "s",
          symbol: "BTC/USD",
          venue: "kraken",
          direction: "long",
          entryTime: "2026-07-01T10:00:00Z",
          exitTime: "2026-07-01T11:00:00Z",
          entryPrice: 100,
          exitPrice: 101,
          size: 1,
          grossPnl: 1,
          fees: 0.1,
          spreadCost: 0,
          slippage: 0,
          funding: 0,
          reconciled: false,
        },
      ],
      readOnlyAccountDataAvailable: true,
      readOnlyTradeCount: 5,
      evidenceLevel: 0,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.verifiedLivePnl).toBeNull();
    expect(r.realizedNetPnl).toBe(0);
    expect(r.paperSimulatedPnl).not.toBeNull();
    expect(r.readOnlyAccountData.available).toBe(true);
    expect(r.profitabilityClaim).toBe("NOT_PROVEN");
  });

  it("verified live P&L remains blank if no real trades exist", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_000,
      trades: [],
      evidenceLevel: 0,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.verifiedLivePnl).toBeNull();
  });

  it("paper P&L remains simulated", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_001,
      trades: [],
      paperTrades: [
        {
          id: "p1",
          strategyId: "s",
          symbol: "BTC/USD",
          venue: "kraken",
          direction: "long",
          entryTime: "2026-07-01T10:00:00Z",
          exitTime: "2026-07-01T11:00:00Z",
          entryPrice: 100,
          exitPrice: 101,
          size: 1,
          grossPnl: 1,
          fees: 0,
          spreadCost: 0,
          slippage: 0,
          funding: 0,
          reconciled: false,
        },
      ],
      evidenceLevel: 0,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.paperSimulatedPnl).toBe(1);
    expect(r.disclaimers.some((d) => d.includes("Paper P&L is simulated"))).toBe(true);
  });
});

describe("auto remains locked with read-only key", () => {
  it("read-only credential does not unlock Auto", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        authConfigured: true,
        authReady: true,
        encryptionProductionSafe: true,
        apiSecure: true,
        noWithdrawalPermission: true,
        executionEngineWired: false,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
    expect(r.reasonCodes).toContain("EXECUTION_ENGINE_NOT_WIRED");
  });
});
