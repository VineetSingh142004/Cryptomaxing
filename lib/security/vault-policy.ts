import {
  isLocalOwnerModeAllowed,
  isLocalOwnerModeEnabled,
  isLocalOwnerModeUnsafeInProduction,
} from "@/lib/security/local-owner";
import { AppError } from "@/lib/security/errors";

export type EncryptionReasonCode =
  | "ENCRYPTION_READY"
  | "ENCRYPTION_KEY_MISSING"
  | "ENCRYPTION_KEY_INVALID_LENGTH"
  | "ENCRYPTION_KEY_UNSAFE"
  | "DEV_ENCRYPTION_ONLY";

export type VaultStatusReason =
  | "VAULT_READY"
  | "LOCAL_OWNER_MODE_ACTIVE"
  | "ENCRYPTION_KEY_MISSING"
  | "ENCRYPTION_KEY_INVALID_LENGTH"
  | "ENCRYPTION_KEY_UNSAFE"
  | "AUTH_REQUIRED"
  | "AUTH_NOT_CONFIGURED"
  | "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION";

export function isValidEncryptionKey(key: string | undefined): boolean {
  if (!key || key.trim().length === 0) return false;
  try {
    const decoded = Buffer.from(key.trim(), "base64");
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function getEncryptionKeyReasonCode(): EncryptionReasonCode {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.trim().length === 0) {
    return process.env.NODE_ENV === "production"
      ? "ENCRYPTION_KEY_MISSING"
      : "DEV_ENCRYPTION_ONLY";
  }
  try {
    const decoded = Buffer.from(key.trim(), "base64");
    if (decoded.length !== 32) return "ENCRYPTION_KEY_INVALID_LENGTH";
    return "ENCRYPTION_READY";
  } catch {
    return "ENCRYPTION_KEY_UNSAFE";
  }
}

export function isEncryptionProductionSafe(): boolean {
  return getEncryptionKeyReasonCode() === "ENCRYPTION_READY";
}

export function getVaultReadinessStatus(): {
  encryptionReady: boolean;
  reasonCode: EncryptionReasonCode;
  safeMessage: string;
} {
  const reasonCode = getEncryptionKeyReasonCode();
  const messages: Record<EncryptionReasonCode, string> = {
    ENCRYPTION_READY: "Encryption key configured — vault writes allowed in Local Owner Mode",
    ENCRYPTION_KEY_MISSING: "Set ENCRYPTION_KEY in .env before storing real API keys",
    ENCRYPTION_KEY_INVALID_LENGTH:
      "ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)",
    ENCRYPTION_KEY_UNSAFE: "ENCRYPTION_KEY is invalid — use a base64-encoded 32-byte key",
    DEV_ENCRYPTION_ONLY:
      "Vault writes blocked until ENCRYPTION_KEY is set — Local Owner Mode still requires a valid key",
  };
  return {
    encryptionReady: reasonCode === "ENCRYPTION_READY",
    reasonCode,
    safeMessage: messages[reasonCode],
  };
}

export function getEncryptionStatusPublic(): {
  method: "DEV_AES256_GCM" | "AES256_GCM";
  productionSafe: boolean;
  warning: string | null;
  keyConfigured: boolean;
  reasonCode: EncryptionReasonCode;
  safeMessage: string;
} {
  const readiness = getVaultReadinessStatus();
  if (readiness.encryptionReady) {
    return {
      method: "AES256_GCM",
      productionSafe: true,
      warning: null,
      keyConfigured: true,
      reasonCode: readiness.reasonCode,
      safeMessage: readiness.safeMessage,
    };
  }
  return {
    method: "DEV_AES256_GCM",
    productionSafe: false,
    warning: readiness.safeMessage,
    keyConfigured: false,
    reasonCode: readiness.reasonCode,
    safeMessage: readiness.safeMessage,
  };
}

export async function getVaultWritePolicy(): Promise<{
  allowed: boolean;
  blockReasons: string[];
  vaultStatus: VaultStatusReason;
  encryptionProductionSafe: boolean;
  authReady: boolean;
  localOwnerMode: boolean;
  encryptionReasonCode: EncryptionReasonCode;
}> {
  const encryption = getVaultReadinessStatus();
  const blockReasons: string[] = [];

  if (isLocalOwnerModeUnsafeInProduction()) {
    blockReasons.push("LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION");
    return {
      allowed: false,
      blockReasons,
      vaultStatus: "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION",
      encryptionProductionSafe: encryption.encryptionReady,
      authReady: false,
      localOwnerMode: true,
      encryptionReasonCode: encryption.reasonCode,
    };
  }

  if (!encryption.encryptionReady) {
    blockReasons.push(
      encryption.reasonCode === "DEV_ENCRYPTION_ONLY"
        ? "ENCRYPTION_KEY_UNSAFE"
        : encryption.reasonCode,
    );
  }

  if (isLocalOwnerModeAllowed()) {
    return {
      allowed: blockReasons.length === 0,
      blockReasons,
      vaultStatus: blockReasons.length === 0 ? "VAULT_READY" : blockReasons[0] as VaultStatusReason,
      encryptionProductionSafe: encryption.encryptionReady,
      authReady: true,
      localOwnerMode: true,
      encryptionReasonCode: encryption.reasonCode,
    };
  }

  const { isAuthConfigured } = await import("@/lib/security/auth");

  if (!isAuthConfigured()) {
    blockReasons.push("AUTH_NOT_CONFIGURED");
    return {
      allowed: false,
      blockReasons,
      vaultStatus: "AUTH_NOT_CONFIGURED",
      encryptionProductionSafe: encryption.encryptionReady,
      authReady: false,
      localOwnerMode: isLocalOwnerModeEnabled(),
      encryptionReasonCode: encryption.reasonCode,
    };
  }

  const { getAuthStatus } = await import("@/lib/security/auth");
  const auth = await getAuthStatus();

  if (auth.status === "AUTH_REQUIRED") {
    blockReasons.push("AUTH_REQUIRED");
  }

  return {
    allowed: blockReasons.length === 0,
    blockReasons,
    vaultStatus: blockReasons.length === 0 ? "VAULT_READY" : (blockReasons[0] as VaultStatusReason),
    encryptionProductionSafe: encryption.encryptionReady,
    authReady: auth.status === "AUTH_READY",
    localOwnerMode: false,
    encryptionReasonCode: encryption.reasonCode,
  };
}

export async function assertVaultWriteAllowed(): Promise<void> {
  const policy = await getVaultWritePolicy();
  if (policy.allowed) return;

  const primary = policy.blockReasons[0] ?? "VAULT_WRITE_BLOCKED";
  const messages: Record<string, string> = {
    ENCRYPTION_KEY_UNSAFE:
      "Cannot store API keys — set ENCRYPTION_KEY (32 bytes, base64) in .env and restart the dev server",
    ENCRYPTION_KEY_MISSING: "Cannot store API keys — ENCRYPTION_KEY is missing",
    ENCRYPTION_KEY_INVALID_LENGTH:
      "Cannot store API keys — ENCRYPTION_KEY must decode to exactly 32 bytes",
    DEV_ENCRYPTION_ONLY:
      "Cannot store API keys — vault writes allowed in Local Owner Mode only after ENCRYPTION_KEY is valid",
    AUTH_NOT_CONFIGURED: "Cannot store API keys — enable LOCAL_OWNER_MODE or configure Supabase Auth",
    AUTH_REQUIRED: "Cannot store API keys — sign in required",
    LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION:
      "Cannot store API keys — LOCAL_OWNER_MODE is blocked in production",
  };

  throw new AppError("FORBIDDEN", messages[primary] ?? "Vault writes are blocked", {
    reasonCode: primary,
    details: { blockReasons: policy.blockReasons, vaultStatus: policy.vaultStatus },
  });
}
