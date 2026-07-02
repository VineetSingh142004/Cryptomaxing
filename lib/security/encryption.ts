import "server-only";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import {
  decryptWithKey,
  deriveKey,
  encryptWithKey,
  maskSecret,
  type EncryptionMethod,
} from "@/lib/security/crypto-core";

export type { EncryptionMethod } from "@/lib/security/crypto-core";
export { maskSecret } from "@/lib/security/crypto-core";

const DEV_KEY_WARNING =
  "DEV_AES256_GCM encryption is UNSAFE for production. Set ENCRYPTION_KEY (32+ bytes base64) before live use.";

function getEncryptionKey(): { key: Buffer; method: EncryptionMethod } {
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32) {
    return { key: deriveKey(env.ENCRYPTION_KEY), method: "AES256_GCM" };
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is required in production. Refusing to use dev encryption.",
    );
  }

  logger.warn(DEV_KEY_WARNING);
  return {
    key: deriveKey("alpha-autopilot-dev-key-UNSAFE-DO-NOT-USE-IN-PRODUCTION"),
    method: "DEV_AES256_GCM",
  };
}

export function encryptSecret(plaintext: string): {
  ciphertext: string;
  method: EncryptionMethod;
} {
  const { key, method } = getEncryptionKey();
  return { ciphertext: encryptWithKey(plaintext, key), method };
}

export function decryptSecret(ciphertext: string, method: EncryptionMethod): string {
  const { key } = getEncryptionKey();
  void method;
  return decryptWithKey(ciphertext, key);
}

export function getEncryptionStatus(): {
  method: EncryptionMethod;
  productionSafe: boolean;
  warning: string | null;
} {
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32) {
    return { method: "AES256_GCM", productionSafe: true, warning: null };
  }
  return {
    method: "DEV_AES256_GCM",
    productionSafe: false,
    warning: DEV_KEY_WARNING,
  };
}
