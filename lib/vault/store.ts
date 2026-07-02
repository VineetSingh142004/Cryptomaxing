import { Prisma } from "@prisma/client";
import type { ProviderType, ProviderKeyStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeAuditLog } from "@/lib/logger/audit";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { AppError } from "@/lib/security/errors";
import { getOrCreateSystemUser } from "@/lib/trading/mode-service";
import { testProviderConnection } from "@/lib/vault/provider-health";
import { detectPermissions, validatePermissionsForStorage } from "@/lib/vault/permissions";
import { PROVIDER_METADATA, type ProviderCredentialPublic } from "@/lib/vault/types";

function toPublicCredential(c: {
  id: string;
  provider: ProviderType;
  label: string;
  status: ProviderKeyStatus;
  encryptionMethod: string;
  ipWhitelistRecommended: boolean;
  ipWhitelistConfigured: boolean;
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  permissionDetected: boolean;
  permissionReasonCode: string | null;
  lastConnectionTestAt: Date | null;
  lastConnectionStatus: string | null;
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  lastLatencyMs: number | null;
  encryptedKey: string;
  createdAt: Date;
  updatedAt: Date;
}): ProviderCredentialPublic {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    status: c.status,
    encryptionMethod: c.encryptionMethod,
    ipWhitelistRecommended: c.ipWhitelistRecommended,
    ipWhitelistConfigured: c.ipWhitelistConfigured,
    canRead: c.canRead,
    canTrade: c.canTrade,
    canWithdraw: c.canWithdraw,
    permissionDetected: c.permissionDetected,
    permissionReasonCode: c.permissionReasonCode,
    lastConnectionTestAt: c.lastConnectionTestAt?.toISOString() ?? null,
    lastConnectionStatus: c.lastConnectionStatus,
    lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
    lastHealthStatus: c.lastHealthStatus,
    lastLatencyMs: c.lastLatencyMs,
    keyPreview: maskSecret("key-placeholder"),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listProviderCredentials(): Promise<ProviderCredentialPublic[]> {
  const userId = await getOrCreateSystemUser();
  const credentials = await prisma.providerCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return credentials.map(toPublicCredential);
}

export async function createProviderCredential(input: {
  provider: ProviderType;
  label: string;
  apiKey: string;
  apiSecret?: string;
  passphrase?: string;
  ipWhitelistConfigured?: boolean;
  legallyConfirmed?: boolean;
}): Promise<ProviderCredentialPublic> {
  const meta = PROVIDER_METADATA[input.provider];
  if (!meta.legallySupportedDefault && !input.legallyConfirmed) {
    throw new AppError("FORBIDDEN", `${meta.label} requires legal jurisdiction confirmation`, {
      reasonCode: "LEGAL_JURISDICTION_NOT_CONFIRMED",
    });
  }

  if (meta.requiresSecret && !input.apiSecret) {
    throw new AppError("VALIDATION_ERROR", "API secret is required for this provider", {
      reasonCode: "SECRET_REQUIRED",
    });
  }

  const permissions = await detectPermissions(
    input.provider,
    input.apiKey,
    input.apiSecret ?? "",
    input.passphrase,
  );

  const validation = validatePermissionsForStorage(permissions);
  if (!validation.allowed) {
    throw new AppError("FORBIDDEN", "API keys with withdrawal permission are blocked", {
      reasonCode: validation.reasonCode,
    });
  }

  const encKey = encryptSecret(input.apiKey);
  const encSecret = input.apiSecret ? encryptSecret(input.apiSecret) : null;
  const encPassphrase = input.passphrase ? encryptSecret(input.passphrase) : null;

  const userId = await getOrCreateSystemUser();

  const credential = await prisma.providerCredential.create({
    data: {
      userId,
      provider: input.provider,
      label: input.label,
      encryptedKey: encKey.ciphertext,
      encryptedSecret: encSecret?.ciphertext ?? null,
      encryptedPassphrase: encPassphrase?.ciphertext ?? null,
      encryptionMethod: encKey.method,
      status: validation.status,
      ipWhitelistRecommended: meta.ipWhitelistRecommended,
      ipWhitelistConfigured: input.ipWhitelistConfigured ?? false,
      permissionsMetadata: permissions as unknown as Prisma.InputJsonValue,
      canRead: permissions.canRead,
      canTrade: permissions.canTrade,
      canWithdraw: permissions.canWithdraw,
      permissionDetected: permissions.detected,
      permissionReasonCode: permissions.reasonCode,
    },
  });

  await writeAuditLog({
    userId,
    action: "API_KEY_CREATED",
    entityType: "provider_credential",
    entityId: credential.id,
    reasonCode: validation.reasonCode,
    detail: { provider: input.provider, label: input.label, status: validation.status },
  });

  return toPublicCredential(credential);
}

export async function disableProviderCredential(
  id: string,
  reason: string,
): Promise<ProviderCredentialPublic> {
  const userId = await getOrCreateSystemUser();
  const existing = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }

  const updated = await prisma.providerCredential.update({
    where: { id },
    data: { status: "DISABLED", disabledReason: reason },
  });

  await writeAuditLog({
    userId,
    action: "API_KEY_DISABLED",
    entityType: "provider_credential",
    entityId: id,
    reasonCode: "KEY_DISABLED",
    detail: { reason },
  });

  return toPublicCredential(updated);
}

export async function emergencyDisableAllCredentials(userId?: string): Promise<{ disabledCount: number }> {
  const uid = userId ?? (await getOrCreateSystemUser());
  const result = await prisma.providerCredential.updateMany({
    where: { userId: uid, status: { in: ["ACTIVE", "PERMISSION_UNKNOWN"] } },
    data: { status: "EMERGENCY_DISABLED", disabledReason: "Emergency disable activated" },
  });

  await writeAuditLog({
    userId: uid,
    action: "API_KEY_EMERGENCY_DISABLE",
    reasonCode: "EMERGENCY_DISABLE_ALL",
    detail: { disabledCount: result.count },
  });

  return { disabledCount: result.count };
}

export async function runConnectionTest(id: string): Promise<{
  credential: ProviderCredentialPublic;
  test: Awaited<ReturnType<typeof testProviderConnection>>;
}> {
  const userId = await getOrCreateSystemUser();
  const credential = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!credential) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }

  if (credential.status === "DISABLED" || credential.status === "EMERGENCY_DISABLED") {
    throw new AppError("FORBIDDEN", "Credential is disabled", { reasonCode: "CREDENTIAL_DISABLED" });
  }

  const test = await testProviderConnection({
    provider: credential.provider,
    encryptedKey: credential.encryptedKey,
    encryptedSecret: credential.encryptedSecret,
    encryptedPassphrase: credential.encryptedPassphrase,
    encryptionMethod: credential.encryptionMethod,
  });

  const updated = await prisma.providerCredential.update({
    where: { id },
    data: {
      lastConnectionTestAt: new Date(),
      lastConnectionStatus: test.status,
      lastLatencyMs: test.latencyMs,
      lastHealthCheckAt: new Date(),
      lastHealthStatus: test.success ? "ok" : "error",
    },
  });

  await prisma.providerHealthLog.create({
    data: {
      credentialId: id,
      status: test.status,
      latencyMs: test.latencyMs,
      reasonCode: test.reasonCode,
      detail: { message: test.message, success: test.success },
      checkedAt: new Date(),
    },
  });

  await writeAuditLog({
    userId,
    action: "API_KEY_CONNECTION_TEST",
    entityType: "provider_credential",
    entityId: id,
    reasonCode: test.reasonCode,
    detail: { success: test.success, latencyMs: test.latencyMs },
  });

  return { credential: toPublicCredential(updated), test };
}
