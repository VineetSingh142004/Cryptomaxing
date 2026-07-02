import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runSameDayRealityCheck } from "@/lib/trading/reality";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

const schema = z.object({
  evidence_level: z.number().min(0).max(14),
  today_proof_available: z.boolean(),
  today_go_no_go_allows: z.boolean(),
  paper_profit_today: z.number().nullable().optional(),
  shadow_profit_today: z.number().nullable().optional(),
  live_net_today: z.number().nullable().optional(),
  live_reconciled: z.boolean(),
  live_trade_count: z.number(),
  edge_decay_severity: z.enum(["NONE", "MILD", "MODERATE", "SEVERE"]).default("NONE"),
  live_drift_detected: z.boolean().default(false),
  strategy_degraded: z.boolean().default(false),
  statistically_meaningful: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const check = runSameDayRealityCheck({
      evidenceLevel: d.evidence_level as 0,
      todayProofAvailable: d.today_proof_available,
      todayGoNoGoAllows: d.today_go_no_go_allows,
      paperProfitToday: d.paper_profit_today ?? null,
      shadowProfitToday: d.shadow_profit_today ?? null,
      liveNetToday: d.live_net_today ?? null,
      liveReconciled: d.live_reconciled,
      liveTradeCount: d.live_trade_count,
      edgeDecaySeverity: d.edge_decay_severity,
      liveDriftDetected: d.live_drift_detected,
      strategyDegraded: d.strategy_degraded,
      statisticallyMeaningful: d.statistically_meaningful,
    });

    return NextResponse.json(check);
  } catch (error) {
    logger.error({ err: error }, "POST /api/reality/same-day failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

export async function GET() {
  const check = runSameDayRealityCheck({
    evidenceLevel: 0,
    todayProofAvailable: false,
    todayGoNoGoAllows: false,
    paperProfitToday: null,
    shadowProfitToday: null,
    liveNetToday: null,
    liveReconciled: false,
    liveTradeCount: 0,
    edgeDecaySeverity: "NONE",
    liveDriftDetected: false,
    strategyDegraded: false,
    statisticallyMeaningful: false,
  });
  return NextResponse.json(check);
}
