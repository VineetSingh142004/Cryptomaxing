import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { attributeProfit } from "@/lib/trading/reports";
import {
  auditLiveProfitability,
  analyzeSampleConfidence,
  evaluateCanaryScaling,
  reconcileLiveAccounts,
  analyzeForwardDecay,
  persistLiveProfitabilityAudit,
  persistLiveSampleSizeAudit,
  persistCanaryScalingEvent,
  persistReconciliationEvent,
  persistEdgeDecayEvent,
  persistProfitAttributionReport,
} from "@/lib/trading/live";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === "audit") {
      const audit = auditLiveProfitability(body);
      let id: string | null = null;
      if (body.persist) id = await persistLiveProfitabilityAudit(audit);
      return NextResponse.json({ audit, persistedId: id });
    }

    if (action === "sample-confidence") {
      const sample = analyzeSampleConfidence(body);
      let id: string | null = null;
      if (body.persist) id = await persistLiveSampleSizeAudit(sample);
      return NextResponse.json({ sample, persistedId: id });
    }

    if (action === "canary") {
      const audit = auditLiveProfitability(body.auditInput ?? body);
      const sample = analyzeSampleConfidence(body.sampleInput ?? body);
      const canary = evaluateCanaryScaling({ ...body, audit, sample });
      let id: string | null = null;
      if (body.persist) id = await persistCanaryScalingEvent(canary);
      return NextResponse.json({ canary, audit, sample, persistedId: id });
    }

    if (action === "reconcile") {
      const reconciliation = reconcileLiveAccounts(body);
      let id: string | null = null;
      if (body.persist) {
        id = await persistReconciliationEvent(body.entityType ?? "account", body.entityId ?? "default", reconciliation);
      }
      return NextResponse.json({ reconciliation, persistedId: id });
    }

    if (action === "decay") {
      const decay = analyzeForwardDecay(body);
      let id: string | null = null;
      if (body.persist) id = await persistEdgeDecayEvent(body.strategyId, decay);
      return NextResponse.json({ decay, persistedId: id });
    }

    if (action === "attribution") {
      const attribution = attributeProfit(body);
      let id: string | null = null;
      if (body.persist) id = await persistProfitAttributionReport(attribution);
      return NextResponse.json({ attribution, persistedId: id });
    }

    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "action required: audit|sample-confidence|canary|reconcile|decay|attribution" } },
      { status: 400 },
    );
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
