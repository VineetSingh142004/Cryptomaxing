import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { requireAuth } from "@/lib/security/auth";
import { emergencyDisableAllCredentials } from "@/lib/vault/store";
import { logger } from "@/lib/logger";

export async function POST() {
  try {
    const user = await requireAuth();
    const result = await emergencyDisableAllCredentials(user.id);
    return NextResponse.json({
      ...result,
      message: "All active credentials emergency disabled for your account",
    });
  } catch (error) {
    logger.error({ err: error }, "POST /api/vault/emergency-disable failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
