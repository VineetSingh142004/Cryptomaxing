const CONNECTION_REASON_MESSAGES: Record<string, string> = {
  PROVIDER_KEY_NOT_REQUIRED:
    "This provider uses public endpoints. No API key needs to be saved. Use Test Connection instead.",
  PROVIDER_API_KEY_OPTIONAL:
    "API key is optional. Public endpoints are used when no key is stored.",
  PROVIDER_API_KEY_MISSING: "An API key is required for this provider.",
  READY_WITH_KEY: "Connection verified with API key.",
  READY_PUBLIC_MODE: "CoinGecko public mode active. Rate limits may be lower.",
  INVALID_API_KEY:
    "CoinGecko key was found but rejected. Recheck the key or delete and re-add it.",
  RATE_LIMITED:
    "CoinGecko rate limited the request. Try again later or use a valid API key.",
  COINGECKO_UNAVAILABLE: "CoinGecko API is unavailable. Try again later.",
  NETWORK_ERROR: "Network error while testing the provider connection.",
  NOT_CONFIGURED: "Provider is not configured.",
  DEFILLAMA_OK: "DeFiLlama chains and protocols endpoints reachable.",
  DEX_SCREENER_OK: "DexScreener public search endpoint reachable.",
  DECRYPT_FAILED: "Stored credential could not be decrypted. Re-save the key.",
};

export function formatConnectionReasonMessage(code: unknown): string {
  if (typeof code !== "string") return "";
  return CONNECTION_REASON_MESSAGES[code] ?? "";
}

export function formatConnectionStatusLabel(
  reasonCode: string | null | undefined,
  fallbackStatus: string | null | undefined,
): string {
  if (reasonCode === "READY_WITH_KEY") return "READY_WITH_KEY";
  if (reasonCode === "READY_PUBLIC_MODE") return "READY_PUBLIC_MODE";
  if (reasonCode === "INVALID_API_KEY") return "INVALID_API_KEY";
  if (reasonCode === "RATE_LIMITED") return "RATE_LIMITED";
  if (reasonCode === "COINGECKO_UNAVAILABLE") return "COINGECKO_UNAVAILABLE";
  if (reasonCode === "NETWORK_ERROR") return "NETWORK_ERROR";
  if (reasonCode === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (fallbackStatus === "ok") return "ok";
  if (fallbackStatus === "error") return "error";
  return reasonCode ?? fallbackStatus ?? "unknown";
}
