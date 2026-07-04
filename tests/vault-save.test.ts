import { describe, expect, it } from "vitest";
import {
  assertVaultSaveInput,
  permissionsFromAttestation,
  safeVaultSaveLogContext,
} from "@/lib/vault/save-validation";
import { AppError } from "@/lib/security/errors";
import { formatApiError } from "@/lib/utils/api-error";

describe("vault save validation", () => {
  const validAttestation = {
    noWithdrawalPermission: true,
    noTradingPermission: true,
    readOnlyConfirmed: true,
    ipWhitelistConfirmed: false,
  };

  it("requires API key", () => {
    expect(() =>
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "test",
        apiKey: "",
        apiSecret: "secret",
        permissionSelfAttestation: validAttestation,
      }),
    ).toThrow(AppError);
    try {
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "test",
        apiKey: "",
        apiSecret: "secret",
        permissionSelfAttestation: validAttestation,
      });
    } catch (e) {
      expect((e as AppError).reasonCode).toBe("PROVIDER_API_KEY_MISSING");
    }
  });

  it("requires API secret for Kraken", () => {
    try {
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "test",
        apiKey: "key",
        apiSecret: "",
        permissionSelfAttestation: validAttestation,
      });
    } catch (e) {
      expect((e as AppError).reasonCode).toBe("API_SECRET_MISSING");
    }
  });

  it("does not require read-only attestation for CoinGecko", () => {
    expect(() =>
      assertVaultSaveInput({
        provider: "COINGECKO",
        label: "CoinGecko",
        apiKey: "cg-key",
      }),
    ).not.toThrow();
  });

  it("requires read-only attestation for exchange", () => {
    try {
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "test",
        apiKey: "key",
        apiSecret: "secret",
      });
    } catch (e) {
      expect((e as AppError).reasonCode).toBe("READ_ONLY_ATTESTATION_REQUIRED");
    }
  });

  it("does not require IP whitelist attestation", () => {
    expect(() =>
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "test",
        apiKey: "key",
        apiSecret: "secret",
        permissionSelfAttestation: {
          ...validAttestation,
          ipWhitelistConfirmed: false,
        },
      }),
    ).not.toThrow();
  });

  it("permissionsFromAttestation skips live API check", () => {
    const p = permissionsFromAttestation("KRAKEN");
    expect(p.canTrade).toBe(false);
    expect(p.canWithdraw).toBe(false);
    expect(p.detected).toBe(false);
    expect(p.reasonCode).toBe("READ_ONLY_ATTESTATION_ONLY");
  });

  it("safeVaultSaveLogContext never includes raw secrets", () => {
    const ctx = safeVaultSaveLogContext({
      provider: "KRAKEN",
      label: "Kraken read-only",
      apiKey: "super-secret-key",
      apiSecret: "super-secret-value",
      permissionSelfAttestation: validAttestation,
    });
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("super-secret-value");
    expect(ctx.apiKeyPresent).toBe(true);
    expect(ctx.apiSecretPresent).toBe(true);
    expect(ctx.apiKeyLength).toBe(16);
  });
});

describe("frontend error formatting", () => {
  it("shows reason code and message from flat API error body", () => {
    const msg = formatApiError(
      {
        reasonCode: "API_SECRET_MISSING",
        message: "API secret is required for this provider",
        httpStatus: 400,
      },
      "Vault save failed",
    );
    expect(msg).toContain("[API_SECRET_MISSING]");
    expect(msg).toContain("API secret is required");
  });
});
