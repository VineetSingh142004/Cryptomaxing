import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { requireAuth } from "@/lib/security/auth";
import { getVaultWritePolicy } from "@/lib/security/vault-policy";
import { getAccountStatus } from "@/lib/trading/exchange/account-service";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    await requireAuth();
    const vaultPolicy = await getVaultWritePolicy();
    if (!vaultPolicy.allowed && vaultPolicy.blockReasons.some((r) => r.includes("ENCRYPTION"))) {
      return NextResponse.json(
        {
          readOnlyKeyConfigured: false,
          provider: null,
          credentialEnabled: false,
          verificationStatus: "UNKNOWN",
          lastVerifiedAt: null,
          lastVerificationReason: null,
          providerHealthy: false,
          permissionsVerifiedAsReadOnly: false,
          canReadBalance: false,
          canReadOpenOrders: false,
          canReadClosedOrders: false,
          canReadTradeHistory: false,
          tradeHistoryReadStatus: "NO",
          tradeHistoryCount: null,
          endpointResults: [],
          permissionWarning: "Vault not ready — configure ENCRYPTION_KEY",
          krakenError: null,
          tradingPermissionDetected: "UNKNOWN",
          withdrawalPermissionDetected: "UNKNOWN",
          liveTradingLocked: true,
          autoExecutionLocked: true,
        },
        { status: 200 },
      );
    }

    const status = await getAccountStatus();
    return NextResponse.json(status);
  } catch (error) {
    logger.error({ err: error }, "GET /api/account/status failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
