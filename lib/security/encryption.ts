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
import { isValidEncryptionKey } from "@/lib/security/vault-policy";

export type { EncryptionMethod } from "@/lib/security/crypto-core";
export { maskSecret } from "@/lib/security/crypto-core";
export {
  isValidEncryptionKey,
  getVaultWritePolicy,
  assertVaultWriteAllowed,
} from "@/lib/security/vault-policy";

const DEV_KEY_WARNING =
  "DEV_AES256_GCM encryption is UNSAFE for production. Set ENCRYPTION_KEY (32+ bytes, base64) before storing real API keys.";

const DEV_KEY_SOURCE = "alpha-autopilot-dev-key-UNSAFE-DO-NOT-USE-IN-PRODUCTION";

function getEncryptionKey(): { key: Buffer; method: EncryptionMethod } {
  if (isValidEncryptionKey(env.ENCRYPTION_KEY)) {
    return { key: deriveKey(env.ENCRYPTION_KEY!.trim()), method: "AES256_GCM" };
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is required in production (32+ bytes, base64). Refusing to start vault encryption.",
    );
  }

  logger.warn(DEV_KEY_WARNING);
  return {
    key: deriveKey(DEV_KEY_SOURCE),
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
  keyConfigured: boolean;
} {
  const productionSafe = isValidEncryptionKey(env.ENCRYPTION_KEY);
  if (productionSafe) {
    return {
      method: "AES256_GCM",
      productionSafe: true,
      warning: null,
      keyConfigured: true,
    };
  }
  return {
    method: "DEV_AES256_GCM",
    productionSafe: false,
    warning: DEV_KEY_WARNING,
    keyConfigured: false,
  };
}
