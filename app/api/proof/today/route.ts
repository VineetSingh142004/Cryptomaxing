import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import {
  buildTodayMarketProof,
  analyzeTodayAlphaBeta,
  summarizeMoneyProtected,
  buildProfitabilityScorecard,
  decideGoNoGo,
  persistTodayMarketProof,
  persistGoNoGoDecision,
} from "@/lib/trading/proof";
import { assessEvidenceLevel } from "@/lib/trading/proof";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const reportDate = (body.reportDate as string) ?? new Date().toISOString().slice(0, 10);

    const moneyProtected = body.moneyProtectedRecords
      ? summarizeMoneyProtected({ reportDate, records: body.moneyProtectedRecords })
      : summarizeMoneyProtected({ reportDate, records: [] });

    const alphaBeta = body.alphaBetaInput
      ? analyzeTodayAlphaBeta({ ...body.alphaBetaInput, reportDate })
      : null;

    const todayProof = buildTodayMarketProof({
      reportDate,
      scannedAssets: body.scannedAssets ?? [],
      approvedAssets: body.approvedAssets ?? [],
      blockedAssets: body.blockedAssets ?? [],
      marketRegime: body.marketRegime ?? "unknown",
      bestSessions: body.bestSessions ?? [],
      worstSessions: body.worstSessions ?? [],
      aPlusSetupsFound: body.aPlusSetupsFound ?? 0,
      bcSetupsRejected: body.bcSetupsRejected ?? 0,
      noTradeDecisions: body.noTradeDecisions ?? 0,
      tradeCandidates: body.tradeCandidates ?? 0,
      shadowTrades: body.shadowTrades ?? [],
      paperSummary: body.paperSummary ?? null,
      moneyProtected,
      alphaBeta,
      liveModeEnabled: body.liveModeEnabled ?? false,
      realLiveNetPnl: body.realLiveNetPnl ?? null,
      liquidityQualityScore: body.liquidityQualityScore,
      executionQualityScore: body.executionQualityScore,
    });

    const evidence = assessEvidenceLevel(body.evidenceInput ?? { entityType: "strategy", entityId: body.strategyId ?? "unknown" });

    const scorecard = buildProfitabilityScorecard({
      period: reportDate,
      evidenceLevel: evidence.level,
      dataQualityScore: body.dataQualityScore ?? 70,
      signalQualityScore: body.signalQualityScore ?? 50,
      executionQualityScore: todayProof.executionQualityScore,
      fillRealismScore: body.fillRealismScore ?? 60,
      sampleSize: body.sampleSize ?? 0,
      maxDrawdownPct: body.paperSummary?.maxDrawdown ?? 0,
      liveReconciled: body.liveReconciled ?? false,
      edgeDecayDetected: body.edgeDecayDetected ?? false,
      regimeBreadth: body.regimeBreadth ?? 2,
      alphaBeta,
      paperSummary: body.paperSummary ?? null,
      luckyTradeDominance: body.luckyTradeDominance ?? null,
      costDragPct: body.costDragPct ?? 0,
    });

    const goNoGo = decideGoNoGo({
      reportDate,
      currentEvidenceLevel: evidence.level,
      todayProof,
      alphaBeta,
      paperSummary: body.paperSummary ?? null,
      scorecard,
      consecutiveCleanPaperDays: body.consecutiveCleanPaperDays,
      tinyCanaryPassed: body.tinyCanaryPassed,
      sampleSize: body.sampleSize,
      edgeDecayDetected: body.edgeDecayDetected,
    });

    let persistedTodayId: string | null = null;
    let persistedGoNoGoId: string | null = null;
    if (body.persist === true) {
      persistedTodayId = await persistTodayMarketProof(todayProof);
      persistedGoNoGoId = await persistGoNoGoDecision(goNoGo);
    }

    return NextResponse.json({
      todayProof,
      alphaBeta,
      moneyProtected,
      scorecard,
      goNoGo,
      evidence,
      persistedTodayId,
      persistedGoNoGoId,
    });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}
