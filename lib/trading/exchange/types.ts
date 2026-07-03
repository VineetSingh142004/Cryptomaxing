export type ReadOnlyReasonCode =

  | "READ_ONLY_KEY_READY"

  | "READ_ONLY_KEY_PARTIAL"

  | "READ_ONLY_KEY_INVALID"

  | "READ_ONLY_KEY_PERMISSION_DENIED"

  | "READ_ONLY_KEY_FORBIDDEN_PERMISSION"

  | "READ_ONLY_API_TIMEOUT"

  | "READ_ONLY_API_PROVIDER_ERROR"

  | "READ_ONLY_API_NOT_CONFIGURED"

  | "READ_ONLY_API_SECRET_DECRYPT_FAILED"

  | "NO_CREDENTIAL_CONFIGURED"

  | "NO_ENABLED_CREDENTIAL"

  | "CREDENTIAL_DISABLED"

  | "CREDENTIAL_DECRYPT_FAILED"

  | "KRAKEN_EAPI_INVALID_KEY"

  | "KRAKEN_EAPI_INVALID_SIGNATURE"

  | "KRAKEN_EGENERAL_PERMISSION_DENIED"

  | "KRAKEN_EGENERAL_INVALID_ARGUMENTS"

  | "READ_ONLY_BALANCE_PERMISSION_MISSING"

  | "READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING"

  | "READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING"

  | "READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING"
  | "KRAKEN_EAPI_INVALID_NONCE";

export type VerificationStatus = "READY" | "PARTIAL" | "FAILED" | "UNKNOWN";

export type EndpointReadStatus = "YES" | "NO" | "EMPTY";

export type KrakenVerifyEndpointName = "Balance" | "OpenOrders" | "ClosedOrders" | "TradesHistory";

export interface KrakenEndpointVerifyResult {
  endpoint: KrakenVerifyEndpointName;
  attempted: boolean;
  success: boolean;
  readStatus: EndpointReadStatus;
  recordCount: number | null;
  reasonCode: ReadOnlyReasonCode;
  krakenErrorCode: string | null;
  safeMessage: string | null;
  latencyMs: number;
  nonceRetryRequired: boolean;
}



export interface ReadOnlyVerificationResult {

  keyFound: boolean;

  provider: string | null;

  credentialEnabled?: boolean;

  verificationStatus: VerificationStatus;

  canReadBalance: boolean;

  canReadOpenOrders: boolean;

  canReadClosedOrders: boolean;

  canReadTradeHistory: boolean;
  tradeHistoryReadStatus: EndpointReadStatus;
  tradeHistoryCount: number | null;
  permissionWarning: string | null;

  reasonCode: ReadOnlyReasonCode;

  lastVerificationReason: string | null;

  endpointResults: KrakenEndpointVerifyResult[];

  safeToUseForReadOnly: boolean;

}



export interface AccountStatusPublic {

  readOnlyKeyConfigured: boolean;

  provider: string | null;

  credentialEnabled: boolean;

  verificationStatus: VerificationStatus;

  lastVerifiedAt: string | null;

  lastVerificationReason: string | null;

  providerHealthy: boolean;

  /** @deprecated use verificationStatus === "READY" */

  permissionsVerifiedAsReadOnly: boolean;

  canReadBalance: boolean;

  canReadOpenOrders: boolean;

  canReadClosedOrders: boolean;

  canReadTradeHistory: boolean;
  tradeHistoryReadStatus: EndpointReadStatus;
  tradeHistoryCount: number | null;
  endpointResults: KrakenEndpointVerifyResult[];

  permissionWarning: string | null;

  krakenError: string | null;

  tradingPermissionDetected: "BLOCKED" | "UNKNOWN" | "NO";

  withdrawalPermissionDetected: "BLOCKED" | "UNKNOWN" | "NO";

  liveTradingLocked: true;

  autoExecutionLocked: true;

}



export interface AccountBalanceEntry {

  asset: string;

  balance: string;

  hold: string | null;

}



export interface AccountBalancesPublic {

  provider: string;

  balances: AccountBalanceEntry[];

  fetchedAt: string;

  dataSource: "read_only_exchange_api";

  note: string;

}



export interface AccountTradeHistoryEntry {

  tradeId: string;

  pair: string;

  type: string;

  price: string;

  volume: string;

  fee: string;

  time: string;

}



export interface AccountTradeHistoryPublic {

  provider: string;

  trades: AccountTradeHistoryEntry[];

  status: "SUCCESS" | "SUCCESS_EMPTY";

  fetchedAt: string;

  dataSource: "read_only_exchange_api";

  note: string;

}



export interface PermissionSelfAttestation {

  noWithdrawalPermission: boolean;

  noTradingPermission: boolean;

  readOnlyConfirmed: boolean;

  ipWhitelistConfirmed: boolean;

  confirmedAt: string;

}



export interface StoredReadOnlyVerification {

  verificationStatus: VerificationStatus;

  canReadBalance: boolean;

  canReadOpenOrders: boolean;

  canReadClosedOrders: boolean;

  canReadTradeHistory: boolean;

  reasonCode: ReadOnlyReasonCode;

  lastVerificationReason: string | null;

  endpointResults: KrakenEndpointVerifyResult[];

  verifiedAt: string;

}


