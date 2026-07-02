import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { evaluateLifecycleTransition } from "@/lib/trading/strategy-lifecycle";
import { runShadowExperiment } from "@/lib/trading/experiments";
import { evaluateEmergencyPlaybook } from "@/lib/trading/emergency";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === "lifecycle") {
      return NextResponse.json({ lifecycle: evaluateLifecycleTransition(body) });
    }
    if (action === "shadow-experiment") {
      return NextResponse.json({ experiment: runShadowExperiment(body) });
    }
    if (action === "emergency") {
      return NextResponse.json({ emergency: evaluateEmergencyPlaybook(body) });
    }

    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "action: lifecycle|shadow-experiment|emergency" } },
      { status: 400 },
    );
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
