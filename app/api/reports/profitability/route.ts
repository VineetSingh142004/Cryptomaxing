import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildProfitabilityReport } from "@/lib/trading/reports";
import { checkRateLimit } from "@/lib/security/api-guards";
import { toErrorResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import type { LiveTradeRecord } from "@/lib/trading/live/types";
import { prisma } from "@/lib/db/client";
import { resolveUserId } from "@/lib/security/auth";

const reportSchema = z.object({
  date_range: z.object({ start: z.string(), end: z.string() }),
  starting_equity: z.number(),
  ending_equity: z.number(),
  trades: z.array(z.record(z.unknown())).default([]),
  paper_trades: z.array(z.record(z.unknown())).optional(),
  benchmark_net_pnl: z.number().optional(),
  random_baseline_net_pnl: z.number().optional(),
  backtest_net_pnl: z.number().optional(),
  evidence_level: z.number().min(0).max(14).default(0),
  sample_size: z.number().default(0),
  statistically_meaningful: z.boolean().default(false),
  edge_trend: z.enum(["IMPROVING", "STABLE", "DECAYING", "UNKNOWN"]).default("UNKNOWN"),
  execution_quality_score: z.number().optional(),
  money_protected_total: z.number().optional(),
  auto_blocks: z.array(z.object({ reason: z.string(), count: z.number(), money_protected: z.number().optional() })).optional(),
  reconciliation: z.object({ status: z.string() }).optional(),
});

/** Safe empty report — no fabricated P&L */
export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  let paperTradesFromDb: LiveTradeRecord[] = [];
  let exchangeHistoricalNote = "Exchange historical trades are not Alpha Autopilot proof";
  try {
    const userId = await resolveUserId();
    const closed = await prisma.paperTrade.findMany({
      where: {
        userId,
        status: { in: ["CLOSED", "EXPIRED"] },
        isRealTrade: false,
      },
      orderBy: { closedAt: "asc" },
    });
    paperTradesFromDb = closed
      .filter((t) => t.closedAt && t.entryPrice && t.exitPrice && t.simulatedSize)
      .map((t) => ({
        id: t.id,
        strategyId: t.strategyName,
        symbol: t.symbol,
        venue: "kraken",
        direction: t.side === "SHORT" ? "short" : "long",
        entryTime: (t.openedAt ?? t.createdAt).toISOString(),
        exitTime: t.closedAt!.toISOString(),
        entryPrice: Number(t.entryPrice),
        exitPrice: Number(t.exitPrice),
        size: Number(t.simulatedSize),
        grossPnl: Number(t.grossPaperPnl ?? 0),
        fees: Number(t.estimatedFees ?? 0),
        spreadCost: 0,
        slippage: Number(t.estimatedSlippage ?? 0),
        funding: 0,
        reconciled: false,
      }));
  } catch {
    exchangeHistoricalNote = "Exchange historical trades unavailable";
  }

  const report = buildProfitabilityReport({
    dateRange: { start: today, end: today },
    startingEquity: 0,
    endingEquity: 0,
    trades: [],
    paperTrades: paperTradesFromDb,
    evidenceLevel: 0,
    sampleSize: 0,
    statisticallyMeaningful: false,
    edgeTrend: "UNKNOWN",
    readOnlyAccountDataAvailable: false,
    readOnlyTradeCount: 0,
  });
  return NextResponse.json({
    ...report,
    pnlSections: {
      verifiedLiveAlphaAutopilotPnl: report.verifiedLivePnl,
      exchangeAccountHistoricalTrades: {
        available: false,
        netPnl: null,
        note: exchangeHistoricalNote,
      },
      paperSimulatedPnl: report.paperSimulatedPnl,
      shadowSimulatedPnl: report.shadowSimulatedPnl,
    },
    note: "Verified live P&L remains blank without reconciled bot trades. Paper/shadow P&L is simulated only.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "unknown";
    const rate = checkRateLimit(`report:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: { message: "Rate limit exceeded" } }, { status: 429 });
    }

    const body: unknown = await request.json();
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const report = buildProfitabilityReport({
      dateRange: d.date_range,
      startingEquity: d.starting_equity,
      endingEquity: d.ending_equity,
      trades: d.trades as unknown as LiveTradeRecord[],
      paperTrades: d.paper_trades as unknown as LiveTradeRecord[] | undefined,
      benchmarkNetPnl: d.benchmark_net_pnl,
      randomBaselineNetPnl: d.random_baseline_net_pnl,
      backtestNetPnl: d.backtest_net_pnl,
      evidenceLevel: d.evidence_level as 0,
      sampleSize: d.sample_size,
      statisticallyMeaningful: d.statistically_meaningful,
      edgeTrend: d.edge_trend,
      executionQualityScore: d.execution_quality_score,
      moneyProtectedTotal: d.money_protected_total,
      autoBlocks: d.auto_blocks,
      reconciliation: d.reconciliation
        ? {
            status: d.reconciliation.status as "RECONCILED",
            balanceMatch: d.reconciliation.status === "RECONCILED",
            discrepancy: 0,
            mismatches: [],
            blockNewTrades: false,
            blockPnlApproval: false,
            blockProofUpgrade: false,
            autoLocked: false,
            reasonCodes: [],
            reconciledAt: new Date().toISOString(),
          }
        : null,
    });

    return NextResponse.json(report);
  } catch (error) {
    logger.error({ err: error }, "POST /api/reports/profitability failed");
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
