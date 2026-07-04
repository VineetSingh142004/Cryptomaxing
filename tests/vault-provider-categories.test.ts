import { describe, expect, it } from "vitest";
import {
  getProviderCategory,
  isExchangeCategory,
  requiresReadOnlyAttestation,
  tradingPermissionPossible,
  withdrawalPermissionPossible,
  categoryLabel,
} from "@/lib/vault/categories";
import { PROVIDER_METADATA, PROVIDER_TYPES } from "@/lib/vault/types";
import { assertVaultSaveInput } from "@/lib/vault/save-validation";
import { validatePermissionsForStorage, detectPermissions } from "@/lib/vault/permissions";
import { AppError } from "@/lib/security/errors";

describe("provider categories", () => {
  it("maps Kraken to EXCHANGE and CoinGecko to MARKET_DATA", () => {
    expect(getProviderCategory("KRAKEN")).toBe("EXCHANGE");
    expect(getProviderCategory("COINGECKO")).toBe("MARKET_DATA");
    expect(getProviderCategory("DEX_SCREENER")).toBe("DEX_DATA");
    expect(getProviderCategory("DEFILLAMA")).toBe("DEFI_DATA");
    expect(getProviderCategory("LUNARCRUSH")).toBe("SOCIAL_SENTIMENT");
  });

  it("every PROVIDER_TYPE has metadata with matching category", () => {
    for (const id of PROVIDER_TYPES) {
      const meta = PROVIDER_METADATA[id];
      expect(meta.providerCategory).toBe(getProviderCategory(id));
      expect(categoryLabel(meta.providerCategory)).toBeTruthy();
    }
  });

  it("only exchange providers can have trading/withdrawal permissions", () => {
    expect(tradingPermissionPossible("EXCHANGE")).toBe(true);
    expect(withdrawalPermissionPossible("EXCHANGE")).toBe(true);
    expect(tradingPermissionPossible("MARKET_DATA")).toBe(false);
    expect(withdrawalPermissionPossible("MARKET_DATA")).toBe(false);
    expect(tradingPermissionPossible("DEX_DATA")).toBe(false);
    expect(tradingPermissionPossible("SOCIAL_SENTIMENT")).toBe(false);
  });

  it("requires read-only attestation only for exchanges", () => {
    expect(requiresReadOnlyAttestation("EXCHANGE")).toBe(true);
    expect(requiresReadOnlyAttestation("MARKET_DATA")).toBe(false);
    expect(isExchangeCategory("EXCHANGE")).toBe(true);
    expect(isExchangeCategory("DEFI_DATA")).toBe(false);
  });
});

describe("CoinGecko vault save", () => {
  it("does not require read-only attestation for CoinGecko", () => {
    expect(() =>
      assertVaultSaveInput({
        provider: "COINGECKO",
        label: "CoinGecko API",
        apiKey: "cg-test-key",
      }),
    ).not.toThrow();
  });

  it("still requires read-only attestation for Kraken", () => {
    try {
      assertVaultSaveInput({
        provider: "KRAKEN",
        label: "Kraken",
        apiKey: "key",
        apiSecret: "secret",
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).reasonCode).toBe("READ_ONLY_ATTESTATION_REQUIRED");
    }
  });
});

describe("market-data permission detection", () => {
  it("CoinGecko is treated as data provider without trade/withdraw", async () => {
    const p = await detectPermissions("COINGECKO", "key", "");
    expect(p.canTrade).toBe(false);
    expect(p.canWithdraw).toBe(false);
    expect(p.reasonCode).toBe("DATA_PROVIDER_READ_ONLY");
  });

  it("market-data permissions are allowed for storage", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      detected: true,
      reasonCode: "DATA_PROVIDER_READ_ONLY",
    });
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("ACTIVE");
  });
});

describe("exchange safety still enforced", () => {
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

  it("blocks withdrawal permission on save", () => {
    const result = validatePermissionsForStorage({
      canRead: true,
      canTrade: false,
      canWithdraw: true,
      detected: true,
      reasonCode: "WITHDRAWAL_DETECTED",
    });
    expect(result.allowed).toBe(false);
  });
});

describe("provider metadata flags", () => {
  it("CoinGecko metadata marks no trading permission possible", () => {
    const meta = PROVIDER_METADATA.COINGECKO;
    expect(meta.tradingPermissionPossible).toBe(false);
    expect(meta.withdrawalPermissionPossible).toBe(false);
    expect(meta.readOnlyRecommended).toBe(false);
  });

  it("Kraken metadata requires exchange safety", () => {
    const meta = PROVIDER_METADATA.KRAKEN;
    expect(meta.tradingPermissionPossible).toBe(true);
    expect(meta.withdrawalPermissionPossible).toBe(true);
    expect(meta.readOnlyRecommended).toBe(true);
  });
});
