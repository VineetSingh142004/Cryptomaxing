import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/security/auth";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import {
  buildPaperExportLog,
  parsePaperExportMode,
  paperExportFilename,
  streamPaperExportLog,
} from "@/lib/trading/paper/export-log";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";

export async function GET(request: Request) {
  try {
    const safety = verifyPaperSafetyGates();
    if (!safety.liveTradingLocked || !safety.autoExecutionLocked) {
      return NextResponse.json(
        { error: { message: "Safety gates failed — export blocked" } },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const mode = parsePaperExportMode(searchParams.get("mode"));
    const recordId = searchParams.get("recordId")?.trim() || undefined;
    const useStream = searchParams.get("stream") === "1";

    const userId = await resolveUserId();
    const generatedAt = new Date();
    const filename = paperExportFilename(generatedAt, mode);
    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Paper-Simulated": "true",
      "X-Live-Trading-Locked": "true",
      "X-Auto-Locked": "true",
      "X-Export-Mode": mode,
    };

    if (useStream) {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const chunk of streamPaperExportLog({ userId, generatedAt, mode, recordId })) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(stream, { status: 200, headers });
    }

    const body = await buildPaperExportLog({ userId, generatedAt, mode, recordId });
    return new NextResponse(body, { status: 200, headers });
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/export-log failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
