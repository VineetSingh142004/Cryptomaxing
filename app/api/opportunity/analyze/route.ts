import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { analyzeOpportunity } from "@/lib/trading/profit";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const symbol = body.symbol as string;
    const strategyId = body.strategyId as string;

    if (!symbol || !strategyId) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "symbol and strategyId required" } },
        { status: 400 },
      );
    }

    const analysis = await analyzeOpportunity({
      symbol,
      strategyId,
      direction: body.direction,
      accountEquity: body.accountEquity,
      positionSizeUsd: body.positionSizeUsd,
      catalyst: body.catalyst,
      dailyState: body.dailyState,
      proofGateApproved: body.proofGateApproved ?? false,
      benchmarkAlphaPassed: body.benchmarkAlphaPassed,
      monteCarlo: body.monteCarlo,
      adversarialPassed: body.adversarialPassed,
      liveDriftDetected: body.liveDriftDetected ?? false,
      edgeDecayDetected: body.edgeDecayDetected ?? false,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
