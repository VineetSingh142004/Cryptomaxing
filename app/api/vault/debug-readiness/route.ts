import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAuthStatus, resolveUserId } from "@/lib/security/auth";
import { isLocalOwnerModeAllowed } from "@/lib/security/local-owner";
import {
  getVaultReadinessStatus,
  getVaultWritePolicy,
  isEncryptionProductionSafe,
} from "@/lib/security/vault-policy";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: { message: "Not available" } }, { status: 404 });
  }

  const vaultReadiness = getVaultReadinessStatus();
  const vaultPolicy = await getVaultWritePolicy();
  const auth = await getAuthStatus();

  let databaseReachable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  let userResolved = false;
  try {
    await resolveUserId({ requireAuth: true });
    userResolved = true;
  } catch {
    userResolved = false;
  }

  return NextResponse.json({
    vaultReady: vaultPolicy.allowed,
    localOwnerMode: isLocalOwnerModeAllowed(),
    encryptionReady: isEncryptionProductionSafe(),
    databaseReachable,
    userResolved,
    authStatus: auth.status,
    expectedPostFields: [
      "provider",
      "label",
      "apiKey",
      "apiSecret",
      "ipWhitelistConfigured",
      "permissionSelfAttestation.noWithdrawalPermission",
      "permissionSelfAttestation.noTradingPermission",
      "permissionSelfAttestation.readOnlyConfirmed",
      "permissionSelfAttestation.ipWhitelistConfirmed (optional)",
    ],
    note: "Development diagnostic only — no secrets included",
  });
}
