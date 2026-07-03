const VERIFY_READONLY_MESSAGES: Record<string, string> = {
  NO_CREDENTIAL_CONFIGURED: "No read-only API key is saved.",
  NO_ENABLED_CREDENTIAL: "All saved credentials are disabled. Delete them or save a new key.",
  CREDENTIAL_DISABLED: "Your saved key is disabled. Delete it or save a new read-only key.",
  CREDENTIAL_DECRYPT_FAILED:
    "Stored credential could not be decrypted. Check ENCRYPTION_KEY and re-save the key.",
  READ_ONLY_KEY_INVALID: "API key may be copied incorrectly or disabled on Kraken.",
  READ_ONLY_KEY_PARTIAL: "Some read-only endpoints work; others failed. Check Kraken key permissions.",
  READ_ONLY_KEY_PERMISSION_DENIED: "This key cannot read required account data.",
  READ_ONLY_KEY_FORBIDDEN_PERMISSION: "Trading or withdrawal permission detected — key blocked.",
  READ_ONLY_API_TIMEOUT: "Exchange API timed out. Try again.",
  READ_ONLY_API_PROVIDER_ERROR: "Exchange API returned an error.",
  READ_ONLY_KEY_READY: "Read-only key verified successfully.",
  KRAKEN_EAPI_INVALID_KEY: "API key may be copied incorrectly or disabled on Kraken.",
  KRAKEN_EAPI_INVALID_SIGNATURE: "API secret may be copied incorrectly or signing code is wrong.",
  KRAKEN_EGENERAL_PERMISSION_DENIED: "Kraken denied permission for this endpoint.",
  KRAKEN_EGENERAL_INVALID_ARGUMENTS: "Kraken rejected request arguments.",
  READ_ONLY_BALANCE_PERMISSION_MISSING: "Make sure Kraken API key has Query Funds permission.",
  READ_ONLY_TRADE_HISTORY_PERMISSION_MISSING:
    "Make sure Kraken API key has Query Closed Orders & Trades permission.",
  READ_ONLY_OPEN_ORDERS_PERMISSION_MISSING:
    "Make sure Kraken API key has Query Open Orders & Trades permission.",
  READ_ONLY_CLOSED_ORDERS_PERMISSION_MISSING:
    "Make sure Kraken API key has Query Closed Orders & Trades permission.",
  KRAKEN_EAPI_INVALID_NONCE:
    "Kraken rejected the nonce. Retrying after generating a higher nonce may fix this.",
};

export function formatVerifyReasonMessage(code: unknown): string {
  if (typeof code !== "string") return "";
  return VERIFY_READONLY_MESSAGES[code] ?? "";
}

export function formatVerificationStatusLabel(status: unknown): string {
  if (status === "READY") return "READY";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "FAILED") return "FAILED";
  return "UNKNOWN";
}
