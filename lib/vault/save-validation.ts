import type { ProviderType } from "@prisma/client";
import { AppError } from "@/lib/security/errors";
import { PROVIDER_METADATA } from "@/lib/vault/types";
import type { DetectedPermissions } from "@/lib/vault/types";

export interface VaultSaveInput {
  provider: ProviderType;
  label: string;
  apiKey: string;
  apiSecret?: string;
  permissionSelfAttestation?: {
    noWithdrawalPermission: boolean;
    noTradingPermission: boolean;
    readOnlyConfirmed: boolean;
    ipWhitelistConfirmed: boolean;
  };
}

export function assertVaultSaveInput(input: VaultSaveInput): void {
  const meta = PROVIDER_METADATA[input.provider];
  if (!meta) {
    throw new AppError("VALIDATION_ERROR", "Provider is not supported", {
      reasonCode: "PROVIDER_NOT_SUPPORTED",
    });
  }

  if (!input.label?.trim()) {
    throw new AppError("VALIDATION_ERROR", "Label is required", {
      reasonCode: "VAULT_SAVE_VALIDATION_FAILED",
    });
  }

  if (!input.apiKey?.trim()) {
    throw new AppError("VALIDATION_ERROR", "API key is required", {
      reasonCode: "API_KEY_MISSING",
    });
  }

  if (meta.requiresSecret && !input.apiSecret?.trim()) {
    throw new AppError("VALIDATION_ERROR", "API secret is required for this provider", {
      reasonCode: "API_SECRET_MISSING",
    });
  }

  if (meta.category === "exchange") {
    const att = input.permissionSelfAttestation;
    if (!att) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Exchange keys require read-only self-attestation checklist confirmation",
        { reasonCode: "READ_ONLY_ATTESTATION_REQUIRED" },
      );
    }
    if (!att.noWithdrawalPermission) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Confirm this key has no withdrawal permission",
        { reasonCode: "WITHDRAWAL_PERMISSION_ATTESTATION_MISSING" },
      );
    }
    if (!att.noTradingPermission) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Confirm this key has no trading or order placement permission",
        { reasonCode: "TRADING_PERMISSION_ATTESTATION_MISSING" },
      );
    }
    if (!att.readOnlyConfirmed) {
      throw new AppError("VALIDATION_ERROR", "Confirm this key is read-only", {
        reasonCode: "READ_ONLY_ATTESTATION_REQUIRED",
      });
    }
  }
}

/** Save uses attestation only — live Kraken verify runs on POST /api/vault/verify-readonly */
export function permissionsFromAttestation(provider: ProviderType): DetectedPermissions {
  return {
    canRead: true,
    canTrade: false,
    canWithdraw: false,
    detected: false,
    reasonCode: "READ_ONLY_ATTESTATION_ONLY",
    detail:
      "Saved with read-only self-attestation. Use Verify Read-Only Key to confirm connectivity.",
  };
}

export function safeVaultSaveLogContext(input: VaultSaveInput): Record<string, unknown> {
  const meta = PROVIDER_METADATA[input.provider];
  const att = input.permissionSelfAttestation;
  return {
    provider: input.provider,
    labelLength: input.label?.length ?? 0,
    apiKeyPresent: Boolean(input.apiKey?.trim()),
    apiSecretPresent: Boolean(input.apiSecret?.trim()),
    apiKeyLength: input.apiKey?.trim().length ?? 0,
    apiSecretLength: input.apiSecret?.trim().length ?? 0,
    exchangeCategory: meta?.category === "exchange",
    attestation: att
      ? {
          noWithdrawalPermission: att.noWithdrawalPermission,
          noTradingPermission: att.noTradingPermission,
          readOnlyConfirmed: att.readOnlyConfirmed,
          ipWhitelistConfirmed: att.ipWhitelistConfirmed,
        }
      : null,
  };
}
