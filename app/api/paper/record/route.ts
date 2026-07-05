import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";
import {
  buildRecordHistoryRows,
  ensurePaperRecords,
  getActivePaperRecord,
  listPaperRecords,
  serializePaperRecord,
  startNewPaperRecord,
} from "@/lib/trading/paper/paper-record";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const userId = await resolveUserId();
    await ensurePaperRecords(userId);
    const [active, records, history] = await Promise.all([
      getActivePaperRecord(userId),
      listPaperRecords(userId),
      buildRecordHistoryRows(userId),
    ]);
    return NextResponse.json({
      currentStrategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
      activeRecord: active ? serializePaperRecord(active) : null,
      records: records.map(serializePaperRecord),
      recordHistory: history,
      liveTradingLocked: true as const,
      autoExecutionLocked: verifyPaperSafetyGates().autoExecutionLocked,
    });
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/record failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function POST(request: Request) {
  try {
    const safety = verifyPaperSafetyGates();
    if (!safety.liveTradingLocked || !safety.autoExecutionLocked) {
      return NextResponse.json(
        { error: "Paper-only record creation blocked — live/auto must remain locked." },
        { status: 403 },
      );
    }

    const userId = await resolveUserId();
    const body = (await request.json().catch(() => ({}))) as {
      recordName?: string;
      notes?: string;
      carryOpenTrades?: boolean;
      startMode?: "soft" | "clean";
    };

    const result = await startNewPaperRecord({
      userId,
      recordName: body.recordName,
      notes: body.notes,
      carryOpenTrades: body.carryOpenTrades === true,
      startMode: body.startMode === "clean" ? "clean" : "soft",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json({
      ...result,
      liveTradingLocked: true as const,
      autoExecutionLocked: true as const,
    });
  } catch (error) {
    logger.error({ err: error }, "POST /api/paper/record failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
