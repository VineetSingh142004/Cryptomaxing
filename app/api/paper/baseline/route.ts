import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";
import {
  createPaperTestBaseline,
  getActivePaperBaseline,
  listPaperBaselines,
  serializeBaseline,
} from "@/lib/trading/paper/paper-baseline";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const userId = await resolveUserId();
    const [active, history] = await Promise.all([
      getActivePaperBaseline(userId),
      listPaperBaselines(userId),
    ]);
    return NextResponse.json({
      currentStrategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      activeBaseline: active ? serializeBaseline(active) : null,
      baselines: history,
      liveTradingLocked: true as const,
      autoExecutionLocked: verifyPaperSafetyGates().autoExecutionLocked,
    });
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/baseline failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const safety = verifyPaperSafetyGates();
    if (!safety.liveTradingLocked || !safety.autoExecutionLocked) {
      return NextResponse.json(
        { error: "Paper-only baseline creation blocked — live/auto must remain locked." },
        { status: 403 },
      );
    }

    const userId = await resolveUserId();
    const body = (await request.json().catch(() => ({}))) as { notes?: string };
    const baseline = await createPaperTestBaseline({
      userId,
      notes: body.notes,
    });

    return NextResponse.json({
      ok: true,
      baseline: serializeBaseline(baseline),
      message:
        "New paper test baseline started. Old data preserved. Use baseline metrics to judge the current strategy.",
      currentStrategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      liveTradingLocked: true as const,
      autoExecutionLocked: true as const,
    });
  } catch (error) {
    logger.error({ err: error }, "POST /api/paper/baseline failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
