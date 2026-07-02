/**
 * Server-side API security helpers.
 * Secrets stay server-side; client mode state is never trusted for Auto authorization.
 */

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function redactSecret(value: string | null | undefined): string {
  if (!value) return "[REDACTED]";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

export function assertServerSideAutoAuthorization(input: {
  clientRequestedAuto: boolean;
  serverAutoAllowed: boolean;
}): { authorized: boolean; reasonCode: string | null } {
  if (input.clientRequestedAuto && !input.serverAutoAllowed) {
    return { authorized: false, reasonCode: "CLIENT_AUTO_NOT_AUTHORIZED" };
  }
  return { authorized: true, reasonCode: null };
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number | null } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: null };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count++;
  return { allowed: true, retryAfterMs: null };
}

export function validateJsonBody<T>(
  body: unknown,
  requiredFields: (keyof T)[],
): { valid: boolean; missing: string[] } {
  if (!body || typeof body !== "object") {
    return { valid: false, missing: requiredFields.map(String) };
  }
  const record = body as Record<string, unknown>;
  const missing = requiredFields.filter((f) => record[f as string] === undefined).map(String);
  return { valid: missing.length === 0, missing };
}

export const SECURITY_RULES = {
  secretsServerSideOnly: true,
  noFrontendKeys: true,
  noWithdrawalPermission: true,
  encryptSecrets: true,
  auditKeyActions: true,
  rateLimitSensitiveEndpoints: true,
  validateInputs: true,
  neverTrustClientModeState: true,
  backendAuthorizedAutoOnly: true,
  redactSecretsInLogs: true,
  emergencyDisableWorks: true,
} as const;
