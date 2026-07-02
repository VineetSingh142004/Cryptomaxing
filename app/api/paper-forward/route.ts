import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";
import { openPaperTrade, closePaperTrade, summarizePaperDay } from "@/lib/trading/paper";
import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const reportDate = (body.reportDate as string) ?? new Date().toISOString().slice(0, 10);

    if (body.action === "summarize") {
      const summary = summarizePaperDay({
        reportDate,
        startingBalance: body.startingBalance ?? 10_000,
        trades: body.trades ?? [],
        noTradeDecisions: body.noTradeDecisions,
        moneyProtected: body.moneyProtected,
      });
      return NextResponse.json({ summary });
    }

    if (body.action === "close") {
      const closed = closePaperTrade(body);
      return NextResponse.json({ trade: closed });
    }

    const trade = openPaperTrade({
      signalTimestamp: body.signalTimestamp,
      symbol: body.symbol,
      strategyId: body.strategyId,
      direction: body.direction,
      entryPrice: body.entryPrice,
      size: body.size ?? 1,
      leverage: body.leverage,
      feeModel: body.feeModel ?? DEFAULT_FEE_MODEL,
      spreadBps: body.spreadBps ?? 5,
      minOrderSize: body.minOrderSize,
      reportDate,
      rng: body.seed !== undefined ? seededRng(body.seed) : undefined,
    });

    return NextResponse.json({ trade });
  } catch (error) {
    const { error: errBody, statusCode } = toErrorResponse(error);
    return NextResponse.json(errBody, { status: statusCode });
  }
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
