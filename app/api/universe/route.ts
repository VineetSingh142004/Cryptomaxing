import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { selectLiquidityUniverse } from "@/lib/trading/universe";

export async function GET() {
  try {
    const universe = await selectLiquidityUniverse();
    return NextResponse.json(universe);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
