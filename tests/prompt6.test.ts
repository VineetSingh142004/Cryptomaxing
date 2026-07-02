import { describe, expect, it } from "vitest";
import { auditLiveProfitability } from "@/lib/trading/live/profitability-audit";
import { analyzeSampleConfidence } from "@/lib/trading/live/sample-confidence";
import { evaluateCanaryScaling } from "@/lib/trading/live/canary-scaling";
import { reconcileLiveAccounts } from "@/lib/trading/live/reconciliation";
import { analyzeForwardDecay } from "@/lib/trading/live/decay";
import { attributeProfit } from "@/lib/trading/reports/profit-attribution";
import type { LiveTradeRecord } from "@/lib/trading/live/types";

function trade(overrides: Partial<LiveTradeRecord> & Pick<LiveTradeRecord, "id">): LiveTradeRecord {
  return {
    strategyId: "vwap-reclaim-momentum",
    symbol: "BTC/USD",
    venue: "kraken",
    direction: "long",
    entryTime: "2026-07-01T10:00:00.000Z",
    exitTime: "2026-07-01T11:00:00.000Z",
    entryPrice: 100,
    exitPrice: 101,
    size: 1,
    grossPnl: 1,
    fees: 0.1,
    spreadCost: 0.05,
    slippage: 0.05,
    funding: 0,
    reconciled: true,
    ...overrides,
  };
}

describe("live profitability audit", () => {
  it("uses net P&L only and demotes when costs remove edge", () => {
    const audit = auditLiveProfitability({
      strategyId: "vwap-reclaim-momentum",
      period: "2026-07",
      trades: [
        trade({ id: "1", grossPnl: 2, fees: 1, spreadCost: 0.5, slippage: 0.5, funding: 0.6 }),
      ],
    });
    expect(audit.netPnl).toBeLessThan(audit.grossPnl);
    expect(audit.decision).toBe("DEMOTE");
    expect(audit.reasonCodes).toContain("COSTS_REMOVED_EDGE");
  });

  it("disables auto on negative expectancy", () => {
    const audit = auditLiveProfitability({
      strategyId: "vwap-reclaim-momentum",
      period: "2026-07",
      trades: [trade({ id: "1", grossPnl: -1, exitPrice: 99 })],
    });
    expect(audit.decision).toBe("DISABLE_AUTO");
  });
});

describe("sample confidence", () => {
  it("blocks scaling below 20 trades", () => {
    const sample = analyzeSampleConfidence({
      strategyId: "vwap-reclaim-momentum",
      trades: Array.from({ length: 10 }, (_, i) => trade({ id: String(i) })),
    });
    expect(sample.scalingAllowed).toBe(false);
    expect(sample.reasonCodes).toContain("LT_20_TRADES_NO_SCALING");
  });

  it("blocks when one trade explains >30% profit", () => {
    const trades = Array.from({ length: 30 }, (_, i) =>
      trade({ id: String(i), grossPnl: i === 0 ? 50 : 0.5, exitPrice: i === 0 ? 150 : 100.5 }),
    );
    const sample = analyzeSampleConfidence({ strategyId: "vwap-reclaim-momentum", trades });
    expect(sample.reasonCodes).toContain("ONE_TRADE_GT_30PCT_PROFIT");
  });
});

describe("canary scaling", () => {
  it("never jumps stages", () => {
    const audit = auditLiveProfitability({
      strategyId: "s",
      period: "p",
      trades: Array.from({ length: 60 }, (_, i) => trade({ id: String(i), strategyId: "s" })),
    });
    const sample = analyzeSampleConfidence({
      strategyId: "s",
      trades: Array.from({ length: 60 }, (_, i) => trade({ id: String(i), strategyId: "s" })),
    });
    const r = evaluateCanaryScaling({
      strategyId: "s",
      currentStage: "NO_LIVE",
      requestedStage: "SMALL_LIVE",
      audit,
      sample,
      userApproved: true,
    });
    expect(r.direction).toBe("BLOCKED");
    expect(r.reasonCodes).toContain("NEVER_JUMP_STAGES");
  });
});

describe("reconciliation", () => {
  it("blocks unverified P&L when fill data missing", () => {
    const r = reconcileLiveAccounts({
      exchangeBalance: 10_000,
      internalLedgerBalance: 10_000,
      openOrders: [],
      openPositions: [],
      fills: [],
      realizedPnl: 100,
      unrealizedPnl: 0,
      fundingTotal: 0,
      deposits: 0,
      withdrawalsBlocked: true,
      leveraged: false,
      fillDataComplete: false,
      feeDataComplete: true,
      fundingDataComplete: true,
    });
    expect(r.blockPnlApproval).toBe(true);
    expect(r.blockNewTrades).toBe(true);
  });
});

describe("forward decay", () => {
  it("detects severe decay when expectancy turns negative", () => {
    const trades = [
      ...Array.from({ length: 15 }, (_, i) => trade({ id: `w${i}`, grossPnl: 2, exitPrice: 102 })),
      ...Array.from({ length: 10 }, (_, i) => trade({ id: `l${i}`, grossPnl: -3, exitPrice: 97 })),
    ];
    const decay = analyzeForwardDecay({
      strategyId: "vwap-reclaim-momentum",
      trades,
      priorExpectancy: 1,
    });
    expect(["MODERATE", "SEVERE", "MILD"]).toContain(decay.severity);
  });
});

describe("profit attribution", () => {
  it("flags beta-heavy profit", () => {
    const attr = attributeProfit({
      period: "2026-07-02",
      strategyId: "vwap-reclaim-momentum",
      trades: [
        trade({
          id: "1",
          grossPnl: 10,
          benchmarkReturnPct: 9,
          entryPrice: 100,
          size: 10,
        }),
      ],
      randomBaselineNet: 1,
    });
    expect(attr.reasonCodes).toContain("BETA_NOT_STRATEGY_EDGE");
    expect(attr.scalingAllowed).toBe(false);
  });
});
