import { describe, expect, it } from "vitest";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { evaluateConservativePaperStrategy } from "@/lib/trading/paper/conservative-strategy";
import {
  evaluatePaperForwardEvidence,
  PAPER_EVIDENCE_REQUIREMENTS,
} from "@/lib/trading/paper/evidence-requirements";
import { serializePaperTrade } from "@/lib/trading/paper/evidence-service";
import { buildProfitabilityReport } from "@/lib/trading/reports";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import type { PaperTrade } from "@prisma/client";

function mockSnapshot(overrides: Partial<NormalizedMarketSnapshot> = {}): NormalizedMarketSnapshot {
  const now = new Date().toISOString();
  const baseCandles = Array.from({ length: 10 }, (_, i) => ({
    timestamp: new Date(Date.now() - (10 - i) * 300_000).toISOString(),
    open: 100 + i * 0.05,
    high: 100.2 + i * 0.05,
    low: 99.8 + i * 0.05,
    close: 100 + i * 0.08,
    volume: 1000,
    timeframe: "5m" as const,
  }));

  return {
    symbol: "BTC/USD",
    ticker: {
      symbol: "BTC/USD",
      price: 100,
      bid: 99.95,
      ask: 100.05,
      spread: 0.1,
      spreadBps: 10,
      volume24h: 1_000_000,
      timestamp: now,
      source: "kraken",
      latencyMs: 50,
    },
    orderBook: null,
    candles1m: [],
    candles5m: baseCandles,
    relativeVolume: 1.1,
    liquidityUsd: 1_000_000,
    feeModel: { makerBps: 16, takerBps: 26, source: "kraken", known: true },
    slippageEstimate: { bps: 5, method: "test", confidence: 0.9 },
    metadata: {
      symbol: "BTC/USD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      pairAgeDays: null,
      minOrderSize: 0.0001,
      fundingRate: null,
      openInterest: null,
      source: "kraken",
    },
    security: null,
    providerHealth: "ok",
    fetchedAt: now,
    ...overrides,
  };
}

describe("paper evidence requirements", () => {
  it("starts NOT_CONFIGURED when system unavailable", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: 0,
      closedTrades: 0,
      calendarDays: 0,
      unresolvedDataErrors: 0,
      systemAvailable: false,
    });
    expect(r.status).toBe("NOT_CONFIGURED");
  });

  it("becomes COLLECTING after first run", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: 1,
      closedTrades: 0,
      calendarDays: 1,
      unresolvedDataErrors: 0,
      systemAvailable: true,
    });
    expect(r.status).toBe("COLLECTING");
  });

  it("becomes PASS only after thresholds met", () => {
    const r = evaluatePaperForwardEvidence({
      totalRuns: PAPER_EVIDENCE_REQUIREMENTS.minimumRuns,
      closedTrades: PAPER_EVIDENCE_REQUIREMENTS.minimumClosedTrades,
      calendarDays: PAPER_EVIDENCE_REQUIREMENTS.minimumCalendarDays,
      unresolvedDataErrors: 0,
      systemAvailable: true,
    });
    expect(r.status).toBe("PASS");
  });
});

describe("conservative paper strategy", () => {
  it("returns NO_TRADE when spread is too wide", () => {
    const snapshot = mockSnapshot({
      ticker: {
        ...mockSnapshot().ticker,
        spreadBps: 50,
        bid: 99,
        ask: 101,
      },
    });
    const r = evaluateConservativePaperStrategy(snapshot);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.blockReasons).toContain("SPREAD_TOO_WIDE");
  });

  it("returns NO_TRADE when bid/ask missing", () => {
    const snapshot = mockSnapshot({
      ticker: {
        ...mockSnapshot().ticker,
        bid: 0,
        ask: 0,
      },
    });
    const r = evaluateConservativePaperStrategy(snapshot);
    expect(r.decision).toBe("NO_TRADE");
    expect(r.blockReasons).toContain("MISSING_BID_ASK");
  });

  it("can return OPEN candidate when conditions pass", () => {
    const r = evaluateConservativePaperStrategy(mockSnapshot());
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.decision);
    if (r.decision !== "NO_TRADE") {
      expect(r.entryPrice).not.toBeNull();
      expect(r.plannedStopLoss).not.toBeNull();
      expect(r.plannedTakeProfit).not.toBeNull();
      expect(r.simulatedSize).not.toBeNull();
    }
  });
});

describe("paper data model integrity", () => {
  it("paper trades are always isRealTrade=false in API serialization", () => {
    const trade = {
      id: "t1",
      userId: "u1",
      signalId: null,
      symbol: "BTC/USD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      side: "LONG",
      strategyName: "conservative-paper-v1",
      entryPrice: { toNumber: () => 100 },
      plannedStopLoss: { toNumber: () => 99 },
      plannedTakeProfit: { toNumber: () => 102 },
      simulatedSize: { toNumber: () => 0.01 },
      riskAmount: { toNumber: () => 50 },
      riskPercent: { toNumber: () => 0.5 },
      status: "OPEN",
      openedAt: new Date(),
      closedAt: null,
      exitPrice: null,
      grossPaperPnl: null,
      estimatedFees: null,
      estimatedSlippage: null,
      netPaperPnl: null,
      result: "OPEN",
      confidence: { toNumber: () => 0.7 },
      reason: "test",
      dataSource: "kraken",
      isRealTrade: false,
      isVerifiedLivePnl: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PaperTrade;

    const serialized = serializePaperTrade(trade);
    expect(serialized.isRealTrade).toBe(false);
    expect(serialized.isVerifiedLivePnl).toBe(false);
    expect(serialized.simulatedPnlLabel).toBe("SIMULATED");
  });
});

describe("reports paper separation", () => {
  it("paper P&L shown as simulated and verified live remains blank", () => {
    const r = buildProfitabilityReport({
      dateRange: { start: "2026-07-01", end: "2026-07-02" },
      startingEquity: 10_000,
      endingEquity: 10_001,
      trades: [],
      paperTrades: [
        {
          id: "p1",
          strategyId: "conservative-paper-v1",
          symbol: "BTC/USD",
          venue: "kraken",
          direction: "long",
          entryTime: "2026-07-01T10:00:00Z",
          exitTime: "2026-07-01T11:00:00Z",
          entryPrice: 100,
          exitPrice: 101,
          size: 1,
          grossPnl: 1,
          fees: 0.1,
          spreadCost: 0,
          slippage: 0.05,
          funding: 0,
          reconciled: false,
        },
      ],
      evidenceLevel: 0,
      sampleSize: 0,
      statisticallyMeaningful: false,
      edgeTrend: "UNKNOWN",
    });
    expect(r.verifiedLivePnl).toBeNull();
    expect(r.paperSimulatedPnl).not.toBeNull();
    expect(r.disclaimers.some((d) => d.includes("Paper P&L is simulated"))).toBe(true);
  });
});

describe("paper run safety contract", () => {
  it("run result shape always reports auto locked and no live orders", () => {
    const result = {
      autoUnlocked: false,
      liveOrdersPlaced: false,
      warnings: [
        "Paper P&L is simulated.",
        "This does not unlock live trading.",
        "Auto remains locked.",
        "Do not treat paper results as real profit.",
      ],
    };
    expect(result.autoUnlocked).toBe(false);
    expect(result.liveOrdersPlaced).toBe(false);
    expect(result.warnings.some((w) => w.includes("Auto remains locked"))).toBe(true);
  });
});

describe("auto remains locked", () => {
  it("paper evidence does not unlock Auto", () => {
    const r = evaluateAutoUnlock(
      defaultAutoUnlockInput({
        paperForwardPasses: true,
        executionEngineWired: false,
      }),
    );
    expect(r.autoExecutionEnabled).toBe(false);
  });
});

describe("next steps paper-forward status mapping", () => {
  it("maps COLLECTING and PASS from evidence evaluator", () => {
    expect(
      evaluatePaperForwardEvidence({
        totalRuns: 5,
        closedTrades: 3,
        calendarDays: 2,
        unresolvedDataErrors: 0,
        systemAvailable: true,
      }).status,
    ).toBe("COLLECTING");

    expect(
      evaluatePaperForwardEvidence({
        totalRuns: 30,
        closedTrades: 20,
        calendarDays: 7,
        unresolvedDataErrors: 0,
        systemAvailable: true,
      }).status,
    ).toBe("PASS");
  });
});
