import { getAuthStatus } from "@/lib/security/auth";
import { AppError } from "@/lib/security/errors";

/** ENCRYPTION_KEY must be base64 decoding to at least 32 bytes (e.g. openssl rand -base64 32) */
export function isValidEncryptionKey(key: string | undefined): boolean {
  if (!key || key.trim().length === 0) return false;
  try {
    const decoded = Buffer.from(key.trim(), "base64");
    return decoded.length >= 32;
  } catch {
    return false;
  }
}

export function isEncryptionProductionSafe(): boolean {
  return isValidEncryptionKey(process.env.ENCRYPTION_KEY);
}

export function getVaultWritePolicy(): {
  allowed: boolean;
  blockReasons: string[];
  encryptionProductionSafe: boolean;
  authImplemented: boolean;
} {
  const encryptionProductionSafe = isEncryptionProductionSafe();
  const auth = getAuthStatus();
  const blockReasons: string[] = [];

  if (!encryptionProductionSafe) blockReasons.push("ENCRYPTION_KEY_UNSAFE");
  if (!auth.implemented) blockReasons.push("AUTH_NOT_IMPLEMENTED");

  return {
    allowed: blockReasons.length === 0,
    blockReasons,
    encryptionProductionSafe,
    authImplemented: auth.implemented,
  };
}

export function getEncryptionStatusPublic(): {
  method: "DEV_AES256_GCM" | "AES256_GCM";
  productionSafe: boolean;
  warning: string | null;
  keyConfigured: boolean;
} {
  const productionSafe = isEncryptionProductionSafe();
  if (productionSafe) {
    return { method: "AES256_GCM", productionSafe: true, warning: null, keyConfigured: true };
  }
  return {
    method: "DEV_AES256_GCM",
    productionSafe: false,
    warning:
      "DEV_AES256_GCM encryption is UNSAFE for production. Set ENCRYPTION_KEY (32+ bytes, base64) before storing real API keys.",
    keyConfigured: false,
  };
}

/** Blocks vault writes when encryption is dev-unsafe or auth is missing */
export function assertVaultWriteAllowed(): void {
  const policy = getVaultWritePolicy();
  if (policy.allowed) return;

  const primary = policy.blockReasons[0] ?? "VAULT_WRITE_BLOCKED";
  const messages: Record<string, string> = {
    ENCRYPTION_KEY_UNSAFE:
      "Cannot store API keys — set ENCRYPTION_KEY (32+ bytes, base64) in .env and restart the dev server",
    AUTH_NOT_IMPLEMENTED:
      "Cannot store API keys — user authentication is not implemented yet",
  };

  throw new AppError("FORBIDDEN", messages[primary] ?? "Vault writes are blocked", {
    reasonCode: primary,
    details: { blockReasons: policy.blockReasons },
  });
}
