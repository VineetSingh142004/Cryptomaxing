import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { emergencyDisableAllCredentials } from "@/lib/vault/store";

export async function POST() {
  try {
    const result = await emergencyDisableAllCredentials();
    return NextResponse.json({
      ...result,
      message: "All active credentials emergency disabled",
    });
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
