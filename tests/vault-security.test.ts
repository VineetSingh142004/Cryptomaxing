import { describe, expect, it } from "vitest";
import {
  getEncryptionStatusPublic,
  getVaultWritePolicy,
  isValidEncryptionKey,
} from "@/lib/security/vault-policy";
import { getAuthStatus, isAuthImplemented } from "@/lib/security/auth";
import { assertVaultWriteAllowed } from "@/lib/security/vault-policy";
import { AppError } from "@/lib/security/errors";

describe("encryption key validation", () => {
  it("accepts base64 key with 32+ decoded bytes", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(isValidEncryptionKey(key)).toBe(true);
  });

  it("rejects short or invalid keys", () => {
    expect(isValidEncryptionKey(undefined)).toBe(false);
    expect(isValidEncryptionKey("too-short")).toBe(false);
  });
});

describe("vault write policy", () => {
  it("blocks writes when encryption unsafe in test env", () => {
    const policy = getVaultWritePolicy();
    expect(policy.encryptionProductionSafe).toBe(false);
    expect(policy.blockReasons).toContain("ENCRYPTION_KEY_UNSAFE");
  });

  it("blocks writes when auth not implemented", () => {
    expect(isAuthImplemented()).toBe(false);
    expect(getAuthStatus().status).toBe("AUTH_NOT_IMPLEMENTED");
    expect(getVaultWritePolicy().blockReasons).toContain("AUTH_NOT_IMPLEMENTED");
  });

  it("assertVaultWriteAllowed throws AppError with reason code", () => {
    try {
      assertVaultWriteAllowed();
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(["ENCRYPTION_KEY_UNSAFE", "AUTH_NOT_IMPLEMENTED"]).toContain(err.reasonCode);
    }
  });

  it("getEncryptionStatusPublic never exposes key material", () => {
    const status = getEncryptionStatusPublic();
    expect(JSON.stringify(status)).not.toMatch(/password|secret/i);
    expect(status.keyConfigured).toBe(false);
  });
});
