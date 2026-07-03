import type {
  KrakenEndpointVerifyResult,
  ReadOnlyReasonCode,
  VerificationStatus,
} from "@/lib/trading/exchange/types";

export function deriveVerificationStatus(
  endpointResults: KrakenEndpointVerifyResult[],
): VerificationStatus {
  if (endpointResults.length === 0) return "UNKNOWN";

  const byEndpoint = Object.fromEntries(endpointResults.map((r) => [r.endpoint, r])) as Record<
    string,
    KrakenEndpointVerifyResult
  >;

  const balance = byEndpoint.Balance?.success ?? false;
  const openOrders = byEndpoint.OpenOrders?.success ?? false;
  const closedOrders = byEndpoint.ClosedOrders?.success ?? false;
  const tradeHistory = byEndpoint.TradesHistory?.success ?? false;

  const anyCoreSuccess = balance || openOrders || tradeHistory;
  if (!anyCoreSuccess && !closedOrders) return "FAILED";
  if (!anyCoreSuccess) return "FAILED";

  const allCoreSuccess =
    balance && openOrders && closedOrders && tradeHistory;
  if (allCoreSuccess) return "READY";

  return "PARTIAL";
}

export function deriveOverallReasonCode(
  endpointResults: KrakenEndpointVerifyResult[],
  verificationStatus: VerificationStatus,
): ReadOnlyReasonCode {
  if (verificationStatus === "READY") return "READ_ONLY_KEY_READY";
  if (verificationStatus === "PARTIAL") return "READ_ONLY_KEY_PARTIAL";

  const invalidKey = endpointResults.some(
    (r) =>
      r.reasonCode === "KRAKEN_EAPI_INVALID_KEY" || r.reasonCode === "READ_ONLY_KEY_INVALID",
  );
  if (invalidKey) return "KRAKEN_EAPI_INVALID_KEY";

  const invalidSig = endpointResults.some(
    (r) => r.reasonCode === "KRAKEN_EAPI_INVALID_SIGNATURE",
  );
  if (invalidSig) return "KRAKEN_EAPI_INVALID_SIGNATURE";

  const invalidNonce = endpointResults.some((r) => r.reasonCode === "KRAKEN_EAPI_INVALID_NONCE");
  if (invalidNonce) return "KRAKEN_EAPI_INVALID_NONCE";

  const allFailed = endpointResults.every((r) => !r.success);
  if (allFailed) {
    const first = endpointResults.find((r) => !r.success);
    if (first?.reasonCode) return first.reasonCode as ReadOnlyReasonCode;
    return "READ_ONLY_KEY_INVALID";
  }

  return "READ_ONLY_KEY_PERMISSION_DENIED";
}

export function isSafeToUseForReadOnly(verificationStatus: VerificationStatus): boolean {
  return verificationStatus === "READY" || verificationStatus === "PARTIAL";
}
