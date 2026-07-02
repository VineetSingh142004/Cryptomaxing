import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateModeState, setMode } from "@/lib/trading/mode-service";
import { AppError, toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

const setModeSchema = z.object({
  mode: z.enum(["paper", "manual", "auto"]),
  emergency_pause: z.boolean().optional(),
});

export async function GET() {
  try {
    const mode = await getOrCreateModeState();
    return NextResponse.json(mode);
  } catch (error) {
    logger.error({ err: error }, "GET /api/mode failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = setModeSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request body", {
        reasonCode: "INVALID_BODY",
        details: parsed.error.flatten(),
      });
    }

    const mode = await setMode({
      mode: parsed.data.mode,
      emergencyPause: parsed.data.emergency_pause,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
    });

    return NextResponse.json(mode);
  } catch (error) {
    logger.error({ err: error }, "POST /api/mode failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
