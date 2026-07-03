import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { AppError, apiErrorJson } from "@/lib/security/errors";

import { getEncryptionStatus } from "@/lib/security/encryption";

import { getAuthStatus } from "@/lib/security/auth";

import { isLocalOwnerModeAllowed } from "@/lib/security/local-owner";

import {

  getVaultWritePolicy,

  getVaultReadinessStatus,

  assertVaultWriteAllowed,

  isEncryptionProductionSafe,

} from "@/lib/security/vault-policy";

import { logger } from "@/lib/logger";

import {

  createProviderCredential,

  listProviderCredentials,

} from "@/lib/vault/store";

import { PROVIDER_METADATA, PROVIDER_TYPES } from "@/lib/vault/types";

import { assertVaultSaveInput, safeVaultSaveLogContext } from "@/lib/vault/save-validation";



export async function GET() {

  try {

    const auth = await getAuthStatus();

    const encryption = getEncryptionStatus();

    const vaultPolicy = await getVaultWritePolicy();

    const vaultReadiness = getVaultReadinessStatus();



    let credentials: Awaited<ReturnType<typeof listProviderCredentials>> = [];

    if (

      (auth.status === "AUTH_READY" || auth.status === "LOCAL_OWNER_MODE") &&

      auth.user

    ) {

      credentials = await listProviderCredentials(auth.user.id);

    }



    return NextResponse.json({

      credentials,

      providers: PROVIDER_TYPES.map((id) => PROVIDER_METADATA[id]),

      encryption: {

        ...encryption,

        ...vaultReadiness,

        vaultWritesAllowed: vaultPolicy.allowed,

      },

      auth,

      vault_writes_allowed: vaultPolicy.allowed,

      vault_block_reasons: vaultPolicy.blockReasons,

      vault_status: vaultPolicy.vaultStatus,

      local_owner_mode: vaultPolicy.localOwnerMode,

      safety_notes: [

        "Vault writes are allowed in Local Owner Mode only after ENCRYPTION_KEY is valid",

        "Do not add real API keys until you understand exchange permissions",

        "Use read-only keys first",

        "Never enable withdrawal permissions",

      ],

    });

  } catch (error) {

    logger.error({ err: error }, "GET /api/vault failed");

    const { body, statusCode } = apiErrorJson(error);

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

  permissionSelfAttestation: z

    .object({

      noWithdrawalPermission: z.boolean(),

      noTradingPermission: z.boolean(),

      readOnlyConfirmed: z.boolean(),

      ipWhitelistConfirmed: z.boolean(),

    })

    .optional(),

});



function mapZodVaultError(parsed: z.SafeParseError<unknown>): AppError {

  const fieldErrors = parsed.error.flatten().fieldErrors;

  if (fieldErrors.apiKey?.length) {

    return new AppError("VALIDATION_ERROR", "API key is required", {

      reasonCode: "API_KEY_MISSING",

      details: parsed.error.flatten(),

    });

  }

  if (fieldErrors.apiSecret?.length) {

    return new AppError("VALIDATION_ERROR", "API secret is required", {

      reasonCode: "API_SECRET_MISSING",

      details: parsed.error.flatten(),

    });

  }

  return new AppError("VALIDATION_ERROR", "Invalid vault save request", {

    reasonCode: "VAULT_SAVE_VALIDATION_FAILED",

    details: parsed.error.flatten(),

  });

}



export async function POST(request: NextRequest) {

  const vaultPolicy = await getVaultWritePolicy();

  const logBase = {

    localOwnerMode: isLocalOwnerModeAllowed(),

    encryptionReady: isEncryptionProductionSafe(),

    vaultWritesAllowed: vaultPolicy.allowed,

  };



  try {

    const body: unknown = await request.json();

    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {

      throw mapZodVaultError(parsed);

    }



    assertVaultSaveInput({

      provider: parsed.data.provider as typeof PROVIDER_TYPES[number],

      label: parsed.data.label,

      apiKey: parsed.data.apiKey,

      apiSecret: parsed.data.apiSecret,

      permissionSelfAttestation: parsed.data.permissionSelfAttestation,

    });



    logger.info(

      {

        ...logBase,

        ...safeVaultSaveLogContext({

          provider: parsed.data.provider as typeof PROVIDER_TYPES[number],

          label: parsed.data.label,

          apiKey: parsed.data.apiKey,

          apiSecret: parsed.data.apiSecret,

          permissionSelfAttestation: parsed.data.permissionSelfAttestation,

        }),

        userIdResolved: true,

      },

      "POST /api/vault save attempt",

    );



    await assertVaultWriteAllowed();



    const credential = await createProviderCredential({

      provider: parsed.data.provider as typeof PROVIDER_TYPES[number],

      label: parsed.data.label,

      apiKey: parsed.data.apiKey,

      apiSecret: parsed.data.apiSecret,

      passphrase: parsed.data.passphrase,

      ipWhitelistConfigured: parsed.data.ipWhitelistConfigured,

      legallyConfirmed: parsed.data.legallyConfirmed,

      permissionSelfAttestation: parsed.data.permissionSelfAttestation,

    });



    logger.info(

      {

        ...logBase,

        provider: credential.provider,

        credentialId: credential.id,

        reasonCode: "VAULT_SAVE_OK",

      },

      "POST /api/vault save succeeded",

    );



    return NextResponse.json(credential, { status: 201 });

  } catch (error) {

    const { body, statusCode } = apiErrorJson(error);

    logger.error(

      {

        ...logBase,

        reasonCode: body.error.reasonCode ?? "UNKNOWN_VAULT_SAVE_ERROR",

        errorCode: body.error.code,

        prismaCode:

          error instanceof Error && "code" in error

            ? (error as Error & { code?: string }).code

            : undefined,

      },

      "POST /api/vault failed",

    );

    return NextResponse.json(body, { status: statusCode });

  }

}


