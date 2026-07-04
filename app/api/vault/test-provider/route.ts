import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, apiErrorJson } from "@/lib/security/errors";
import { testPublicProvider } from "@/lib/vault/provider-health";
import { isExchangeCategory } from "@/lib/vault/categories";
import { PROVIDER_METADATA, PROVIDER_TYPES, isPublicEndpointsOnlyProvider } from "@/lib/vault/types";
import { savePublicProviderTest } from "@/lib/vault/public-provider-store";

const testSchema = z.object({
  provider: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = testSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid provider test request", {
        reasonCode: "PROVIDER_CONFIG_INVALID",
      });
    }

    const provider = parsed.data.provider as (typeof PROVIDER_TYPES)[number];
    const meta = PROVIDER_METADATA[provider];
    if (!meta) {
      throw new AppError("VALIDATION_ERROR", "Provider is not supported", {
        reasonCode: "PROVIDER_UNSUPPORTED",
      });
    }

    if (isExchangeCategory(meta.providerCategory)) {
      throw new AppError("VALIDATION_ERROR", "Use a stored exchange credential to test connection", {
        reasonCode: "PROVIDER_CONFIG_INVALID",
      });
    }

    const test = await testPublicProvider(provider);
    const stored =
      isPublicEndpointsOnlyProvider(provider) ? savePublicProviderTest(provider, test) : null;
    return NextResponse.json({ test, stored, checkedAt: new Date().toISOString() });
  } catch (error) {
    const { body, statusCode } = apiErrorJson(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
