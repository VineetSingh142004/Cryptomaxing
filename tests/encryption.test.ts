import { describe, expect, it } from "vitest";
import { decryptWithKey, deriveKey, encryptWithKey, maskSecret } from "@/lib/security/crypto-core";

describe("encryption", () => {
  it("encrypts and decrypts roundtrip", () => {
    const key = deriveKey("test-key-material");
    const ciphertext = encryptWithKey("test-api-key-secret", key);
    const decrypted = decryptWithKey(ciphertext, key);
    expect(decrypted).toBe("test-api-key-secret");
  });

  it("masks secrets without exposing full value", () => {
    expect(maskSecret("abcdefghij")).not.toBe("abcdefghij");
    expect(maskSecret("abcdefghij")).toContain("*");
  });
});
