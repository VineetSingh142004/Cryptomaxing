import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { checkAllProviderHealth } from "@/lib/vault/health-checker";

export async function GET() {
  try {
    const providers = await checkAllProviderHealth();
    return NextResponse.json({ providers, checkedAt: new Date().toISOString() });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
