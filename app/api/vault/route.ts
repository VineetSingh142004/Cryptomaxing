import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import { getEncryptionStatus } from "@/lib/security/encryption";
import { getAuthStatus } from "@/lib/security/auth";
import { getVaultWritePolicy, assertVaultWriteAllowed } from "@/lib/security/vault-policy";
import { logger } from "@/lib/logger";
import {
  createProviderCredential,
  listProviderCredentials,
} from "@/lib/vault/store";
import { PROVIDER_METADATA, PROVIDER_TYPES } from "@/lib/vault/types";

export async function GET() {
  try {
    const credentials = await listProviderCredentials();
    const encryption = getEncryptionStatus();
    const auth = getAuthStatus();
    const vaultPolicy = getVaultWritePolicy();
    return NextResponse.json({
      credentials,
      providers: PROVIDER_TYPES.map((id) => PROVIDER_METADATA[id]),
      encryption: {
        ...encryption,
        vaultWritesAllowed: vaultPolicy.allowed,
      },
      auth,
      vault_writes_allowed: vaultPolicy.allowed,
      vault_block_reasons: vaultPolicy.blockReasons,
    });
  } catch (error) {
    logger.error({ err: error }, "GET /api/vault failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

const createSchema = z.object({
  provider: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  passphrase: z.string().optional(),
  ipWhitelistConfigured: z.boolean().optional(),
  legallyConfirmed: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request", {
        reasonCode: "INVALID_BODY",
        details: parsed.error.flatten(),
      });
    }

    assertVaultWriteAllowed();

    const credential = await createProviderCredential({
      provider: parsed.data.provider as typeof PROVIDER_TYPES[number],
      label: parsed.data.label,
      apiKey: parsed.data.apiKey,
      apiSecret: parsed.data.apiSecret,
      passphrase: parsed.data.passphrase,
      ipWhitelistConfigured: parsed.data.ipWhitelistConfigured,
      legallyConfirmed: parsed.data.legallyConfirmed,
    });

    return NextResponse.json(credential, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "POST /api/vault failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
