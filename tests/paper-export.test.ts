import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PaperEvidenceRun, PaperTrade } from "@prisma/client";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    paperTrade: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    paperEvidenceRun: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    paperScanCandidate: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    paperSignal: {
      count: vi.fn(),
    },
    paperTradeSnapshot: {
      count: vi.fn(),
    },
    paperTestBaseline: {
      findFirst: vi.fn(),
    },
    paperRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/trading/mode-service", () => ({
  getOrCreateModeState: vi.fn().mockResolvedValue({ current_mode: "PAPER" }),
}));

vi.mock("@/lib/security/auth", () => ({
  getAuthStatus: vi.fn().mockResolvedValue({ status: "LOCAL_OWNER_MODE", localOwnerMode: true }),
}));

vi.mock("@/lib/trading/auto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading/auto")>();
  return {
    ...actual,
    buildAutoUnlockInput: vi.fn().mockResolvedValue({}),
    evaluateAutoUnlock: vi.fn().mockReturnValue({ autoExecutionEnabled: false }),
  };
});

vi.mock("@/lib/trading/paper/safe-check", () => ({
  getMarketDataProviderStatus: vi.fn().mockReturnValue({ configured: true }),
}));

import { prisma } from "@/lib/db/client";
import {
  buildPaperExportLog,
  DEFAULT_PAPER_EXPORT_MODE,
  exportContainsSecrets,
  formatExportLine,
  parsePaperExportMode,
  paperExportFilename,
  streamPaperExportLog,
} from "@/lib/trading/paper/export-log";
import { verifyPaperSafetyGates } from "@/lib/trading/paper/safety-verification";
import { evaluateAutoUnlock } from "@/lib/trading/auto";

function mockRun(index: number): PaperEvidenceRun {
  const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index));
  return {
    id: `run-${index}`,
    userId: "u1",
    status: index % 17 === 0 ? "FAILED" : "COMPLETED",
    startedAt,
    completedAt: new Date(startedAt.getTime() + 5000),
    reasonCode: "SCAN_COMPLETE",
    candidatesStored: 120,
    signalsStored: 0,
    snapshotsStored: 4,
    coinsDiscovered: 200,
    coinsEvaluated: 150,
    tradesOpened: 0,
    tradesUpdated: 4,
    tradesClosed: 0,
    scanSummary: {},
    runWarnings: null,
    runErrors: null,
    actions: ["SCAN", "UPDATE"],
    createdAt: startedAt,
    updatedAt: startedAt,
  } as PaperEvidenceRun;
}

function mockTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "t1",
    userId: "u1",
    signalId: null,
    symbol: "BTC/USD",
    baseAsset: "BTC",
    quoteAsset: "USD",
    side: "LONG",
    strategyName: "controlled-active-paper-v1",
    status: "CLOSED",
    result: "WIN",
    reason: "score: 85 | alloc: 2.5% | leverage: 1x",
    entryPrice: 100,
    exitPrice: 105,
    simulatedSize: 0.01,
    netPaperPnl: 0.05,
    riskAmount: 2.5,
    riskPercent: 2.5,
    plannedStopLoss: 95,
    plannedTakeProfit: 110,
    isRealTrade: false,
    openedAt: new Date("2026-01-01T00:00:00Z"),
    closedAt: new Date("2026-01-02T00:00:00Z"),
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  } as PaperTrade;
}

function setupPrismaMocks(runCount: number, candidateCount: number) {
  const runs = Array.from({ length: runCount }, (_, i) => mockRun(i + 1));
  const trades = [mockTrade(), mockTrade({ id: "t2", status: "OPEN", result: "OPEN", closedAt: null, exitPrice: null, netPaperPnl: null })];
  const candidates = Array.from({ length: Math.min(candidateCount, 200) }, (_, i) => ({
    id: `c-${i}`,
    userId: "u1",
    runId: runs.at(-1)!.id,
    symbol: `COIN${i}/USD`,
    action: "WATCHLIST_ONLY",
    reasonCode: "WATCH",
    reasonText: null,
    opportunityScore: 50 + i,
    riskTier: "MEDIUM",
    volume24hUsd: 1000000,
    change24hPct: 1.5,
    spreadBps: 10,
    tradableOnConfiguredExchange: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  vi.mocked(prisma.paperTrade.findMany).mockImplementation(async (args) => {
    if (args?.where && "status" in args.where && args.where.status === "OPEN") {
      return [{ ...trades[1], snapshots: [{ markPrice: 102, unrealizedPnl: 0.02, capturedAt: new Date() }] }];
    }
    return trades;
  });
  vi.mocked(prisma.paperEvidenceRun.findMany).mockResolvedValue(runs);
  vi.mocked(prisma.paperEvidenceRun.count).mockResolvedValue(runCount);
  vi.mocked(prisma.paperScanCandidate.findMany).mockResolvedValue(candidates as never);
  vi.mocked(prisma.paperScanCandidate.count).mockResolvedValue(candidateCount);
  vi.mocked(prisma.paperSignal.count).mockResolvedValue(0);
  vi.mocked(prisma.paperTradeSnapshot.count).mockResolvedValue(500);
  vi.mocked(prisma.paperTrade.count).mockResolvedValue(0);
  vi.mocked(prisma.paperTrade.updateMany).mockResolvedValue({ count: 0 });
  vi.mocked(prisma.paperTestBaseline.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.paperRecord.findFirst).mockResolvedValue({
    id: "rec-active",
    userId: "u1",
    recordNumber: 1,
    recordName: "Current Paper Record",
    strategyVersion: "v0.9-loss-shield",
    startedAt: new Date("2026-01-01"),
    endedAt: null,
    status: "ACTIVE",
    startingPaperBalance: 10000,
    endingPaperBalance: null,
    startingRealizedPnl: 0,
    endingRealizedPnl: null,
    startingUnrealizedPnl: 0,
    endingUnrealizedPnl: null,
    startingTradeCount: 0,
    endingTradeCount: null,
    notes: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as never);
  vi.mocked(prisma.paperRecord.findMany).mockResolvedValue([
    {
      id: "rec-active",
      userId: "u1",
      recordNumber: 1,
      recordName: "Current Paper Record",
      strategyVersion: "v0.9-loss-shield",
      startedAt: new Date("2026-01-01"),
      endedAt: null,
      status: "ACTIVE",
      startingPaperBalance: 10000,
      endingPaperBalance: null,
      startingRealizedPnl: 0,
      endingRealizedPnl: null,
      startingUnrealizedPnl: 0,
      endingUnrealizedPnl: null,
      startingTradeCount: 0,
      endingTradeCount: null,
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ] as never);
  vi.mocked(prisma.paperRecord.count).mockResolvedValue(0);
  vi.mocked(prisma.paperRecord.aggregate).mockResolvedValue({ _max: { recordNumber: 0 } } as never);
  vi.mocked(prisma.paperRecord.create).mockImplementation(async (args) => ({
    id: "rec-active",
    userId: "u1",
    recordNumber: 1,
    recordName: "Current Paper Record",
    strategyVersion: "v0.9-loss-shield",
    startedAt: new Date(),
    endedAt: null,
    status: "ACTIVE",
    startingPaperBalance: 10000,
    endingPaperBalance: null,
    startingRealizedPnl: 0,
    endingRealizedPnl: null,
    startingUnrealizedPnl: 0,
    endingUnrealizedPnl: null,
    startingTradeCount: 0,
    endingTradeCount: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...args.data,
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("paper export modes", () => {
  it("defaults to FULL_TRADE_LOG_EXPORT", () => {
    expect(parsePaperExportMode(null)).toBe("FULL_TRADE_LOG_EXPORT");
    expect(parsePaperExportMode("invalid")).toBe("FULL_TRADE_LOG_EXPORT");
    expect(DEFAULT_PAPER_EXPORT_MODE).toBe("FULL_TRADE_LOG_EXPORT");
  });

  it("parses explicit export modes", () => {
    expect(parsePaperExportMode("SUMMARY_EXPORT")).toBe("SUMMARY_EXPORT");
    expect(parsePaperExportMode("FULL_DEBUG_EXPORT")).toBe("FULL_DEBUG_EXPORT");
    expect(parsePaperExportMode("CURRENT_RECORD_EXPORT")).toBe("CURRENT_RECORD_EXPORT");
    expect(parsePaperExportMode("ALL_RECORDS_EXPORT")).toBe("ALL_RECORDS_EXPORT");
    expect(parsePaperExportMode("ARCHIVED_RECORDS_EXPORT")).toBe("ARCHIVED_RECORDS_EXPORT");
  });
});

describe("export formatting safety", () => {
  it("handles null and UNKNOWN fields", () => {
    expect(formatExportLine("Duration", null)).toBe("Duration: UNKNOWN");
    expect(formatExportLine("Provider", undefined)).toBe("Provider: UNKNOWN");
    expect(formatExportLine("Score", Number.NaN)).toBe("Score: UNKNOWN");
    expect(formatExportLine("Followed", true)).toBe("Followed: yes");
  });

  it("excludes secret patterns from export text", () => {
    const safe = "Realized P&L: 1.23 SIM\nNo API secrets are included in this export.";
    expect(exportContainsSecrets(safe)).toBe(false);
    expect(exportContainsSecrets("api_key=abc123")).toBe(true);
    expect(exportContainsSecrets("DATABASE_URL=postgres://")).toBe(true);
  });
});

describe("buildPaperExportLog", () => {
  it("exports with 171+ runs without crashing", async () => {
    setupPrismaMocks(171, 10000);
    const text = await buildPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
      mode: "FULL_TRADE_LOG_EXPORT",
    });
    expect(text).toContain("Export mode: FULL_TRADE_LOG_EXPORT");
    expect(text).toContain("Total paper runs: 171");
    expect(text).toContain("SECTION 4 — FULL TRADE HISTORY");
    expect(text).not.toContain("SECTION 5 — LOSING TRADE DIAGNOSIS");
    expect(exportContainsSecrets(text)).toBe(false);
  });

  it("summary export omits trade and run detail sections", async () => {
    setupPrismaMocks(171, 10000);
    const text = await buildPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
      mode: "SUMMARY_EXPORT",
    });
    expect(text).toContain("Export mode: SUMMARY_EXPORT");
    expect(text).toContain("Realized P&L (closed trades)");
    expect(text).not.toContain("SECTION 3 — RUN HISTORY");
    expect(text).not.toContain("SECTION 4 — FULL TRADE HISTORY");
  });

  it("full debug export includes candidate and loss sections", async () => {
    setupPrismaMocks(171, 10000);
    const text = await buildPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
      mode: "FULL_DEBUG_EXPORT",
    });
    expect(text).toContain("Export mode: FULL_DEBUG_EXPORT");
    expect(text).toContain("SECTION 5 — LOSING TRADE DIAGNOSIS");
    expect(text).toContain("SECTION 7 — CANDIDATE HISTORY");
    expect(text).toContain("Recommendation: WATCH");
    expect(exportContainsSecrets(text)).toBe(false);
  });

  it("includes P&L breakdown labels", async () => {
    setupPrismaMocks(5, 100);
    const text = await buildPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
    });
    expect(text).toContain("Realized P&L (closed trades)");
    expect(text).toContain("Unrealized P&L (open trades)");
    expect(text).toContain("Portfolio P&L (realized + unrealized)");
    expect(text).toContain("Gross profit");
    expect(text).toContain("Gross loss");
  });

  it("streams export sections", async () => {
    setupPrismaMocks(10, 50);
    const chunks: string[] = [];
    for await (const chunk of streamPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
      mode: "SUMMARY_EXPORT",
    })) {
      chunks.push(chunk);
    }
    const text = chunks.join("");
    expect(text).toContain("Export mode: SUMMARY_EXPORT");
    expect(text.length).toBeGreaterThan(100);
  });

  it("current record export includes latest run scanner rejections and activity", async () => {
    setupPrismaMocks(5, 100);
    const text = await buildPaperExportLog({
      userId: "u1",
      generatedAt: new Date("2026-07-04T18:00:00Z"),
      mode: "CURRENT_RECORD_EXPORT",
    });
    expect(text).toContain("SECTION 1 — CURRENT RECORD SUMMARY");
    expect(text).toContain("SECTION 2 — CURRENT RECORD LATEST RUN");
    expect(text).toContain("SECTION 3 — CURRENT RECORD SCANNER SUMMARY");
    expect(text).toContain("SECTION 4 — NEW TRADES IN THIS RECORD");
    expect(text).toContain("SECTION 5 — CARRIED OPEN TRADES");
    expect(text).toContain("SECTION 6 — CURRENT RECORD OPEN TRADE REVIEW");
    expect(text).toContain("SECTION 7 — CURRENT RECORD REJECTION SUMMARY");
    expect(text).toContain("SECTION 8 — CURRENT RECORD ACTIVITY FEED");
    expect(text).toContain("SECTION 9 — DATA QUALITY NOTES");
    expect(text).toContain("Runs completed in this record");
    expect(text).toContain("Carried trades being monitored");
  });
});

describe("export safety gates", () => {
  it("keeps live trading and auto locked", () => {
    const safety = verifyPaperSafetyGates();
    expect(safety.liveTradingLocked).toBe(true);
    expect(safety.autoExecutionLocked).toBe(true);
    expect(evaluateAutoUnlock({} as never).autoExecutionEnabled).toBe(false);
  });
});

describe("export filename", () => {
  it("generates mode-specific filename", () => {
    const tradeLog = paperExportFilename(new Date("2026-07-04T15:30:00Z"), "FULL_TRADE_LOG_EXPORT");
    expect(tradeLog).toMatch(/^alpha-autopilot-paper-trade-log-/);
    const debug = paperExportFilename(new Date("2026-07-04T15:30:00Z"), "FULL_DEBUG_EXPORT");
    expect(debug).toContain("full-debug-export");
  });
});

describe("export failure is not a paper run error", () => {
  it("uses separate export status values from run errors", () => {
    const exportStatuses = ["EXPORT_READY", "EXPORT_RUNNING", "EXPORT_FAILED", "EXPORT_DOWNLOADED"] as const;
    expect(exportStatuses).not.toContain("Current run error");
    expect(exportStatuses).toContain("EXPORT_FAILED");
  });
});
