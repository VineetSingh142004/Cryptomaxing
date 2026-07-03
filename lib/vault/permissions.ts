import type { ProviderType } from "@prisma/client";
import type { DetectedPermissions } from "@/lib/vault/types";

export interface PermissionDetector {
  provider: ProviderType;
  detect(apiKey: string, apiSecret: string, passphrase?: string): Promise<DetectedPermissions>;
}

/**
 * Permission detection interface.
 * Exchange-specific detectors return NOT_IMPLEMENTED until authenticated endpoints are wired.
 * Withdrawal permission MUST block credential activation.
 */
export async function detectPermissions(
  provider: ProviderType,
  apiKey: string,
  apiSecret: string,
  passphrase?: string,
): Promise<DetectedPermissions> {
  switch (provider) {
    case "KRAKEN":
      return detectKrakenPermissions(apiKey, apiSecret);
    case "COINBASE_ADVANCED":
      return detectCoinbasePermissions(apiKey, apiSecret);
    case "BINANCE":
    case "BINANCE_US":
      return detectBinancePermissions(provider, apiKey, apiSecret);
    case "BYBIT":
      return detectBybitPermissions(apiKey, apiSecret);
    case "COINGECKO":
    case "DEX_SCREENER":
    case "GECKOTERMINAL":
    case "GOPLUS":
      return {
        canRead: true,
        canTrade: false,
        canWithdraw: false,
        detected: true,
        reasonCode: "DATA_PROVIDER_READ_ONLY",
        detail: "Data/security provider — no trade or withdrawal permissions.",
      };
    default:
      return {
        canRead: false,
        canTrade: false,
        canWithdraw: false,
        detected: false,
        reasonCode: "PERMISSION_DETECTION_NOT_IMPLEMENTED",
      };
  }
}

async function detectKrakenPermissions(
  apiKey: string,
  apiSecret: string,
): Promise<DetectedPermissions> {
  const { verifyKrakenReadOnlyKey } = await import("@/lib/trading/exchange/kraken-readonly");

  try {
    const verification = await verifyKrakenReadOnlyKey({ apiKey, apiSecret });
    if (!verification.canReadBalance) {
      return {
        canRead: false,
        canTrade: false,
        canWithdraw: false,
        detected: true,
        reasonCode: verification.reasonCode,
        detail: "Kraken key failed read-only balance check — verify key permissions",
      };
    }

    return {
      canRead: true,
      canTrade: false,
      canWithdraw: false,
      detected: false,
      reasonCode: "KRAKEN_READ_ONLY_UNVERIFIED_PERMISSIONS",
      detail:
        "Read-only endpoints verified. Could not fully verify permissions — confirm manually that this key has no trading or withdrawal permissions.",
    };
  } catch {
    return {
      canRead: false,
      canTrade: false,
      canWithdraw: false,
      detected: false,
      reasonCode: "KRAKEN_PERMISSION_CHECK_FAILED",
      detail: "Could not verify Kraken key — confirm read-only permissions manually before saving.",
    };
  }
}

async function detectCoinbasePermissions(
  _apiKey: string,
  _apiSecret: string,
): Promise<DetectedPermissions> {
  return {
    canRead: true,
    canTrade: false,
    canWithdraw: false,
    detected: false,
    reasonCode: "COINBASE_PERMISSIONS_NOT_IMPLEMENTED",
    detail: "Use view/trade-only keys without transfer. Full permission query NOT_IMPLEMENTED.",
  };
}

async function detectBinancePermissions(
  provider: ProviderType,
  _apiKey: string,
  _apiSecret: string,
): Promise<DetectedPermissions> {
  return {
    canRead: true,
    canTrade: false,
    canWithdraw: false,
    detected: false,
    reasonCode: `${provider}_PERMISSIONS_NOT_IMPLEMENTED`,
    detail: "Enable IP whitelist. Disable withdrawal permission on key. Full detection NOT_IMPLEMENTED.",
  };
}

async function detectBybitPermissions(
  _apiKey: string,
  _apiSecret: string,
): Promise<DetectedPermissions> {
  return {
    canRead: true,
    canTrade: false,
    canWithdraw: false,
    detected: false,
    reasonCode: "BYBIT_PERMISSIONS_NOT_IMPLEMENTED",
    detail: "Bybit restricted in many jurisdictions. Verify legal access. Full detection NOT_IMPLEMENTED.",
  };
}

export function validatePermissionsForStorage(permissions: DetectedPermissions): {
  allowed: boolean;
  status: "ACTIVE" | "BLOCKED_WITHDRAWAL" | "PERMISSION_UNKNOWN";
  reasonCode: string;
} {
  if (permissions.canWithdraw) {
    return {
      allowed: false,
      status: "BLOCKED_WITHDRAWAL",
      reasonCode: "WITHDRAWAL_PERMISSION_BLOCKED",
    };
  }

  if (permissions.canTrade) {
    return {
      allowed: false,
      status: "BLOCKED_WITHDRAWAL",
      reasonCode: "TRADING_PERMISSION_BLOCKED",
    };
  }

  if (!permissions.detected) {
    return {
      allowed: true,
      status: "PERMISSION_UNKNOWN",
      reasonCode: permissions.reasonCode,
    };
  }

  return { allowed: true, status: "ACTIVE", reasonCode: "PERMISSIONS_ACCEPTED" };
}
