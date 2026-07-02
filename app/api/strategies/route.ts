import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { getStrategyRegistrySummary, seedStrategyRegistry } from "@/lib/trading/strategies";

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("seed") === "true") {
      await seedStrategyRegistry();
    }
    return NextResponse.json(getStrategyRegistrySummary());
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
