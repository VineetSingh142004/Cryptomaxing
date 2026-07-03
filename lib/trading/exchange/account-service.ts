import "server-only";
import type { ProviderType } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptSecret } from "@/lib/security/encryption";
import { resolveUserId } from "@/lib/security/auth";
import { AppError } from "@/lib/security/errors";
import {
  fetchKrakenBalances,
  fetchKrakenTradeHistory,
  verifyKrakenReadOnlyKey,
} from "@/lib/trading/exchange/kraken-readonly";
import type {
  AccountBalancesPublic,
  AccountStatusPublic,
  AccountTradeHistoryPublic,
  KrakenEndpointVerifyResult,
  EndpointReadStatus,
  ReadOnlyReasonCode,
  ReadOnlyVerificationResult,
  StoredReadOnlyVerification,
  VerificationStatus,
} from "@/lib/trading/exchange/types";
import { isEnabledCredentialStatus, resolveVerifyCredentialSelection } from "@/lib/vault/credential-status";

const EXCHANGE_PROVIDERS = new Set<ProviderType>([
  "KRAKEN",
  "COINBASE_ADVANCED",
  "BINANCE",
  "BINANCE_US",
  "BYBIT",
]);

const MANUAL_PERMISSION_WARNING =
  "Could not fully verify permissions. Confirm manually that this key has no trading or withdrawal permissions.";

async function getActiveExchangeCredential(userId: string) {
  return prisma.providerCredential.findFirst({
    where: {
      userId,
      provider: { in: [...EXCHANGE_PROVIDERS] },
      status: { in: ["ACTIVE", "PERMISSION_UNKNOWN"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function hasAnyExchangeCredential(userId: string): Promise<boolean> {
  const count = await prisma.providerCredential.count({
    where: {
      userId,
      provider: { in: [...EXCHANGE_PROVIDERS] },
    },
  });
  return count > 0;
}

function emptyVerifyResult(reasonCode: ReadOnlyReasonCode, permissionWarning: string | null): ReadOnlyVerificationResult {
  return {
    keyFound: reasonCode === "CREDENTIAL_DISABLED",
    provider: null,
    verificationStatus: "UNKNOWN",
    canReadBalance: false,
    canReadOpenOrders: false,
    canReadClosedOrders: false,
    canReadTradeHistory: false,
    tradeHistoryReadStatus: "NO",
    tradeHistoryCount: null,
    permissionWarning,
    reasonCode,
    lastVerificationReason: permissionWarning,
    endpointResults: [],
    safeToUseForReadOnly: false,
  };
}

function parseStoredVerification(raw: unknown): StoredReadOnlyVerification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const endpointResults = Array.isArray(o.endpointResults)
    ? (o.endpointResults as KrakenEndpointVerifyResult[])
    : [];

  const verificationStatus = o.verificationStatus as VerificationStatus | undefined;
  if (
    !verificationStatus ||
    !["READY", "PARTIAL", "FAILED", "UNKNOWN"].includes(verificationStatus)
  ) {
    // Legacy payload — infer from booleans if present
    const canReadBalance = Boolean(o.canReadBalance);
    const canReadOpenOrders = Boolean(o.canReadOpenOrders);
    const canReadTradeHistory = Boolean(o.canReadTradeHistory);
    const anySuccess = canReadBalance || canReadOpenOrders || canReadTradeHistory;
    return {
      verificationStatus: anySuccess ? (canReadBalance && canReadTradeHistory ? "READY" : "PARTIAL") : "FAILED",
      canReadBalance,
      canReadOpenOrders: Boolean(o.canReadOpenOrders),
      canReadClosedOrders: Boolean(o.canReadClosedOrders),
      canReadTradeHistory,
      reasonCode: (o.reasonCode as ReadOnlyReasonCode) ?? "READ_ONLY_KEY_INVALID",
      lastVerificationReason: typeof o.lastVerificationReason === "string" ? o.lastVerificationReason : null,
      endpointResults,
      verifiedAt: typeof o.verifiedAt === "string" ? o.verifiedAt : new Date().toISOString(),
    };
  }

  return {
    verificationStatus,
    canReadBalance: Boolean(o.canReadBalance),
    canReadOpenOrders: Boolean(o.canReadOpenOrders),
    canReadClosedOrders: Boolean(o.canReadClosedOrders),
    canReadTradeHistory: Boolean(o.canReadTradeHistory),
    reasonCode: (o.reasonCode as ReadOnlyReasonCode) ?? "READ_ONLY_KEY_INVALID",
    lastVerificationReason: typeof o.lastVerificationReason === "string" ? o.lastVerificationReason : null,
    endpointResults,
    verifiedAt: typeof o.verifiedAt === "string" ? o.verifiedAt : new Date().toISOString(),
  };
}

function tradeHistoryMetaFromResults(results: KrakenEndpointVerifyResult[]): {
  tradeHistoryReadStatus: EndpointReadStatus;
  tradeHistoryCount: number | null;
} {
  const th = results.find((r) => r.endpoint === "TradesHistory");
  if (!th) return { tradeHistoryReadStatus: "NO", tradeHistoryCount: null };
  return {
    tradeHistoryReadStatus: th.readStatus ?? (th.success ? "YES" : "NO"),
    tradeHistoryCount: th.recordCount,
  };
}

function emptyAccountStatus(): AccountStatusPublic {
  return {
    readOnlyKeyConfigured: false,
    provider: null,
    credentialEnabled: false,
    verificationStatus: "UNKNOWN",
    lastVerifiedAt: null,
    lastVerificationReason: null,
    providerHealthy: false,
    permissionsVerifiedAsReadOnly: false,
    canReadBalance: false,
    canReadOpenOrders: false,
    canReadClosedOrders: false,
    canReadTradeHistory: false,
    tradeHistoryReadStatus: "NO",
    tradeHistoryCount: null,
    endpointResults: [],
    permissionWarning: null,
    krakenError: null,
    tradingPermissionDetected: "UNKNOWN",
    withdrawalPermissionDetected: "UNKNOWN",
    liveTradingLocked: true,
    autoExecutionLocked: true,
  };
}

function krakenErrorFromResults(results: KrakenEndpointVerifyResult[]): string | null {
  const failed = results.find((r) => r.krakenErrorCode);
  return failed?.krakenErrorCode ?? null;
}

function mapKrakenFailureToAppError(reasonCode: ReadOnlyReasonCode, message: string): AppError {
  if (
    reasonCode === "KRAKEN_EAPI_INVALID_KEY" ||
    reasonCode === "READ_ONLY_KEY_INVALID" ||
    reasonCode === "KRAKEN_EAPI_INVALID_SIGNATURE"
  ) {
    return new AppError("UNAUTHORIZED", message, { reasonCode });
  }
  if (
    reasonCode === "READ_ONLY_BALANCE_PERMISSION_MISSING" ||
    reasonCode === "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING" ||
    reasonCode === "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING" ||
    reasonCode === "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING" ||
    reasonCode === "KRAKEN_EGENERAL_PERMISSION_DENIED" ||
    reasonCode === "READ_ONLY_KEY_PERMISSION_DENIED"
  ) {
    return new AppError("FORBIDDEN", message, { reasonCode });
  }
  if (
    reasonCode === "KRAKEN_EAPI_INVALID_NONCE" ||
    reasonCode === "READ_ONLY_API_TIMEOUT" ||
    reasonCode === "READ_ONLY_API_PROVIDER_ERROR"
  ) {
    return new AppError("BAD_GATEWAY", message, { reasonCode });
  }
  return new AppError("BAD_GATEWAY", message, { reasonCode });
}

async function requireEnabledExchangeCredential(userId: string) {
  const credential = await getActiveExchangeCredential(userId);
  if (credential) return credential;

  if (await hasAnyExchangeCredential(userId)) {
    throw new AppError("FORBIDDEN", "All saved credentials are disabled. Delete them or save a new key.", {
      reasonCode: "NO_ENABLED_CREDENTIAL",
    });
  }

  throw new AppError("NOT_FOUND", "No read-only exchange credential configured", {
    reasonCode: "NO_CREDENTIAL_CONFIGURED",
  });
}

function decryptCredentialSecrets(credential: {
  encryptedKey: string;
  encryptedSecret: string | null;
  encryptionMethod: "DEV_AES256_GCM" | "AES256_GCM";
}): { apiKey: string; apiSecret: string } {
  try {
    const apiKey = decryptSecret(credential.encryptedKey, credential.encryptionMethod);
    if (!credential.encryptedSecret) {
      throw new Error("Missing API secret");
    }
    const apiSecret = decryptSecret(credential.encryptedSecret, credential.encryptionMethod);
    return { apiKey, apiSecret };
  } catch {
    throw new AppError("INTERNAL_ERROR", "Failed to decrypt stored credentials", {
      reasonCode: "READ_ONLY_API_SECRET_DECRYPT_FAILED",
    });
  }
}

export async function verifyReadOnlyCredential(
  credentialId?: string,
): Promise<ReadOnlyVerificationResult> {
  const userId = await resolveUserId({ requireAuth: true });
  const anyExchangeCredentialExists = await hasAnyExchangeCredential(userId);

  const credential = credentialId
    ? await prisma.providerCredential.findFirst({ where: { id: credentialId, userId } })
    : await getActiveExchangeCredential(userId);

  const selection = resolveVerifyCredentialSelection({
    credentialFound: Boolean(credential),
    credentialEnabled: credential ? isEnabledCredentialStatus(credential.status) : false,
    anyExchangeCredentialExists,
  });

  if (selection.kind === "no_credential") {
    return emptyVerifyResult("NO_CREDENTIAL_CONFIGURED", null);
  }
  if (selection.kind === "no_enabled") {
    return emptyVerifyResult(
      "NO_ENABLED_CREDENTIAL",
      "All saved credentials are disabled. Delete them or save a new key.",
    );
  }
  if (selection.kind === "disabled") {
    return {
      ...emptyVerifyResult(
        "CREDENTIAL_DISABLED",
        "Your saved key is disabled. Delete it or save a new read-only key.",
      ),
      keyFound: true,
      provider: credential!.provider,
    };
  }

  if (!credential) {
    return emptyVerifyResult("NO_CREDENTIAL_CONFIGURED", null);
  }

  if (credential.canWithdraw || credential.canTrade) {
    return {
      keyFound: true,
      provider: credential.provider,
      credentialEnabled: true,
      verificationStatus: "FAILED",
      canReadBalance: false,
      canReadOpenOrders: false,
      canReadClosedOrders: false,
      canReadTradeHistory: false,
      tradeHistoryReadStatus: "NO" as const,
      tradeHistoryCount: null,
      permissionWarning: "Trading or withdrawal permission detected — key blocked for read-only use",
      reasonCode: "READ_ONLY_KEY_FORBIDDEN_PERMISSION",
      lastVerificationReason: "Trading or withdrawal permission detected — key blocked for read-only use",
      endpointResults: [],
      safeToUseForReadOnly: false,
    };
  }

  if (credential.provider !== "KRAKEN") {
    return {
      keyFound: true,
      provider: credential.provider,
      credentialEnabled: true,
      verificationStatus: "UNKNOWN",
      canReadBalance: false,
      canReadOpenOrders: false,
      canReadClosedOrders: false,
      canReadTradeHistory: false,
      tradeHistoryReadStatus: "NO" as const,
      tradeHistoryCount: null,
      permissionWarning: `${credential.provider} read-only verification NOT_IMPLEMENTED`,
      reasonCode: "READ_ONLY_API_NOT_CONFIGURED",
      lastVerificationReason: `${credential.provider} read-only verification NOT_IMPLEMENTED`,
      endpointResults: [],
      safeToUseForReadOnly: false,
    };
  }

  let apiKey: string;
  let apiSecret: string;
  try {
    ({ apiKey, apiSecret } = decryptCredentialSecrets(credential));
  } catch (error) {
    if (error instanceof AppError && error.reasonCode === "READ_ONLY_API_SECRET_DECRYPT_FAILED") {
      return {
        keyFound: true,
        provider: credential.provider,
        credentialEnabled: true,
        verificationStatus: "FAILED",
        canReadBalance: false,
        canReadOpenOrders: false,
        canReadClosedOrders: false,
        canReadTradeHistory: false,
        tradeHistoryReadStatus: "NO" as const,
        tradeHistoryCount: null,
        permissionWarning: "Stored credential could not be decrypted",
        reasonCode: "CREDENTIAL_DECRYPT_FAILED",
        lastVerificationReason: "Stored credential could not be decrypted",
        endpointResults: [],
        safeToUseForReadOnly: false,
      };
    }
    throw error;
  }

  const krakenOptions = { credentialId: credential.id };
  const verification = await verifyKrakenReadOnlyKey({ apiKey, apiSecret }, krakenOptions);

  const verificationPayload: StoredReadOnlyVerification = {
    verificationStatus: verification.verificationStatus,
    canReadBalance: verification.canReadBalance,
    canReadOpenOrders: verification.canReadOpenOrders,
    canReadClosedOrders: verification.canReadClosedOrders,
    canReadTradeHistory: verification.canReadTradeHistory,
    reasonCode: verification.reasonCode,
    lastVerificationReason: verification.lastVerificationReason,
    endpointResults: verification.endpointResults,
    verifiedAt: new Date().toISOString(),
  };

  await prisma.providerCredential.update({
    where: { id: credential.id },
    data: {
      lastReadOnlyVerifiedAt: new Date(),
      readonlyVerificationResult: verificationPayload,
      lastConnectionTestAt: new Date(),
      lastConnectionStatus: verification.safeToUseForReadOnly ? "ok" : "error",
      lastHealthCheckAt: new Date(),
      lastHealthStatus: verification.providerHealthy ? "ok" : "error",
    },
  });

  return {
    keyFound: true,
    provider: credential.provider,
    credentialEnabled: true,
    verificationStatus: verification.verificationStatus,
    canReadBalance: verification.canReadBalance,
    canReadOpenOrders: verification.canReadOpenOrders,
    canReadClosedOrders: verification.canReadClosedOrders,
    canReadTradeHistory: verification.canReadTradeHistory,
    tradeHistoryReadStatus: verification.tradeHistoryReadStatus,
    tradeHistoryCount: verification.tradeHistoryCount,
    permissionWarning: verification.permissionWarning,
    reasonCode: verification.reasonCode,
    lastVerificationReason: verification.lastVerificationReason,
    endpointResults: verification.endpointResults,
    safeToUseForReadOnly: verification.safeToUseForReadOnly,
  };
}

export async function getAccountStatus(): Promise<AccountStatusPublic> {
  const userId = await resolveUserId({ requireAuth: true });
  const credential = await getActiveExchangeCredential(userId);

  if (!credential) {
    return emptyAccountStatus();
  }

  const stored = parseStoredVerification(credential.readonlyVerificationResult);
  const tradingPermissionDetected = credential.canTrade
    ? "BLOCKED"
    : credential.permissionDetected
      ? "NO"
      : "UNKNOWN";
  const withdrawalPermissionDetected = credential.canWithdraw
    ? "BLOCKED"
    : credential.permissionDetected
      ? "NO"
      : "UNKNOWN";

  const verificationStatus: VerificationStatus = stored?.verificationStatus ?? "UNKNOWN";
  const endpointResults = stored?.endpointResults ?? [];
  const tradeHistoryMeta = tradeHistoryMetaFromResults(endpointResults);

  return {
    readOnlyKeyConfigured: true,
    provider: credential.provider,
    credentialEnabled: isEnabledCredentialStatus(credential.status),
    verificationStatus,
    lastVerifiedAt: credential.lastReadOnlyVerifiedAt?.toISOString() ?? null,
    lastVerificationReason: stored?.lastVerificationReason ?? null,
    providerHealthy: credential.lastHealthStatus === "ok",
    permissionsVerifiedAsReadOnly: verificationStatus === "READY",
    canReadBalance: stored?.canReadBalance ?? false,
    canReadOpenOrders: stored?.canReadOpenOrders ?? false,
    canReadClosedOrders: stored?.canReadClosedOrders ?? false,
    canReadTradeHistory: stored?.canReadTradeHistory ?? false,
    tradeHistoryReadStatus: tradeHistoryMeta.tradeHistoryReadStatus,
    tradeHistoryCount: tradeHistoryMeta.tradeHistoryCount,
    endpointResults,
    permissionWarning:
      verificationStatus === "READY"
        ? null
        : stored?.lastVerificationReason ??
          (!credential.permissionDetected ? MANUAL_PERMISSION_WARNING : null),
    krakenError: krakenErrorFromResults(endpointResults),
    tradingPermissionDetected,
    withdrawalPermissionDetected,
    liveTradingLocked: true,
    autoExecutionLocked: true,
  };
}

export async function getAccountBalances(): Promise<AccountBalancesPublic> {
  const userId = await resolveUserId({ requireAuth: true });
  const credential = await requireEnabledExchangeCredential(userId);
  if (credential.provider !== "KRAKEN") {
    throw new AppError("NOT_IMPLEMENTED", "Balance read not implemented for this provider", {
      reasonCode: "READ_ONLY_API_NOT_CONFIGURED",
    });
  }

  const { apiKey, apiSecret } = decryptCredentialSecrets(credential);
  const result = await fetchKrakenBalances({ apiKey, apiSecret }, { credentialId: credential.id });
  if (!result.success || !result.result) {
    throw mapKrakenFailureToAppError(
      result.reasonCode,
      result.message ?? "Failed to fetch balances",
    );
  }

  const balances = Object.entries(result.result).map(([asset, balance]) => ({
    asset,
    balance,
    hold: null as string | null,
  }));

  return {
    provider: credential.provider,
    balances,
    fetchedAt: new Date().toISOString(),
    dataSource: "read_only_exchange_api",
    note: "Read-only account balance — not verified live P&L",
  };
}

export async function getAccountTradeHistory(): Promise<AccountTradeHistoryPublic> {
  const userId = await resolveUserId({ requireAuth: true });
  const credential = await requireEnabledExchangeCredential(userId);
  if (credential.provider !== "KRAKEN") {
    throw new AppError("NOT_IMPLEMENTED", "Trade history read not implemented for this provider", {
      reasonCode: "READ_ONLY_API_NOT_CONFIGURED",
    });
  }

  const { apiKey, apiSecret } = decryptCredentialSecrets(credential);
  const result = await fetchKrakenTradeHistory({ apiKey, apiSecret }, { credentialId: credential.id });
  if (!result.success) {
    throw mapKrakenFailureToAppError(
      result.reasonCode,
      result.message ?? "Failed to fetch trade history",
    );
  }

  const tradesRaw = result.result?.trades ?? {};
  const trades = Object.entries(tradesRaw).map(([tradeId, t]) => {
    const trade = t as Record<string, string>;
    return {
      tradeId,
      pair: trade.pair ?? "",
      type: trade.type ?? "",
      price: trade.price ?? "",
      volume: trade.vol ?? trade.volume ?? "",
      fee: trade.fee ?? "",
      time: trade.time ? new Date(Number(trade.time) * 1000).toISOString() : "",
    };
  });

  return {
    provider: credential.provider,
    trades,
    status: trades.length === 0 ? "SUCCESS_EMPTY" : "SUCCESS",
    fetchedAt: new Date().toISOString(),
    dataSource: "read_only_exchange_api",
    note: "Read-only trade history for reconciliation — not verified live P&L until reconciled",
  };
}
