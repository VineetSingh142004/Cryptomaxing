import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { LiveProfitabilityAuditResult } from "@/lib/trading/live/types";
import type { SampleConfidenceResult } from "@/lib/trading/live/types";
import type { CanaryScalingResult } from "@/lib/trading/live/types";
import type { ReconciliationResult } from "@/lib/trading/live/types";
import type { DecayAnalysisResult } from "@/lib/trading/live/types";
import type { ProfitAttributionResult } from "@/lib/trading/live/types";

export async function persistLiveProfitabilityAudit(audit: LiveProfitabilityAuditResult): Promise<string> {
  const row = await prisma.liveProfitabilityAudit.create({
    data: {
      period: audit.period,
      netProfit: audit.netPnl,
      tradeCount: audit.tradeCount,
      assumptions: { grossNotForApproval: true } as Prisma.InputJsonValue,
      status: audit.decision,
      auditedAt: new Date(audit.auditedAt),
    },
  });
  return row.id;
}

export async function persistLiveSampleSizeAudit(sample: SampleConfidenceResult): Promise<string> {
  const required = sample.liveTradeCount < 20 ? 20 : sample.liveTradeCount < 50 ? 50 : 100;
  const row = await prisma.liveSampleSizeAudit.create({
    data: {
      strategyRef: sample.strategyId,
      sampleSize: sample.liveTradeCount,
      requiredSize: required,
      status: sample.scalingAllowed ? "SUFFICIENT" : "INSUFFICIENT",
      reasonCode: sample.reasonCodes[0] ?? "AUDITED",
      auditedAt: new Date(sample.auditedAt),
    },
  });
  return row.id;
}

export async function persistCanaryScalingEvent(result: CanaryScalingResult): Promise<string> {
  const row = await prisma.canaryScalingEvent.create({
    data: {
      fromSize: stageToRisk(result.fromStage),
      toSize: stageToRisk(result.toStage),
      reasonCode: result.reasonCodes[0] ?? result.direction,
      evidence: result as unknown as Prisma.InputJsonValue,
      scaledAt: new Date(result.decidedAt),
    },
  });
  return row.id;
}

function stageToRisk(stage: string): number {
  const map: Record<string, number> = {
    NO_LIVE: 0,
    TINY_CANARY: 0.015,
    MICRO_LIVE: 0.075,
    SMALL_LIVE: 0.175,
    CONTROLLED_LIVE: 0.375,
    NORMAL_AUTO: 0.75,
  };
  return map[stage] ?? 0;
}

export async function persistReconciliationEvent(
  entityType: string,
  entityId: string,
  result: ReconciliationResult,
): Promise<string> {
  const row = await prisma.reconciliationEvent.create({
    data: {
      entityType,
      entityId,
      expected: { balanced: true } as Prisma.InputJsonValue,
      observed: { discrepancy: result.discrepancy } as Prisma.InputJsonValue,
      discrepancy: { mismatches: result.mismatches } as Prisma.InputJsonValue,
      status: result.status,
      reasonCode: result.reasonCodes[0] ?? result.status,
      reconciledAt: new Date(result.reconciledAt),
    },
  });
  return row.id;
}

export async function persistEdgeDecayEvent(
  strategyId: string,
  decay: DecayAnalysisResult,
): Promise<string | null> {
  if (decay.severity === "NONE") return null;
  const row = await prisma.edgeDecayEvent.create({
    data: {
      metric: "forward_decay",
      priorValue: 0,
      currentValue: decay.signals.length,
      reasonCode: decay.severity,
      detectedAt: new Date(decay.analyzedAt),
    },
  });
  return row.id;
}

export async function persistProfitAttributionReport(report: ProfitAttributionResult): Promise<string> {
  const row = await prisma.profitAttributionReport.create({
    data: {
      period: report.period,
      attributions: report as unknown as Prisma.InputJsonValue,
      netProfit: report.netProfit,
      generatedAt: new Date(report.generatedAt),
    },
  });
  return row.id;
}
