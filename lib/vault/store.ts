import { Prisma } from "@prisma/client";
import type { ProviderType, ProviderKeyStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeAuditLog } from "@/lib/logger/audit";
import { assertVaultWriteAllowed } from "@/lib/security/vault-policy";
import { encryptSecret, maskSecret } from "@/lib/security/encryption";
import { resolveUserId, assertUserOwnsResource } from "@/lib/security/auth";
import { AppError } from "@/lib/security/errors";
import { testProviderConnection } from "@/lib/vault/provider-health";
import { detectPermissions, validatePermissionsForStorage } from "@/lib/vault/permissions";
import { permissionsFromAttestation } from "@/lib/vault/save-validation";
import { isEnabledCredentialStatus } from "@/lib/vault/credential-status";
import { PROVIDER_METADATA, type ProviderCredentialPublic } from "@/lib/vault/types";

export { isEnabledCredentialStatus } from "@/lib/vault/credential-status";

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
  permissionSelfAttestation?: unknown;
  lastReadOnlyVerifiedAt?: Date | null;
}): ProviderCredentialPublic {
  const attestationRaw = c.permissionSelfAttestation;
  let permissionSelfAttestation: ProviderCredentialPublic["permissionSelfAttestation"] = null;
  if (attestationRaw && typeof attestationRaw === "object") {
    const a = attestationRaw as Record<string, unknown>;
    if (
      typeof a.noWithdrawalPermission === "boolean" &&
      typeof a.noTradingPermission === "boolean" &&
      typeof a.readOnlyConfirmed === "boolean"
    ) {
      permissionSelfAttestation = {
        noWithdrawalPermission: a.noWithdrawalPermission,
        noTradingPermission: a.noTradingPermission,
        readOnlyConfirmed: a.readOnlyConfirmed,
        ipWhitelistConfirmed: Boolean(a.ipWhitelistConfirmed),
        confirmedAt: typeof a.confirmedAt === "string" ? a.confirmedAt : c.createdAt.toISOString(),
      };
    }
  }

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
    permissionSelfAttestation,
    lastReadOnlyVerifiedAt: c.lastReadOnlyVerifiedAt?.toISOString() ?? null,
    lastConnectionTestAt: c.lastConnectionTestAt?.toISOString() ?? null,
    lastConnectionStatus: c.lastConnectionStatus,
    lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
    lastHealthStatus: c.lastHealthStatus,
    lastLatencyMs: c.lastLatencyMs,
    keyPreview: maskSecret(c.encryptedKey.slice(0, 12)),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listProviderCredentials(userId: string): Promise<ProviderCredentialPublic[]> {
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
  permissionSelfAttestation?: {
    noWithdrawalPermission: boolean;
    noTradingPermission: boolean;
    readOnlyConfirmed: boolean;
    ipWhitelistConfirmed: boolean;
  };
}): Promise<ProviderCredentialPublic> {
  const meta = PROVIDER_METADATA[input.provider];
  if (!meta.legallySupportedDefault && !input.legallyConfirmed) {
    throw new AppError("FORBIDDEN", `${meta.label} requires legal jurisdiction confirmation`, {
      reasonCode: "LEGAL_JURISDICTION_NOT_CONFIRMED",
    });
  }

  if (meta.requiresSecret && !input.apiSecret?.trim()) {
    throw new AppError("VALIDATION_ERROR", "API secret is required for this provider", {
      reasonCode: "API_SECRET_MISSING",
    });
  }

  if (meta.category === "exchange") {
    const att = input.permissionSelfAttestation;
    if (
      !att?.noWithdrawalPermission ||
      !att?.noTradingPermission ||
      !att?.readOnlyConfirmed
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Exchange keys require read-only self-attestation checklist confirmation",
        { reasonCode: "READ_ONLY_ATTESTATION_REQUIRED" },
      );
    }
  }

  await assertVaultWriteAllowed();

  const permissions =
    meta.category === "exchange" && input.permissionSelfAttestation
      ? permissionsFromAttestation(input.provider)
      : await detectPermissions(
          input.provider,
          input.apiKey.trim(),
          input.apiSecret?.trim() ?? "",
          input.passphrase?.trim(),
        );

  const validation = validatePermissionsForStorage(permissions);
  if (!validation.allowed) {
    throw new AppError("FORBIDDEN", "API keys with withdrawal permission are blocked", {
      reasonCode: validation.reasonCode,
    });
  }

  const encKey = encryptSecret(input.apiKey.trim());
  const encSecret = input.apiSecret?.trim() ? encryptSecret(input.apiSecret.trim()) : null;
  const encPassphrase = input.passphrase?.trim() ? encryptSecret(input.passphrase.trim()) : null;

  let userId: string;
  try {
    userId = await resolveUserId({ requireAuth: true });
  } catch (error) {
    throw new AppError("FORBIDDEN", "Local owner or authenticated user could not be resolved", {
      reasonCode: "LOCAL_OWNER_RESOLUTION_FAILED",
      cause: error,
    });
  }

  const attestationPayload = input.permissionSelfAttestation
    ? {
        ...input.permissionSelfAttestation,
        confirmedAt: new Date().toISOString(),
      }
    : null;

  const credential = await prisma.providerCredential.create({
    data: {
      userId,
      provider: input.provider,
      label: input.label.trim(),
      encryptedKey: encKey.ciphertext,
      encryptedSecret: encSecret?.ciphertext ?? null,
      encryptedPassphrase: encPassphrase?.ciphertext ?? null,
      encryptionMethod: encKey.method,
      status: validation.status,
      ipWhitelistRecommended: meta.ipWhitelistRecommended,
      ipWhitelistConfigured: input.ipWhitelistConfigured ?? false,
      permissionsMetadata: permissions as unknown as Prisma.InputJsonValue,
      permissionSelfAttestation: attestationPayload as unknown as Prisma.InputJsonValue,
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

export async function deleteProviderCredential(id: string): Promise<{ deleted: true; id: string }> {
  const userId = await resolveUserId({ requireAuth: true });
  const existing = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }

  await prisma.providerCredential.delete({ where: { id } });

  await writeAuditLog({
    userId,
    action: "API_KEY_DELETED",
    entityType: "provider_credential",
    entityId: id,
    reasonCode: "CREDENTIAL_DELETED",
    detail: { provider: existing.provider, label: existing.label, status: existing.status },
  });

  return { deleted: true, id };
}

export async function disableProviderCredential(
  id: string,
  reason: string,
): Promise<ProviderCredentialPublic> {
  const userId = await resolveUserId({ requireAuth: true });
  const existing = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }

  const updated = await prisma.providerCredential.update({
    where: { id },
    data: { status: "DISABLED", disabledReason: reason, disabledAt: new Date() },
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

export async function emergencyDisableAllCredentials(userId: string): Promise<{ disabledCount: number }> {
  const result = await prisma.providerCredential.updateMany({
    where: { userId, status: { in: ["ACTIVE", "PERMISSION_UNKNOWN"] } },
    data: {
      status: "EMERGENCY_DISABLED",
      disabledReason: "Emergency disable activated",
      disabledAt: new Date(),
    },
  });

  await writeAuditLog({
    userId,
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
  const userId = await resolveUserId({ requireAuth: true });
  const credential = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!credential) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }

  if (!isEnabledCredentialStatus(credential.status)) {
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

export async function getCredentialForUser(id: string, userId: string) {
  const credential = await prisma.providerCredential.findFirst({ where: { id, userId } });
  if (!credential) {
    throw new AppError("NOT_FOUND", "Credential not found", { reasonCode: "CREDENTIAL_NOT_FOUND" });
  }
  await assertUserOwnsResource(credential.userId);
  return credential;
}
