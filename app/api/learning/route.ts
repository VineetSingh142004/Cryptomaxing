import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateLearningAction } from "@/lib/trading/learning";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

const schema = z.object({
  action: z.string(),
  payload: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = evaluateLearningAction({
      action: parsed.data.action as "RECORD_OBSERVATION",
      payload: parsed.data.payload,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, "POST /api/learning failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
