import { NextResponse } from "next/server";
import { getPaperEvidenceReport } from "@/lib/trading/paper/evidence-service";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const evidence = await getPaperEvidenceReport();
    return NextResponse.json(evidence);
  } catch (error) {
    logger.error({ err: error }, "GET /api/paper/evidence failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
