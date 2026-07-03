import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getEncryptionStatusPublic,
  getVaultWritePolicy,
  isValidEncryptionKey,
  assertVaultWriteAllowed,
  getVaultReadinessStatus,
} from "@/lib/security/vault-policy";
import {
  getAuthStatus,
  isAuthConfigured,
} from "@/lib/security/auth";
import {
  isLocalOwnerModeAllowed,
  isLocalOwnerModeUnsafeInProduction,
} from "@/lib/security/local-owner";
import { AppError } from "@/lib/security/errors";

const VALID_KEY = Buffer.alloc(32, 1).toString("base64");

describe("encryption key validation", () => {
  it("accepts base64 key with exactly 32 decoded bytes", () => {
    expect(isValidEncryptionKey(VALID_KEY)).toBe(true);
  });

  it("rejects short or invalid keys", () => {
    expect(isValidEncryptionKey(undefined)).toBe(false);
    expect(isValidEncryptionKey("too-short")).toBe(false);
  });
});

describe("vault write policy without local owner mode", () => {
  it("blocks writes when encryption unsafe in test env", async () => {
    const policy = await getVaultWritePolicy();
    expect(policy.encryptionProductionSafe).toBe(false);
    expect(policy.blockReasons.some((r) => r.includes("ENCRYPTION"))).toBe(true);
  });

  it("blocks writes when auth not configured and local owner off", async () => {
    if (isLocalOwnerModeAllowed()) return;
    expect(isAuthConfigured()).toBe(false);
    const auth = await getAuthStatus();
    expect(["AUTH_NOT_CONFIGURED", "LOCAL_OWNER_MODE"]).toContain(auth.status);
    const policy = await getVaultWritePolicy();
    if (!isLocalOwnerModeAllowed()) {
      expect(policy.blockReasons).toContain("AUTH_NOT_CONFIGURED");
    }
  });

  it("getEncryptionStatusPublic never exposes key material", () => {
    const status = getEncryptionStatusPublic();
    expect(JSON.stringify(status)).not.toMatch(/password|secret/i);
  });
});

describe("local owner mode vault policy", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.stubEnv("APP_MODE", "local");
    vi.stubEnv("LOCAL_OWNER_MODE", "true");
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it("isLocalOwnerModeAllowed in development", () => {
    expect(isLocalOwnerModeAllowed()).toBe(true);
  });

  it("vault write blocked without ENCRYPTION_KEY in local owner mode", async () => {
    if (!isLocalOwnerModeAllowed()) return;
    vi.stubEnv("ENCRYPTION_KEY", "");
    const policy = await getVaultWritePolicy();
    expect(policy.allowed).toBe(false);
    expect(policy.localOwnerMode).toBe(true);
  });

  it("vault write allowed with valid ENCRYPTION_KEY in local owner mode", async () => {
    if (!isLocalOwnerModeAllowed()) return;
    vi.stubEnv("ENCRYPTION_KEY", VALID_KEY);
    const policy = await getVaultWritePolicy();
    expect(policy.allowed).toBe(true);
    expect(policy.vaultStatus).toBe("VAULT_READY");
  });

  it("local owner mode unsafe in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalOwnerModeUnsafeInProduction()).toBe(true);
  });

  it("assertVaultWriteAllowed throws without encryption key", async () => {
    if (!isLocalOwnerModeAllowed()) return;
    vi.stubEnv("ENCRYPTION_KEY", "");
    try {
      await assertVaultWriteAllowed();
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
    }
  });
});

describe("vault readiness metadata", () => {
  it("getVaultReadinessStatus returns safe public metadata", () => {
    const status = getVaultReadinessStatus();
    expect(status.reasonCode).toBeDefined();
    expect(status.safeMessage).toBeTruthy();
  });
});
