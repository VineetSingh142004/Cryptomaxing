import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/security/errors";
import { requireAuth } from "@/lib/security/auth";
import { getVaultWritePolicy } from "@/lib/security/vault-policy";
import { verifyReadOnlyCredential } from "@/lib/trading/exchange/account-service";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  credentialId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const vaultPolicy = await getVaultWritePolicy();
    if (!vaultPolicy.encryptionProductionSafe && vaultPolicy.blockReasons.length > 0) {
      const hasEncryptionBlock = vaultPolicy.blockReasons.some((r) => r.includes("ENCRYPTION"));
      if (hasEncryptionBlock) {
        return NextResponse.json(
          {
            keyFound: false,
            provider: null,
            canReadBalance: false,
            canReadOpenOrders: false,
            canReadClosedOrders: false,
            canReadTradeHistory: false,
            permissionWarning: null,
            reasonCode: "READ_ONLY_API_SECRET_DECRYPT_FAILED",
            safeToUseForReadOnly: false,
          },
          { status: 403 },
        );
      }
    }

    let credentialId: string | undefined;
    try {
      const body: unknown = await request.json();
      const parsed = bodySchema.safeParse(body);
      if (parsed.success) credentialId = parsed.data.credentialId;
    } catch {
      // empty body is fine
    }

    const result = await verifyReadOnlyCredential(credentialId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, "POST /api/vault/verify-readonly failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
