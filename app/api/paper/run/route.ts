import { NextResponse } from "next/server";

import { runPaperEvidenceStep } from "@/lib/trading/paper/evidence-service";

import { toErrorResponse } from "@/lib/security/errors";

import { logger } from "@/lib/logger";



/** Paper runs can evaluate many symbols — allow long server-side execution. */

export const maxDuration = 300;



export async function POST() {

  try {

    const result = await runPaperEvidenceStep();

    // Return 200 with structured status so the UI can show reasonCode/reasonText safely.

    return NextResponse.json(result);

  } catch (error) {

    logger.error({ err: error }, "POST /api/paper/run failed");

    const { error: body, statusCode } = toErrorResponse(error);

    return NextResponse.json(

      {

        status: "FAILED",

        reasonCode: body.reasonCode ?? "PAPER_RUN_ROUTE_FAILED",

        reasonText: body.message,

        latestAction: "MARKET_DATA_FAILED",

        error: body,

        warnings: [body.message, "Auto remains locked."],

        autoUnlocked: false,

        liveOrdersPlaced: false,

      },

      { status: statusCode >= 500 ? 200 : statusCode },

    );

  }

}


