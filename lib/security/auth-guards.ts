import "server-only";
import { NextResponse } from "next/server";
import { getAuthStatus, requireAuth, type AuthUser } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";

export async function withAuthRequired<T>(
  handler: (user: AuthUser) => Promise<NextResponse<T>>,
): Promise<NextResponse> {
  try {
    const user = await requireAuth();
    return await handler(user);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function authGuardResponse(): Promise<NextResponse | null> {
  const auth = await getAuthStatus();
  if (auth.status === "AUTH_REQUIRED" || auth.status === "AUTH_NOT_CONFIGURED") {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: auth.message,
          reasonCode: auth.status,
        },
      },
      { status: 401 },
    );
  }
  return null;
}
