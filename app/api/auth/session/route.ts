import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";

export async function GET() {
  try {
    const auth = await getAuthStatus();
    return NextResponse.json(auth);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
