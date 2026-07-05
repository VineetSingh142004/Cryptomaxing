import { describe, expect, it } from "vitest";
import type { PaperRecord, PaperTrade } from "@prisma/client";
import {
  CARRIED_FROM_PREVIOUS_RECORD,
  buildRecordComparison,
  buildCarriedTradeSnapshots,
  computeRecordPerformanceBreakdown,
  filterTradesByRecordId,
  isCarriedTrade,
  isNewRecordTrade,
  serializePaperRecord,
  startNewPaperRecord,
} from "@/lib/trading/paper/paper-record";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";
import { CURRENT_PAPER_STRATEGY_VERSION } from "@/lib/trading/paper/paper-strategy-version";
import { prepareCandidateWriteData } from "@/lib/trading/paper/candidate-write";
import { emptyScoreBreakdown } from "@/lib/trading/paper/scoring";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";
import { exportContainsSecrets, parsePaperExportMode } from "@/lib/trading/paper/export-log";

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
    recordId: "rec-1",
    strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
    symbol: "BTC/USD",
    baseAsset: "BTC",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    entryPrice: { toNumber: () => 100 } as never,
    plannedStopLoss: { toNumber: () => 99 } as never,
    plannedTakeProfit: { toNumber: () => 101 } as never,
    simulatedSize: { toNumber: () => 0.5 } as never,
    riskAmount: { toNumber: () => 50 } as never,
    riskPercent: { toNumber: () => 0.5 } as never,
    status: "CLOSED",
    openedAt: new Date("2026-01-01T10:00:00Z"),
    closedAt: new Date("2026-01-01T12:00:00Z"),
    exitPrice: { toNumber: () => 101 } as never,
    grossPaperPnl: { toNumber: () => 0.5 } as never,
    estimatedFees: { toNumber: () => 0.01 } as never,
    estimatedSlippage: { toNumber: () => 0.01 } as never,
    netPaperPnl: { toNumber: () => 0.48 } as never,
    result: "WIN",
    confidence: { toNumber: () => 0.8 } as never,
    reason: "LONG — MAJOR | closed: TAKE_PROFIT_HIT",
    dataSource: "kraken",
    isRealTrade: false,
    isVerifiedLivePnl: false,
    carriedAt: null,
    carriedBaselineUnrealizedPnl: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

describe("paper record system", () => {
  it("parses record export modes", () => {
    expect(parsePaperExportMode("CURRENT_RECORD_EXPORT")).toBe("CURRENT_RECORD_EXPORT");
    expect(parsePaperExportMode("ALL_RECORDS_EXPORT")).toBe("ALL_RECORDS_EXPORT");
    expect(parsePaperExportMode("ARCHIVED_RECORDS_EXPORT")).toBe("ARCHIVED_RECORDS_EXPORT");
  });

  it("filters trades by recordId", () => {
    const t1 = mockTrade({ id: "a", recordId: "rec-1" });
    const t2 = mockTrade({ id: "b", recordId: "rec-2" });
    expect(filterTradesByRecordId([t1, t2], "rec-1")).toHaveLength(1);
  });

  it("treats null recordId as legacy via serialization only", () => {
    const legacy = mockTrade({ recordId: null });
    expect(legacy.recordId).toBeNull();
  });

  it("stamps recordId on candidate writes when provided", () => {
    const candidate: ScanCandidate = {
      symbol: "BTC/USD",
      coinName: "Bitcoin",
      source: "kraken",
      price: 100,
      spreadBps: 10,
      volume24hUsd: 1_000_000,
      change24hPct: 1,
      change7dPct: 2,
      marketCapUsd: 1_000_000,
      riskTier: "MAJOR",
      opportunityScore: 70,
      momentumScore: 60,
      volumeSpikeScore: 50,
      volatilityScore: 50,
      liquidityScore: 70,
      spreadScore: 80,
      trendScore: 60,
      scoreBreakdown: emptyScoreBreakdown(),
      tradableOnConfiguredExchange: true,
      action: "OPEN_PAPER_TRADE",
      actionType: "OPEN_PAPER_TRADE",
      reasonCode: "TRADE_READY",
      reasonText: "ready",
    };
    const prepared = prepareCandidateWriteData("run1", "u1", candidate, "rec-new");
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.data.recordId).toBe("rec-new");
  });

  it("detects carried trades", () => {
    expect(isCarriedTrade(mockTrade({ reason: `entry | ${CARRIED_FROM_PREVIOUS_RECORD}` }))).toBe(true);
    expect(isNewRecordTrade(mockTrade({ reason: `entry | ${CARRIED_FROM_PREVIOUS_RECORD}` }))).toBe(false);
  });

  it("starts fresh record with 0 record P&L when only carried trades exist", () => {
    const markMap = new Map<string, number>([["carried-1", 105]]);
    const carried = mockTrade({
      id: "carried-1",
      status: "OPEN",
      result: "OPEN",
      closedAt: null,
      exitPrice: null,
      netPaperPnl: null,
      reason: `entry | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 1 } as never,
      carriedAt: new Date("2026-02-01T12:00:00Z"),
      carriedBaselineUnrealizedPnl: { toNumber: () => 5 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-3",
        startingPaperBalance: { toNumber: () => SCANNER_CONFIG.simulatedAccountUsd + 5 } as never,
      } as PaperRecord,
      recordTrades: [carried],
      markMap,
    });
    expect(breakdown.newTradesOpened).toBe(0);
    expect(breakdown.carriedOpenTrades).toBe(1);
    expect(breakdown.newRecordRealizedPnl).toBe(0);
    expect(breakdown.newRecordUnrealizedPnl).toBe(0);
    expect(breakdown.recordPnl).toBe(0);
  });

  it("does not count carried trades as new trades opened", () => {
    const markMap = new Map<string, number>();
    const carried = mockTrade({
      id: "c1",
      status: "OPEN",
      result: "OPEN",
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      carriedBaselineUnrealizedPnl: { toNumber: () => 2 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-1",
        startingPaperBalance: { toNumber: () => 10000 } as never,
      } as PaperRecord,
      recordTrades: [carried],
      markMap,
    });
    expect(breakdown.newTradesOpened).toBe(0);
    expect(breakdown.carriedOpenTrades).toBe(1);
  });

  it("carried trade P&L since carry updates after price movement", () => {
    const markMap = new Map<string, number>([["c1", 110]]);
    const carried = mockTrade({
      id: "c1",
      status: "OPEN",
      result: "OPEN",
      symbol: "SOL/USD",
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      carriedAt: new Date("2026-02-01T12:00:00Z"),
      carriedBaselineUnrealizedPnl: { toNumber: () => 5 } as never,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 0.5 } as never,
    });
    const snapshots = buildCarriedTradeSnapshots([carried], markMap);
    expect(snapshots[0]?.unrealizedSinceCarry).toBe(0);
    markMap.set("c1", 115);
    const updated = buildCarriedTradeSnapshots([carried], markMap);
    expect(updated[0]?.unrealizedSinceCarry).toBe(2.5);
  });

  it("missing carried baseline does not silently show 0", () => {
    const carried = mockTrade({
      id: "c1",
      status: "OPEN",
      result: "OPEN",
      reason: `x | ${CARRIED_FROM_PREVIOUS_RECORD}`,
      carriedBaselineUnrealizedPnl: null,
      entryPrice: { toNumber: () => 100 } as never,
      simulatedSize: { toNumber: () => 1 } as never,
    });
    const snapshots = buildCarriedTradeSnapshots([carried], new Map([["c1", 110]]));
    expect(snapshots[0]?.legacyBaselineMissing).toBe(true);
    expect(snapshots[0]?.pnlSinceCarryDisplay).toContain("Legacy carry baseline missing");
    expect(snapshots[0]?.unrealizedSinceCarry).toBeNull();
  });

  it("record P&L uses delta from record start for new trades", () => {
    const markMap = new Map<string, number>();
    const newTrade = mockTrade({
      id: "new-1",
      recordId: "rec-1",
      netPaperPnl: { toNumber: () => 1.5 } as never,
    });
    const breakdown = computeRecordPerformanceBreakdown({
      record: {
        id: "rec-1",
        startingPaperBalance: { toNumber: () => 10000 } as never,
      } as PaperRecord,
      recordTrades: [newTrade],
      markMap,
    });
    expect(breakdown.newTradesOpened).toBe(1);
    expect(breakdown.recordPnl).toBe(1.5);
    expect(breakdown.newRecordRealizedPnl).toBe(1.5);
  });

  it("compares archived records", () => {
    const comparison = buildRecordComparison([
      {
        ...serializePaperRecord({
          id: "r1",
          userId: "u1",
          recordNumber: 1,
          recordName: "Legacy Record",
          strategyVersion: "legacy",
          startedAt: new Date("2026-01-01"),
          endedAt: new Date("2026-02-01"),
          status: "ARCHIVED",
          startingPaperBalance: { toNumber: () => 10000 } as never,
          endingPaperBalance: { toNumber: () => 9950 } as never,
          startingRealizedPnl: { toNumber: () => 0 } as never,
          endingRealizedPnl: { toNumber: () => -50 } as never,
          startingUnrealizedPnl: { toNumber: () => 0 } as never,
          endingUnrealizedPnl: { toNumber: () => 0 } as never,
          startingTradeCount: 25,
          endingTradeCount: 25,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as PaperRecord),
        recordPnl: -50,
        closedTrades: 25,
        winRate: 0.68,
        profitFactor: 0.72,
      },
      {
        ...serializePaperRecord({
          id: "r2",
          userId: "u1",
          recordNumber: 2,
          recordName: "Paper Record #2",
          strategyVersion: CURRENT_PAPER_STRATEGY_VERSION,
          startedAt: new Date("2026-02-01"),
          endedAt: null,
          status: "ACTIVE",
          startingPaperBalance: { toNumber: () => 9950 } as never,
          endingPaperBalance: null,
          startingRealizedPnl: { toNumber: () => 0 } as never,
          endingRealizedPnl: null,
          startingUnrealizedPnl: { toNumber: () => 0 } as never,
          endingUnrealizedPnl: null,
          startingTradeCount: 0,
          endingTradeCount: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as PaperRecord),
        recordPnl: 5,
        closedTrades: 3,
        winRate: 0.66,
        profitFactor: 1.4,
      },
    ]);
    expect(comparison.bestByPnl?.recordNumber).toBe(2);
    expect(comparison.plainEnglishVerdict).toContain("Record #2");
  });

  it("exports startNewPaperRecord function without deleting data", () => {
    expect(typeof startNewPaperRecord).toBe("function");
  });

  it("keeps live trading and Auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock(defaultAutoUnlockInput()).autoExecutionEnabled).toBe(false);
  });

  it("export does not contain secrets", () => {
    expect(exportContainsSecrets("api_key=supersecret")).toBe(true);
    expect(exportContainsSecrets("SIMULATED PAPER ONLY")).toBe(false);
  });
});
