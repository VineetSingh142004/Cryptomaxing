import "server-only";
import { createHash, createHmac } from "crypto";
import type {
  EndpointReadStatus,
  KrakenEndpointVerifyResult,
  KrakenVerifyEndpointName,
  ReadOnlyReasonCode,
} from "@/lib/trading/exchange/types";
import {
  deriveOverallReasonCode,
  deriveVerificationStatus,
  isSafeToUseForReadOnly,
} from "@/lib/trading/exchange/verification-status";
import {
  createKrakenNonceManager,
  isKrakenInvalidNonceError,
  type KrakenNonceManager,
} from "@/lib/trading/exchange/kraken-nonce";

const KRAKEN_PRIVATE_URL = "https://api.kraken.com/0/private";
const DEFAULT_TIMEOUT_MS = 10_000;

const KRAKEN_VERIFY_ENDPOINTS: KrakenVerifyEndpointName[] = [
  "Balance",
  "OpenOrders",
  "ClosedOrders",
  "TradesHistory",
];

/** Strict allowlist — any other endpoint throws READ_ONLY_API_FORBIDS_MUTATION */
export const KRAKEN_READ_ONLY_ENDPOINTS = [
  "Balance",
  "OpenOrders",
  "ClosedOrders",
  "TradesHistory",
  "Ledgers",
  "QueryOrders",
  "QueryTrades",
] as const;

export type KrakenReadOnlyEndpoint = (typeof KRAKEN_READ_ONLY_ENDPOINTS)[number];

const KRAKEN_FORBIDDEN_ENDPOINTS = new Set([
  "AddOrder",
  "AddOrderBatch",
  "CancelOrder",
  "CancelAll",
  "CancelAllOrdersAfter",
  "Withdraw",
  "WithdrawInfo",
  "WithdrawStatus",
  "DepositAddresses",
  "DepositMethods",
  "DepositStatus",
  "Transfer",
  "WalletTransfer",
  "Earn/Allocate",
  "Earn/Deallocate",
  "AddExport",
  "RemoveExport",
]);

export class ReadOnlyApiForbidsMutationError extends Error {
  readonly reasonCode = "READ_ONLY_API_FORBIDS_MUTATION" as const;

  constructor(endpoint: string) {
    super(`READ_ONLY_API_FORBIDS_MUTATION: ${endpoint}`);
    this.name = "ReadOnlyApiForbidsMutationError";
  }
}

export interface KrakenPrivateCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface KrakenPrivateResponse<T = Record<string, unknown>> {
  success: boolean;
  result?: T;
  error?: string[];
  reasonCode: ReadOnlyReasonCode;
  krakenErrorCode: string | null;
  latencyMs: number;
  message?: string;
  nonceRetryRequired?: boolean;
}

export interface KrakenReadOnlyClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  credentialId?: string;
  nonceManager?: KrakenNonceManager;
}

export interface KrakenSignedRequestShape {
  path: string;
  nonce: string;
  postData: string;
  bodyKeys: string[];
  apiSignLength: number;
}

function redactSensitive(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

/** Kraken private REST signing: HMAC-SHA512(path + SHA256(nonce + postData)) */
export function signKrakenRequest(path: string, nonce: string, postData: string, apiSecret: string): string {
  const secretBuffer = Buffer.from(apiSecret, "base64");
  const hash = createHash("sha256").update(nonce + postData).digest();
  return createHmac("sha512", secretBuffer).update(path).update(hash).digest("base64");
}

export function buildKrakenSignedRequestShape(
  endpoint: string,
  apiSecret: string,
  params: Record<string, string> = {},
  nonce?: string,
): KrakenSignedRequestShape {
  const path = `/0/private/${endpoint}`;
  const resolvedNonce = nonce ?? String(Date.now() * 1000);
  const bodyParams = new URLSearchParams({ nonce: resolvedNonce, ...params });
  const postData = bodyParams.toString();
  const apiSign = signKrakenRequest(path, resolvedNonce, postData, apiSecret);
  return {
    path,
    nonce: resolvedNonce,
    postData,
    bodyKeys: [...bodyParams.keys()],
    apiSignLength: apiSign.length,
  };
}

function assertEndpointAllowed(endpoint: string): asserts endpoint is KrakenReadOnlyEndpoint {
  if (KRAKEN_FORBIDDEN_ENDPOINTS.has(endpoint)) {
    throw new ReadOnlyApiForbidsMutationError(endpoint);
  }
  if (!(KRAKEN_READ_ONLY_ENDPOINTS as readonly string[]).includes(endpoint)) {
    throw new ReadOnlyApiForbidsMutationError(endpoint);
  }
}

function mapKrakenErrorToReasonCode(
  errors: string[] | undefined,
  endpoint: KrakenReadOnlyEndpoint,
): ReadOnlyReasonCode {
  const first = errors?.[0] ?? "";
  const upper = first.toUpperCase();

  if (upper.includes("EAPI:INVALID NONCE")) return "KRAKEN_EAPI_INVALID_NONCE";
  if (upper.includes("EAPI:INVALID KEY")) return "KRAKEN_EAPI_INVALID_KEY";
  if (upper.includes("EAPI:INVALID SIGNATURE")) return "KRAKEN_EAPI_INVALID_SIGNATURE";
  if (upper.includes("EGENERAL:INVALID ARGUMENTS")) return "KRAKEN_EGENERAL_INVALID_ARGUMENTS";
  if (upper.includes("EGENERAL:PERMISSION DENIED") || upper.includes("PERMISSION")) {
    if (endpoint === "Balance") return "READ_ONLY_BALANCE_PERMISSION_MISSING";
    if (endpoint === "OpenOrders") return "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING";
    if (endpoint === "ClosedOrders") return "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING";
    if (endpoint === "TradesHistory") return "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING";
    return "KRAKEN_EGENERAL_PERMISSION_DENIED";
  }

  const joined = (errors ?? []).join(" ").toLowerCase();
  if (joined.includes("invalid key") || joined.includes("invalid signature")) {
    return "READ_ONLY_KEY_INVALID";
  }
  if (joined.includes("permission") || joined.includes("denied") || joined.includes("forbidden")) {
    return "READ_ONLY_KEY_PERMISSION_DENIED";
  }
  return "READ_ONLY_API_PROVIDER_ERROR";
}

function safeMessageForReasonCode(reasonCode: ReadOnlyReasonCode): string {
  switch (reasonCode) {
    case "READ_ONLY_BALANCE_PERMISSION_MISSING":
      return "Make sure Kraken API key has Query Funds permission.";
    case "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING":
    case "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING":
      return "Make sure Kraken API key has Query Closed Orders & Trades permission.";
    case "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING":
      return "Make sure Kraken API key has Query Open Orders & Trades permission.";
    case "KRAKEN_EAPI_INVALID_SIGNATURE":
      return "API secret may be copied incorrectly or signing code is wrong.";
    case "KRAKEN_EAPI_INVALID_KEY":
    case "READ_ONLY_KEY_INVALID":
      return "API key may be copied incorrectly or disabled on Kraken.";
    case "KRAKEN_EAPI_INVALID_NONCE":
      return "Kraken rejected the nonce. Retrying after generating a higher nonce may fix this.";
    case "READ_ONLY_API_TIMEOUT":
      return "Kraken API timed out.";
    default:
      return "Kraken API request failed.";
  }
}

function resolveNonceManager(
  credentials: KrakenPrivateCredentials,
  options: KrakenReadOnlyClientOptions,
): KrakenNonceManager {
  return (
    options.nonceManager ??
    createKrakenNonceManager({
      apiKey: credentials.apiKey,
      credentialId: options.credentialId,
    })
  );
}

async function executeKrakenPrivateRequest<T>(
  endpoint: KrakenReadOnlyEndpoint,
  credentials: KrakenPrivateCredentials,
  params: Record<string, string>,
  options: KrakenReadOnlyClientOptions,
  nonce: string,
): Promise<KrakenPrivateResponse<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? KRAKEN_PRIVATE_URL;
  const path = `/0/private/${endpoint}`;
  const bodyParams = new URLSearchParams({ nonce, ...params });
  const postData = bodyParams.toString();
  const apiSign = signKrakenRequest(path, nonce, postData, credentials.apiSecret);

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        "API-Key": credentials.apiKey,
        "API-Sign": apiSign,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: postData,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;
    const rawText = await response.text();
    let parsed: { error?: string[]; result?: T } = {};
    try {
      parsed = JSON.parse(rawText) as { error?: string[]; result?: T };
    } catch {
      return {
        success: false,
        reasonCode: "READ_ONLY_API_PROVIDER_ERROR",
        krakenErrorCode: null,
        latencyMs,
        message: redactSensitive("Invalid JSON from Kraken", credentials.apiSecret),
      };
    }

    if (parsed.error?.length) {
      const reasonCode = mapKrakenErrorToReasonCode(parsed.error, endpoint);
      return {
        success: false,
        error: parsed.error,
        reasonCode,
        krakenErrorCode: parsed.error[0] ?? null,
        latencyMs,
        message: redactSensitive(parsed.error.join(", "), credentials.apiSecret),
      };
    }

    if (!response.ok) {
      return {
        success: false,
        reasonCode: "READ_ONLY_API_PROVIDER_ERROR",
        krakenErrorCode: null,
        latencyMs,
        message: redactSensitive(`HTTP ${response.status}`, credentials.apiSecret),
      };
    }

    return {
      success: true,
      result: parsed.result,
      reasonCode: "READ_ONLY_KEY_READY",
      krakenErrorCode: null,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    if (error instanceof ReadOnlyApiForbidsMutationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        reasonCode: "READ_ONLY_API_TIMEOUT",
        krakenErrorCode: null,
        latencyMs,
        message: "Kraken API request timed out",
      };
    }
    const msg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      reasonCode: "READ_ONLY_API_PROVIDER_ERROR",
      krakenErrorCode: null,
      latencyMs,
      message: redactSensitive(msg, credentials.apiSecret),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function krakenPrivateRequest<T = Record<string, unknown>>(
  endpoint: string,
  credentials: KrakenPrivateCredentials,
  params: Record<string, string> = {},
  options: KrakenReadOnlyClientOptions = {},
): Promise<KrakenPrivateResponse<T>> {
  assertEndpointAllowed(endpoint);

  const nonceManager = resolveNonceManager(credentials, options);
  let nonceRetried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const nonce =
      attempt === 0 ? await nonceManager.nextNonce() : await nonceManager.bumpNonce();
    const result = await executeKrakenPrivateRequest<T>(
      endpoint,
      credentials,
      params,
      options,
      nonce,
    );

    if (result.success) {
      return {
        ...result,
        nonceRetryRequired: nonceRetried,
        message: nonceRetried ? "Nonce retry was required." : undefined,
      };
    }

    if (isKrakenInvalidNonceError(result.error) && attempt === 0) {
      nonceRetried = true;
      continue;
    }

    return result;
  }

  return {
    success: false,
    reasonCode: "KRAKEN_EAPI_INVALID_NONCE",
    krakenErrorCode: "EAPI:Invalid nonce",
    latencyMs: 0,
    message: safeMessageForReasonCode("KRAKEN_EAPI_INVALID_NONCE"),
  };
}

function countTradesHistoryRecords(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const trades = (result as { trades?: Record<string, unknown> }).trades;
  return trades ? Object.keys(trades).length : 0;
}

function endpointReadStatus(
  endpoint: KrakenVerifyEndpointName,
  response: KrakenPrivateResponse,
): { readStatus: EndpointReadStatus; recordCount: number | null } {
  if (!response.success) {
    return { readStatus: "NO", recordCount: null };
  }
  if (endpoint === "TradesHistory") {
    const count = countTradesHistoryRecords(response.result);
    return { readStatus: count === 0 ? "EMPTY" : "YES", recordCount: count };
  }
  return { readStatus: "YES", recordCount: null };
}

async function verifyKrakenEndpoint(
  endpoint: KrakenVerifyEndpointName,
  credentials: KrakenPrivateCredentials,
  options?: KrakenReadOnlyClientOptions,
): Promise<KrakenEndpointVerifyResult> {
  const response = await krakenPrivateRequest(endpoint, credentials, {}, options ?? {});
  const reasonCode = response.success ? "READ_ONLY_KEY_READY" : response.reasonCode;
  const { readStatus, recordCount } = endpointReadStatus(endpoint, response);

  let safeMessage: string | null = null;
  if (!response.success) {
    safeMessage = safeMessageForReasonCode(response.reasonCode) || response.message || null;
  } else if (endpoint === "TradesHistory" && readStatus === "EMPTY") {
    safeMessage = "Trade history readable, but no records returned.";
  } else if (response.nonceRetryRequired) {
    safeMessage = "Nonce retry was required.";
  }

  return {
    endpoint,
    attempted: true,
    success: response.success,
    readStatus,
    recordCount,
    reasonCode,
    krakenErrorCode: response.krakenErrorCode,
    safeMessage,
    latencyMs: response.latencyMs,
    nonceRetryRequired: Boolean(response.nonceRetryRequired),
  };
}

export async function verifyKrakenReadOnlyKey(
  credentials: KrakenPrivateCredentials,
  options?: KrakenReadOnlyClientOptions,
): Promise<{
  canReadBalance: boolean;
  canReadOpenOrders: boolean;
  canReadClosedOrders: boolean;
  canReadTradeHistory: boolean;
  tradeHistoryReadStatus: EndpointReadStatus;
  tradeHistoryCount: number | null;
  verificationStatus: ReturnType<typeof deriveVerificationStatus>;
  reasonCode: ReadOnlyReasonCode;
  lastVerificationReason: string | null;
  permissionWarning: string | null;
  safeToUseForReadOnly: boolean;
  providerHealthy: boolean;
  endpointResults: KrakenEndpointVerifyResult[];
}> {
  const sharedOptions: KrakenReadOnlyClientOptions = {
    ...options,
    nonceManager:
      options?.nonceManager ??
      createKrakenNonceManager({
        apiKey: credentials.apiKey,
        credentialId: options?.credentialId,
      }),
  };

  const endpointResults: KrakenEndpointVerifyResult[] = [];
  for (const endpoint of KRAKEN_VERIFY_ENDPOINTS) {
    endpointResults.push(await verifyKrakenEndpoint(endpoint, credentials, sharedOptions));
  }

  const verificationStatus = deriveVerificationStatus(endpointResults);
  const reasonCode = deriveOverallReasonCode(endpointResults, verificationStatus);

  const byEndpoint = Object.fromEntries(endpointResults.map((r) => [r.endpoint, r])) as Record<
    KrakenVerifyEndpointName,
    KrakenEndpointVerifyResult
  >;

  const tradeHistoryResult = byEndpoint.TradesHistory;
  const canReadBalance = byEndpoint.Balance?.success ?? false;
  const canReadOpenOrders = byEndpoint.OpenOrders?.success ?? false;
  const canReadClosedOrders = byEndpoint.ClosedOrders?.success ?? false;
  const canReadTradeHistory = tradeHistoryResult?.success ?? false;
  const tradeHistoryReadStatus = tradeHistoryResult?.readStatus ?? "NO";
  const tradeHistoryCount = tradeHistoryResult?.recordCount ?? null;

  const nonceFailure = endpointResults.some(
    (r) => !r.success && r.reasonCode === "KRAKEN_EAPI_INVALID_NONCE",
  );
  const failedResults = endpointResults.filter((r) => !r.success);
  const lastVerificationReason =
    nonceFailure
      ? "Nonce issue detected. This is usually a request ordering problem, not necessarily a bad key."
      : failedResults[0]?.safeMessage ??
        (verificationStatus === "READY" ? "All read-only endpoints verified." : null);

  const permissionWarning =
    verificationStatus === "READY"
      ? null
      : "Could not fully verify permissions. Confirm manually that this key has no trading or withdrawal permissions.";

  return {
    canReadBalance,
    canReadOpenOrders,
    canReadClosedOrders,
    canReadTradeHistory,
    tradeHistoryReadStatus,
    tradeHistoryCount,
    verificationStatus,
    reasonCode,
    lastVerificationReason,
    permissionWarning,
    safeToUseForReadOnly: isSafeToUseForReadOnly(verificationStatus),
    providerHealthy: canReadBalance || canReadOpenOrders || canReadTradeHistory,
    endpointResults,
  };
}

export async function fetchKrakenBalances(
  credentials: KrakenPrivateCredentials,
  options?: KrakenReadOnlyClientOptions,
): Promise<KrakenPrivateResponse<Record<string, string>>> {
  return krakenPrivateRequest<Record<string, string>>("Balance", credentials, {}, options);
}

export async function fetchKrakenTradeHistory(
  credentials: KrakenPrivateCredentials,
  options?: KrakenReadOnlyClientOptions,
): Promise<KrakenPrivateResponse<{ trades?: Record<string, unknown> }>> {
  return krakenPrivateRequest<{ trades?: Record<string, unknown> }>(
    "TradesHistory",
    credentials,
    {},
    options,
  );
}

/** Guard for tests — ensures mutation endpoints are rejected */
export function isKrakenMutationEndpoint(endpoint: string): boolean {
  return (
    KRAKEN_FORBIDDEN_ENDPOINTS.has(endpoint) ||
    !KRAKEN_READ_ONLY_ENDPOINTS.includes(endpoint as KrakenReadOnlyEndpoint)
  );
}
