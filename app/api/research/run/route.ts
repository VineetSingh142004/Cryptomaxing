import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import { runFullResearchPipeline } from "@/lib/trading/research";

const schema = z.object({
  strategyId: z.enum([
    "vwap-reclaim-momentum",
    "volatility-compression-breakout",
    "trend-pullback-continuation",
  ]),
  symbol: z.string().default("BTC/USD"),
  minHistoryDays: z.number().min(30).max(365).optional(),
  persist: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request", {
        details: parsed.error.flatten(),
      });
    }

    const result = await runFullResearchPipeline(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
