import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { assessEvidenceLevel, persistEvidenceLevel } from "@/lib/trading/proof";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = assessEvidenceLevel(body, body.previousLevel ?? null);
    let persistedId: string | null = null;
    if (body.persist === true) {
      persistedId = await persistEvidenceLevel(result);
    }
    return NextResponse.json({ evidence: result, persistedId });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
