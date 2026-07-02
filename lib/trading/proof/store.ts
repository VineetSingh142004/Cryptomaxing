import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { EvidenceAssessmentResult } from "@/lib/trading/proof/types";
import type { TodayMarketProof } from "@/lib/trading/proof/types";
import type { GoNoGoResult } from "@/lib/trading/proof/go-no-go";
import type { ProfitabilityScorecard } from "@/lib/trading/proof/types";
import type { MoneyProtectedSummary } from "@/lib/trading/proof/types";

export async function persistEvidenceLevel(result: EvidenceAssessmentResult): Promise<string> {
  const row = await prisma.evidenceLevel.create({
    data: {
      entityType: result.entityType,
      entityId: result.entityId,
      level: String(result.level),
      reasonCode: result.reasonCodes[0] ?? "ASSESSED",
      evidence: {
        levelName: result.levelName,
        direction: result.direction,
        autoAllowed: result.autoAllowed,
        autoMaxSizeBand: result.autoMaxSizeBand,
        artifacts: result.artifacts,
        reasonCodes: result.reasonCodes,
      } as Prisma.InputJsonValue,
      assessedAt: new Date(result.assessedAt),
    },
  });
  return row.id;
}

export async function persistTodayMarketProof(proof: TodayMarketProof): Promise<string> {
  const date = new Date(proof.reportDate.slice(0, 10));
  const row = await prisma.todayMarketProofReport.upsert({
    where: { reportDate: date },
    create: {
      reportDate: date,
      dataQuality: { liquidityQualityScore: proof.liquidityQualityScore } as Prisma.InputJsonValue,
      marketQuality: { executionQualityScore: proof.executionQualityScore } as Prisma.InputJsonValue,
      verdict: proof.verdict,
      reasonCodes: proof.reasonCodes as Prisma.InputJsonValue,
      generatedAt: new Date(proof.generatedAt),
    },
    update: {
      dataQuality: { proof } as Prisma.InputJsonValue,
      marketQuality: { executionQualityScore: proof.executionQualityScore } as Prisma.InputJsonValue,
      verdict: proof.verdict,
      reasonCodes: proof.reasonCodes as Prisma.InputJsonValue,
      generatedAt: new Date(proof.generatedAt),
    },
  });
  return row.id;
}

export async function persistGoNoGoDecision(result: GoNoGoResult): Promise<string> {
  const date = new Date(result.reportDate.slice(0, 10));
  const row = await prisma.todayGoNoGoDecision.upsert({
    where: { reportDate: date },
    create: {
      reportDate: date,
      decision: result.decision,
      reasonCodes: result.reasonCodes as Prisma.InputJsonValue,
      gatesPassed: result.gatesPassed as Prisma.InputJsonValue,
      gatesFailed: result.gatesFailed as Prisma.InputJsonValue,
      decidedAt: new Date(result.decidedAt),
    },
    update: {
      decision: result.decision,
      reasonCodes: result.reasonCodes as Prisma.InputJsonValue,
      gatesPassed: result.gatesPassed as Prisma.InputJsonValue,
      gatesFailed: result.gatesFailed as Prisma.InputJsonValue,
      decidedAt: new Date(result.decidedAt),
    },
  });
  return row.id;
}

export async function persistScorecard(scorecard: ProfitabilityScorecard): Promise<string> {
  const row = await prisma.profitabilityScorecard.create({
    data: {
      period: scorecard.period,
      scorecard: scorecard as unknown as Prisma.InputJsonValue,
      overallScore: scorecard.overallScore,
      status: scorecard.status,
      generatedAt: new Date(scorecard.generatedAt),
    },
  });
  return row.id;
}

export async function persistMoneyProtectedEvent(input: {
  amount: number;
  protectionType: string;
  reasonCode: string;
  detail?: Record<string, unknown>;
}): Promise<string> {
  const row = await prisma.moneyProtectedEvent.create({
    data: {
      amount: input.amount,
      protectionType: input.protectionType,
      reasonCode: input.reasonCode,
      detail: (input.detail ?? {}) as Prisma.InputJsonValue,
      occurredAt: new Date(),
    },
  });
  return row.id;
}

export async function persistMoneyProtectedSummary(summary: MoneyProtectedSummary): Promise<void> {
  for (const r of summary.records) {
    if (r.laterOutcome === "LOST" && (r.estimatedLossAvoided ?? 0) > 0) {
      await persistMoneyProtectedEvent({
        amount: r.estimatedLossAvoided!,
        protectionType: r.blockCategory,
        reasonCode: r.blockReason,
        detail: { symbol: r.symbol, strategyId: r.strategyId },
      });
    }
  }
}
