import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { assertServerSideAutoAuthorization, checkRateLimit } from "@/lib/security/api-guards";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

const schema = z.record(z.unknown()).optional();

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "unknown";
    const rate = checkRateLimit(`auto-unlock:${ip}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: { message: "Rate limit exceeded" } }, { status: 429 });
    }

    const body: unknown = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    const overrides = (parsed.success ? parsed.data : {}) as Record<string, unknown>;

    const input = defaultAutoUnlockInput({
      ...overrides,
      evidenceLevel: typeof overrides.evidenceLevel === "number" ? overrides.evidenceLevel : 0,
    });

    const result = evaluateAutoUnlock(input);

    const auth = assertServerSideAutoAuthorization({
      clientRequestedAuto: overrides.clientRequestedAuto === true,
      serverAutoAllowed: result.autoExecutionEnabled,
    });

    if (!auth.authorized) {
      return NextResponse.json(
        { ...result, authorized: false, reasonCode: auth.reasonCode },
        { status: 403 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, "POST /api/auto/unlock failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function GET() {
  const result = evaluateAutoUnlock(defaultAutoUnlockInput());
  return NextResponse.json(result);
}
