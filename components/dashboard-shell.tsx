"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ModeSelector } from "@/components/mode-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/lib/config/constants";
import { formatApiError, parseApiError } from "@/lib/utils/api-error";
import { formatVerifyReasonMessage, formatVerificationStatusLabel } from "@/lib/utils/verify-readonly-messages";

interface NextStepItem {
  id: string;
  label: string;
  status: string;
  note?: string;
}

interface SafeCheckResult {
  status: string;
  dataSource: string;
  liveMarketDataConfigured: boolean;
  paperModeReady: boolean;
  sameDayEvidenceExists: boolean;
  missingRequirements: string[];
  nextRecommendedAction: string;
}

interface ExchangeAccountReadiness {
  readOnlyKeyConfigured: boolean;
  provider: string | null;
  credentialEnabled: boolean;
  verificationStatus: "READY" | "PARTIAL" | "FAILED" | "UNKNOWN";
  lastVerifiedAt: string | null;
  lastVerificationReason: string | null;
  providerHealthy: boolean;
  permissionsVerifiedAsReadOnly: boolean;
  canReadBalance: boolean;
  canReadOpenOrders: boolean;
  canReadClosedOrders: boolean;
  canReadTradeHistory: boolean;
  tradeHistoryReadStatus?: "YES" | "NO" | "EMPTY";
  tradeHistoryCount?: number | null;
  endpointResults: Array<{
    endpoint: string;
    success: boolean;
    reasonCode: string;
    krakenErrorCode: string | null;
    safeMessage: string | null;
  }>;
  permissionWarning: string | null;
  krakenError: string | null;
  tradingPermissionDetected: "BLOCKED" | "UNKNOWN" | "NO";
  withdrawalPermissionDetected: "BLOCKED" | "UNKNOWN" | "NO";
  liveTradingLocked: true;
  autoExecutionLocked: true;
}

interface DashboardData {
  version: string;
  auto_unlock: {
    decision: string;
    auto_execution_enabled: boolean;
    failed_gate_count: number;
    scaling_allowed: boolean;
    safest_next_action?: string;
  };
  why_waiting: string[];
  why_blocked: string[];
  same_day_reality: {
    status: string;
    headline: string;
    evidence_present: string[];
    evidence_missing: string[];
    warnings: string[];
    may_trade_live_today: boolean;
    may_tiny_canary: boolean;
  };
  readiness: { passed: number; failed: number; partial: number };
  workers: { total: number; defined: number; not_implemented: number };
  disclaimers: string[];
  next_steps?: string[];
  next_steps_checklist?: NextStepItem[];
  auth?: { implemented: boolean; configured?: boolean; status: string; user?: { email: string } | null };
  encryption?: {
    production_safe: boolean;
    vault_writes_allowed: boolean;
    block_reasons: string[];
    warning: string | null;
  };
  paper_mode?: { safe_to_test: boolean; places_real_orders: boolean; note: string };
  paper_evidence?: PaperEvidenceData | null;
  exchange_account_readiness?: ExchangeAccountReadiness | null;
  scanner_provider_status?: {
    providers: Array<{
      provider: string;
      label: string;
      status: string;
      enabled: boolean;
      contributedLastRun: boolean;
      connectionStatus: string;
      connectionStatusLabel?: string;
      currentRunContribution?: string;
      currentRunReason?: string | null;
    }>;
    lastRunContributions: {
      coingeckoContributed: boolean;
      krakenContributed: boolean;
      dexscreenerContributed: boolean;
      defillamaContributed: boolean;
      lunarcrushContributed: boolean;
    } | null;
  };
}

interface PaperEvidenceData {
  paperModeReady: boolean;
  marketDataReady: boolean;
  paperRuns: number;
  candidatesStored: number;
  signalsStored: number;
  snapshotsStored: number;
  paperEvidenceCountTotal: number;
  paperEvidenceCount: number;
  openPaperTrades: number;
  closedPaperTrades: number;
  noTradeSignals: number;
  maxOpenTrades: number;
  maxOpenTradesReached: boolean;
  availableSlots?: number;
  newTradeOpening: string;
  maxOpenTradesBlockReason: string | null;
  rotationEnabled?: boolean;
  rotationMode?: string;
  rotationWarning?: string | null;
  missedOpportunitiesTotal?: number;
  openTradeCapacity?: {
    maxOpenTrades: number;
    baseMaxOpenTrades?: number;
    dynamicMaxOpenTrades?: number;
    fixedMaxOpenTrades?: number;
    openTrades: number;
    availableSlots: number;
    newTradeOpening: string;
    maxOpenTradesBlockReason: string | null;
    rotationEnabled: boolean;
    totalExposurePct?: number;
    currentExposureUsd?: number;
    maxTotalExposurePct?: number;
    dailyRiskBudgetUsd?: number;
    dailyRiskBudgetPct?: number;
    riskUsedTodayUsd?: number;
    riskUsedTodayPct?: number;
    capacityLimitedBy?: string | null;
    newTradeAllowedReason?: string;
    capacityFactors?: string[];
    openTradeDetails?: Array<{
      symbol: string;
      side: string;
      status: string;
      entryPrice: number | null;
      currentPrice: number | null;
      unrealizedSimulatedPnl: number | null;
      ageHours: number | null;
      plannedStopLoss: number | null;
      plannedTakeProfit: number | null;
      expiresAt: string | null;
      opportunityScore: number | null;
      riskTier: string | null;
      rotationEligibility?: string;
      rotationEligibilityReason?: string;
      unrealizedPnlBps?: number | null;
      distanceToTargetBps?: number | null;
      nearTakeProfit?: boolean;
      weaknessScore?: number;
      simulatedPnlLabel: string;
    }>;
  };
  missedOpportunities?: {
    missedOpportunitiesTotal: number;
    missedOpportunitiesThisRun: number;
    rotationHint: string | null;
    topMissedOpportunities: Array<{
      symbol: string;
      score: number | null;
      riskTier: string | null;
      reason: string;
      blockedByMaxOpenTrades: boolean;
    }>;
  };
  paperRotation?: {
    rotationConfig: {
      enabled: boolean;
      requireProfit: boolean;
      minScoreAdvantage: number;
      minExitPnlBps: number;
    };
    rotationsTotal: number;
    rotationsThisRun: number;
    missedDueToNoSafeExit: number;
    missedDueToScoreTooSmall: number;
    rotationEvents: Array<{
      rotatedOut: string;
      rotatedIn: string;
      exitSimulatedPnl: number | null;
      scoreAdvantage: number | null;
      reason: string;
    }>;
  };
  prismaClientStale?: boolean;
  prismaStaleMessage?: string | null;
  historicalPrismaWarning?: string | null;
  latestRunStatus?: string | null;
  latestRunReasonCode?: string | null;
  lastRunAt: string | null;
  currentStatus: string;
  nextAction: string;
  simulatedNetPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CAUTION_MODE" | "RISK_MODE_ACTIVE";
  recordCautionMode?: {
    active: boolean;
    mode: string;
    dashboardLabel: string;
    dashboardMessage: string;
    allocationMultiplier: number;
    reasons: string[];
    simulatedLabel: "SIMULATED_PAPER_ONLY";
  };
  recordLossAudits?: Array<Record<string, unknown>>;
  riskConfig?: Record<string, unknown>;
  dataTruth?: {
    marketData: { label: string; detail: string };
    paperTrades: { label: string; detail: string };
    pnl: { label: string; detail: string };
  };
  activeTradingRules?: {
    groups: Array<{ title: string; rules: string[]; simulatedOnly: boolean }>;
    safetyCaps: string[];
    liveTradingLocked: true;
    autoExecutionLocked: true;
  };
  lossAnalysis?: {
    losses: Array<{
      tradeId?: string;
      symbol: string;
      entryPrice?: number | null;
      exitPrice?: number | null;
      entryReason: string;
      exitReason: string | null;
      scoreAtEntry: number | null;
      allocationPct: number | null;
      stopLossDistancePct: number | null;
      takeProfitDistancePct: number | null;
      spreadAtEntry: string;
      volumeLiquidity: string;
      lossAmount?: number | null;
      lossPct?: number | null;
      averageLossTooLarge?: boolean | null;
      exitTooLate?: boolean | null;
      stopLossHit?: boolean | null;
      momentumReversed: boolean | null;
      volumeWeakened?: boolean | null;
      spreadWidened?: boolean | null;
      fakePumpRisk: boolean | null;
      suggestedFix?: string;
      suggestedRuleImprovement?: string;
      netPnl: number | null;
    }>;
    analyzedCount: number;
    note: string;
  };
  warning: string;
  evidenceCollectionMessage?: string;
  hasPaperRuns?: boolean;
  performanceSummary?: {
    startingPaperBalance: number;
    currentPaperBalance: number;
    totalNetPnl: number;
    totalGrossProfit: number;
    totalGrossLoss: number;
    totalRealizedPnl: number;
    totalUnrealizedPnl: number;
    totalClosedTrades: number;
    totalOpenTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number | null;
    averageWinningTrade: number | null;
    averageLosingTrade: number | null;
    profitFactor: number | null;
    expectancyPerTrade: number | null;
    largestWin: number | null;
    largestLoss: number | null;
    bestCoin: string | null;
    worstCoin: string | null;
    mostTradedCoin: string | null;
    averageTradeDurationHours: number | null;
    stopLossHitCount: number;
    takeProfitHitCount: number;
    expiryExitCount: number;
    thesisInvalidationExitCount: number;
    currentExposurePct: number | null;
    capitalExposurePct?: number | null;
    riskAtStopPct?: number | null;
    maxExposureUsedPct: number | null;
    largestSingleTradeExposurePct: number | null;
    exposureExplanation: string | null;
    maxDrawdownSimulated: number | null;
    simpleVerdict: string;
    improvementItems: string[];
    simulatedLabel: string;
  };
  profitQuality?: {
    startingPaperBalance: number;
    currentPaperBalance: number;
    totalRealizedPnl: number;
    totalUnrealizedPnl: number;
    portfolioPnl: number;
    totalGrossProfit: number;
    totalGrossLoss: number;
    wins: number;
    losses: number;
    winRate: number | null;
    averageWin: number | null;
    averageLoss: number | null;
    avgLossToWinRatio: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    largestWin: number | null;
    largestLoss: number | null;
    maxDrawdown: number | null;
    currentExposurePct: number | null;
    capitalExposurePct?: number | null;
    riskAtStopPct?: number | null;
    riskMode: {
      active: boolean;
      reasons: string[];
      dashboardLabel: string;
      dashboardMessage: string;
      performanceScope?: "all_time" | "strategy_version" | "baseline";
      performanceScopeLabel?: string;
    };
    profitQualityVerdict: string;
    healthStatus: string;
    simulatedLabel: string;
  };
  historyDiagnostic?: {
    totalClosedLosses: number;
    wouldBlockAtEntry: Array<{ symbol: string; netPnl: number }>;
    wouldReduceSize: Array<{ symbol: string; netPnl: number }>;
    wouldExitEarlier: Array<{ symbol: string; netPnl: number }>;
    estimatedLossReductionUsd: number;
    winnersStillPassing: number;
    winnersBlocked: number;
    overFilterWarning: string | null;
    simulatedLabel: string;
  };
  liveTradingLocked?: true;
  autoExecutionLocked?: boolean;
  nextSafeAction?: string;
  tradeHistory?: {
    rows: Array<{
      tradeNumber: number;
      coin: string;
      exchange: string;
      marketType: string;
      allocationPct?: number | null;
      leverageUsed: number;
      entryTime: string | null;
      exitTime: string | null;
      entryPrice: number | null;
      exitPrice: number | null;
      netPnl: number | null;
      pctGainLoss: number | null;
      durationHours: number | null;
      entryReason: string;
      exitReason: string | null;
      finalResult: string;
      simulatedLabel: string;
    }>;
    summary: {
      totalTrades: number;
      profitableTrades: number;
      losingTrades: number;
      winRate: number | null;
      netProfitLoss: number;
      averageLeverageUsed: number | null;
      mostTradedCoin: string | null;
      simulatedLabel: string;
    };
    warning: string;
  };
  safetyVerification?: {
    liveTradingLocked: true;
    autoExecutionLocked: boolean;
    checks: Array<{ id: string; passed: boolean; note: string }>;
    simulatedLabel: string;
  };
  currentStrategyVersion?: string;
  activeRecord?: {
    recordId: string;
    recordNumber: number;
    recordName: string;
    strategyVersion: string;
    startedAt: string;
  };
  currentRecord?: Record<string, number | string | null | undefined>;
  recordHistory?: Array<{
    recordId: string;
    recordNumber: number;
    recordName: string;
    strategyVersion: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
    recordPnl: number | null;
    closedTrades: number;
    winRate: number | null;
    profitFactor: number | null;
  }>;
  archivedRecords?: Array<Record<string, unknown>>;
  recordComparison?: { plainEnglishVerdict: string };
  carriedOpenTradesCount?: number;
  carriedOpenTradesDetail?: Array<{
    tradeId: string;
    symbol: string;
    side: string;
    originalEntryTime: string;
    carriedIntoRecordTime: string;
    entryPrice: number;
    currentPrice: number;
    unrealizedSinceCarry: number;
    allTimeUnrealizedPnl: number;
    status: string;
    legacyBaselineMissing?: boolean;
    pnlSinceCarryDisplay?: string;
  }>;
  allTimeDebug?: {
    paperRuns: number;
    simulatedNetPnl: number;
    closedPaperTrades: number;
    openPaperTrades: number;
    wins: number;
    losses: number;
    lastRunAt: string | null;
  };
  defaultDashboardView?: "current_record" | "all_time";
  dashboardDataSource?: {
    label: string;
    recordId: string;
    recordNumber: number;
    recordName: string;
    startedAt: string;
    scopeNote: string;
    simulatedLabel: string;
  };
  recordWarnings?: string[];
  botHealthCheck?: {
    isWorking: boolean;
    latestRunCompleted: boolean;
    latestRunTime: string | null;
    latestRunUpdatedTrades: boolean;
    candidatesScanned: number;
    currentRecordRuns: number;
    carriedTradesMonitored: number;
    tradesUpdatedInRecord?: number;
    rejectionsInRecord?: number;
    currentReason: string | null;
    plainEnglishSummary: string;
  };
  recordActivityCounts?: {
    runsCompletedInRecord: number;
    tradesUpdatedInRecord: number;
    candidatesScannedInRecord: number;
    rejectionsInRecord: number;
    newTradesOpenedInRecord?: number;
    carriedTradesMonitored?: number;
  };
  latestRecordRun?: {
    runId: string | null;
    startedAt: string | null;
    completedAt: string | null;
    status: string | null;
    reasonCode: string | null;
    reasonText: string | null;
    candidatesStored: number;
    signalsStored: number;
    snapshotsStored: number;
    tradesOpened: number;
    tradesUpdated: number;
    tradesClosed: number;
    rejectionSummary: Record<string, number>;
    rejectionCategories?: Record<string, number>;
    bestDecision: string | null;
    emptyMessage: string | null;
    pnlSource?: string;
    pnlUnavailableMessage?: string | null;
  };
  recordScanner?: PaperEvidenceData["scanner"] & {
    rejectionCategories?: Record<string, number>;
  };
  scanner?: {
    scannerMode?: string;
    dataSources?: string[];
    coinsDiscovered?: number;
    coinsEvaluated?: number;
    pipeline?: {
      coinsDiscovered?: number;
      coinsScanned?: number;
      coinsFilteredOut?: number;
      removedByVolume?: number;
      removedByMarketCapRisk?: number;
      removedByExchangeAvailability?: number;
      removedByUsAvailability?: number;
      passedBasicFilters?: number;
      deepEvaluated?: number;
      deepEvaluationLimit?: number;
      deepEvaluationLimitReason?: string;
      finalCandidates?: number;
      finalPaperTradeCandidates?: number;
      watchOnlyCandidates?: number;
      selectionExplanation?: string;
      providerStatus?: Record<string, string>;
    };
    finalCandidateOutputs?: Array<{
      name: string;
      symbol: string;
      currentPrice: number;
      volume24hUsd: number;
      change24hPct: number;
      change7dPct: number | null;
      scores: {
        momentum: number;
        volume: number;
        liquidity: number;
        socialHype: number;
        risk: number;
        finalTotal: number;
        confidenceLevel: string;
        riskLevel: string;
      };
      availabilitySummary: {
        krakenSpotAvailable: string;
        krakenLeverageAvailable: string;
        perpFuturesAvailable: string;
        usAvailability: string;
        bestExchange: string;
      };
      recommendedTradeType: string;
      recommendedLeverage: string;
      recommendedCapitalAllocationPct: number;
      finalRecommendation: string;
      simulatedLabel: string;
    }>;
    scannerHealth?: {
      universeSize: number;
      symbolsScanned: number;
      successfulFetches: number;
      failedFetches: number;
      averageSpreadBps: number | null;
      staleSymbols: number;
      watchlistCount?: number;
      highVolCount?: number;
    };
    topGainers?: Array<{
      symbol: string;
      change24hPct?: number;
      volume24hUsd?: number;
      riskTier?: string;
    }>;
    highVolatilityOpportunities?: Array<{
      symbol: string;
      score: number | null;
      change24hPct?: number | null;
      riskTier?: string | null;
      action?: string;
      reason?: string;
    }>;
    tradablePaperCandidates?: Array<{
      symbol: string;
      score: number | null;
      riskTier?: string | null;
      action?: string;
      reason?: string;
    }>;
    watchlistOnlyMovers?: Array<{
      symbol: string;
      score: number | null;
      change24hPct?: number | null;
      reason?: string;
    }>;
    rejectedExamples?: Array<{
      symbol: string;
      reasonCode?: string;
      reason?: string;
    }>;
    topCandidates?: Array<{
      symbol: string;
      price: number | null;
      score: number | null;
      spreadBps: number | null;
      volume24hUsd: number | null;
      change24hPct?: number | null;
      riskTier?: string | null;
      action: string;
      reason: string;
      reasonCode: string;
      runDisplayLabel?: string;
    }>;
    whyNoTrade?: {
      topReasons: Array<{ reason: string; count: number }>;
      examples: Array<{ symbol: string; reason: string; score: number | null }>;
    } | null;
    rejectionSummary?: Record<string, number>;
  } | null;
}

interface PaperRunResult {
  runId: string;
  status: string;
  reasonCode?: string;
  reasonText?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  paperRunsBefore?: number;
  paperRunsAfter?: number;
  evidenceCountBefore?: number;
  evidenceCountAfter?: number;
  countDelta?: number;
  candidatesStored?: number;
  signalsStored?: number;
  snapshotsStored?: number;
  latestAction: string;
  scannerMode?: string;
  dataSources?: string[];
  coinsDiscovered?: number;
  coinsEvaluated?: number;
  universeSize?: number;
  scannedSymbolCount?: number;
  rankedCandidateCount?: number;
  evaluatedCandidateCount?: number;
  watchlistCount?: number;
  highVolCount?: number;
  tradesOpened?: number;
  tradesUpdated?: number;
  tradesClosed?: number;
  openTradesBefore?: number;
  openTradesAfter?: number;
  maxOpenTrades?: number;
  maxOpenTradesReached?: boolean;
  candidateWriteFailures?: number;
  snapshotWriteFailures?: number;
  errors?: string[];
  runOutcomeMessage?: string;
  noTradeCount?: number;
  topCandidates?: Array<{
    symbol: string;
    opportunityScore: number;
    spreadBps: number;
    change24hPct?: number;
    riskTier?: string;
    action: string;
    reasonCode: string;
    reasonText: string;
    recommendationLabel?: string;
    runDisplayLabel?: string;
  }>;
  highVolatilityOpportunities?: Array<{
    symbol: string;
    opportunityScore: number;
    riskTier?: string;
    change24hPct?: number;
    reasonText: string;
  }>;
  tradablePaperCandidates?: Array<{
    symbol: string;
    opportunityScore: number;
    riskTier?: string;
    reasonText: string;
  }>;
  watchlistOnlyMovers?: Array<{
    symbol: string;
    change24hPct?: number;
    reasonText: string;
  }>;
  rejectionSummary?: Record<string, number>;
  openedTrades?: Array<{
    symbol: string;
    side: string;
    status: string;
    riskTier?: string;
    riskPercent?: number;
    warning?: string;
  }>;
  actions: string[];
  errorCount: number;
  openPaperTrades: number;
  closedPaperTrades: number;
  noTradeSignals: number;
  simulatedNetPnl: number;
  portfolioSimulatedNetPnl?: number;
  portfolioPnlBeforeRun?: number;
  portfolioPnlAfterRun?: number;
  realizedPnlThisRun?: number;
  unrealizedPnlChangeThisRun?: number;
  currentRunPnlDelta?: number;
  deepEvaluationLimit?: number;
  skippedFromDeepEvaluation?: number;
  deepEvaluationExplanation?: string;
  deepEvaluationCapFromEnv?: boolean;
  passedBasicFilters?: number;
  dynamicCapacity?: {
    baseMaxOpenTrades: number;
    dynamicMaxOpenTrades: number;
    currentOpenTrades: number;
    availableSlots: number;
    factors: string[];
  };
  warnings: string[];
  autoUnlocked: boolean;
  liveOrdersPlaced: boolean;
}

interface SessionData {
  status: string;
  user?: { email: string } | null;
}

export function DashboardShell() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [safeCheck, setSafeCheck] = useState<SafeCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [safeCheckLoading, setSafeCheckLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<Record<string, unknown> | null>(null);
  const [paperRunLoading, setPaperRunLoading] = useState(false);
  const [paperRunElapsedMs, setPaperRunElapsedMs] = useState(0);
  const [paperRunResult, setPaperRunResult] = useState<PaperRunResult | null>(null);
  const [paperRunWarnings, setPaperRunWarnings] = useState<string[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [paperRunError, setPaperRunError] = useState<string | null>(null);
  const [exportLogLoading, setExportLogLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<
    "EXPORT_READY" | "EXPORT_RUNNING" | "EXPORT_FAILED" | "EXPORT_DOWNLOADED"
  >("EXPORT_READY");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordMessage, setRecordMessage] = useState<string | null>(null);
  const [recordNameInput, setRecordNameInput] = useState("");
  const [recordStartMode, setRecordStartMode] = useState<"soft" | "clean">("soft");
  const [showStartRecordDialog, setShowStartRecordDialog] = useState(false);
  const [pendingOpenTradeCount, setPendingOpenTradeCount] = useState(0);
  const [dashboardView, setDashboardView] = useState<"current_record" | "all_time">("current_record");

  const isCurrentRecordView = dashboardView === "current_record";
  const isAllTimeView = dashboardView === "all_time";

  function fmtMetric(value: number | null | undefined, digits = 4): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "UNKNOWN";
    return value.toFixed(digits);
  }

  async function exportPaperLogMode(mode: string, recordId?: string) {
    setExportLogLoading(true);
    setExportStatus("EXPORT_RUNNING");
    setExportMessage(null);
    try {
      const params = new URLSearchParams({ mode });
      if (recordId) params.set("recordId", recordId);
      const res = await fetch(`/api/paper/export-log?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "alpha-autopilot-paper-log.txt";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus("EXPORT_DOWNLOADED");
      setExportMessage("Paper log downloaded successfully.");
    } catch {
      setExportStatus("EXPORT_FAILED");
      setExportMessage("Export failed. Paper run is still healthy.");
    } finally {
      setExportLogLoading(false);
    }
  }

  async function startPaperRecord(carryOpenTrades = false) {
    setRecordLoading(true);
    setRecordMessage(null);
    try {
      const res = await fetch("/api/paper/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordName: recordNameInput.trim() || undefined,
          carryOpenTrades,
          startMode: recordStartMode,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.reason === "OPEN_TRADES_EXIST") {
        if (body.startMode === "clean") {
          setRecordMessage(
            body.message ??
              "Clean Fresh Start requires no open paper trades. Choose Soft Fresh Start to carry them separately, or wait until they close.",
          );
          return;
        }
        setPendingOpenTradeCount(body.openTradeCount ?? 0);
        setShowStartRecordDialog(true);
        return;
      }
      if (!res.ok) {
        throw new Error(body?.error?.message ?? body?.error ?? body?.message ?? "Start new record failed");
      }
      setRecordMessage(
        body.message ??
          "New record started. Dashboard now shows this record only. Carried trades are monitored separately.",
      );
      setShowStartRecordDialog(false);
      setRecordNameInput("");
      await fetchDashboard();
    } catch (err) {
      setRecordMessage(err instanceof Error ? err.message : "Start new record failed");
    } finally {
      setRecordLoading(false);
    }
  }

  async function exportPaperLog() {
    await exportPaperLogMode("FULL_TRADE_LOG_EXPORT");
  }

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, sessionRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/auth/session"),
      ]);
      if (!dashRes.ok) {
        const apiErr = await parseApiError(dashRes);
        throw new Error(formatApiError(apiErr, "Dashboard unavailable"));
      }
      const json = (await dashRes.json()) as DashboardData & {
        same_day_reality: Record<string, unknown>;
      };
      setData({
        ...json,
        same_day_reality: {
          status: String(json.same_day_reality.status ?? "UNKNOWN"),
          headline: String(json.same_day_reality.headline ?? ""),
          evidence_present: (json.same_day_reality.evidencePresent as string[]) ?? [],
          evidence_missing: (json.same_day_reality.evidenceMissing as string[]) ?? [],
          warnings: (json.same_day_reality.warnings as string[]) ?? [],
          may_trade_live_today: Boolean(json.same_day_reality.mayTradeLiveToday),
          may_tiny_canary: Boolean(json.same_day_reality.mayTinyCanary),
        },
      });
      if (sessionRes.ok) {
        setSession((await sessionRes.json()) as SessionData);
      }
      setDashboardError(null);
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!paperRunLoading) {
      setPaperRunElapsedMs(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setPaperRunElapsedMs(Date.now() - started);
    }, 250);
    return () => window.clearInterval(timer);
  }, [paperRunLoading]);

  async function runSafeCheck() {
    setSafeCheckLoading(true);
    try {
      const res = await fetch("/api/paper/safe-check", { method: "POST" });
      if (!res.ok) throw new Error("Safe check failed");
      setSafeCheck((await res.json()) as SafeCheckResult);
    } catch (err) {
      setPaperRunError(err instanceof Error ? err.message : "Safe check failed");
    } finally {
      setSafeCheckLoading(false);
    }
  }

  async function runPaperEvidenceStep() {
    setPaperRunLoading(true);
    setPaperRunError(null);
    setPaperRunWarnings([]);
    try {
      const res = await fetch("/api/paper/run", { method: "POST" });
      const json = (await res.json()) as PaperRunResult & {
        reasonCode?: string;
        reasonText?: string;
        error?: { reasonCode?: string; message?: string };
      };

      if (!res.ok) {
        const code = json.error?.reasonCode ?? json.reasonCode ?? "PAPER_RUN_ROUTE_FAILED";
        const msg = json.error?.message ?? json.reasonText ?? "Paper evidence run failed";
        throw new Error(`[${code}] ${msg}`);
      }

      setPaperRunResult(json);
      setPaperRunWarnings(json.warnings ?? []);

      if (json.status === "FAILED") {
        const code = json.reasonCode ?? json.error?.reasonCode ?? "PAPER_RUN_FAILED";
        const text = json.reasonText ?? json.error?.message ?? "No useful evidence was saved.";
        setPaperRunError(`[${code}] ${text}`);
      } else {
        setPaperRunError(null);
      }

      await fetchDashboard();
    } catch (err) {
      setPaperRunError(err instanceof Error ? err.message : "Paper evidence run failed");
      setPaperRunWarnings([]);
    } finally {
      setPaperRunLoading(false);
    }
  }

  async function runVerifyReadOnlyKey() {
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/vault/verify-readonly", { method: "POST" });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(String((json as { error?: { message?: string } }).error?.message ?? "Verify failed"));
      }
      setVerifyResult(json);
      if (!json.safeToUseForReadOnly) {
        const hint = formatVerifyReasonMessage(json.reasonCode);
        if (hint) setPaperRunError(hint);
      }
      await fetchDashboard();
    } catch (err) {
      setPaperRunError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">
              Crypto intraday trading operating system
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {session?.status === "LOCAL_OWNER_MODE" ? (
              <div className="flex flex-col items-end gap-1">
                <Badge variant="outline">Local Owner Mode</Badge>
                <span className="text-xs text-amber-600">
                  Single-user local mode — do not expose this app publicly
                </span>
              </div>
            ) : session?.status === "AUTH_READY" && session.user ? (
              <>
                <span className="text-sm text-muted-foreground">{session.user.email}</span>
                <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
                  Sign out
                </Button>
              </>
            ) : (
              <Link href="/login">
                <Button variant="outline" size="sm">
                  Sign in
                </Button>
              </Link>
            )}
            <Link href="/settings/api">
              <Button variant="outline" size="sm">
                API Vault
              </Button>
            </Link>
            <Badge variant="outline">v{data?.version ?? "0.8.0"}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="grid gap-6 md:grid-cols-2">
          <ModeSelector />

          <Card>
            <CardHeader>
              <CardTitle>Auto Unlock Status</CardTitle>
              <CardDescription>Strict gates — never scales on backtest alone</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {loading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : dashboardError ? (
                <p className="text-destructive">{dashboardError}</p>
              ) : data ? (
                <>
                  <StatusRow label="Decision" status={data.auto_unlock.decision} />
                  <StatusRow
                    label="Auto execution"
                    status={data.auto_unlock.auto_execution_enabled ? "ENABLED" : "LOCKED"}
                  />
                  <StatusRow label="Failed gates" status={String(data.auto_unlock.failed_gate_count)} />
                  <StatusRow
                    label="Scaling allowed"
                    status={data.auto_unlock.scaling_allowed ? "YES" : "NO"}
                  />
                  {data.auto_unlock.safest_next_action && (
                    <p className="text-xs text-muted-foreground">{data.auto_unlock.safest_next_action}</p>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Paper Evidence</CardTitle>
            <CardDescription>
              Simulated forward evidence — public Kraken market data only, no live orders
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.paper_evidence || (paperRunResult?.paperRunsAfter ?? 0) > 0 ? (
              <>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1">
                  <p>{data?.paper_evidence?.warning ?? "Paper P&L is simulated — not live proof"}</p>
                  <p>
                    {data?.paper_evidence?.evidenceCollectionMessage ??
                      ((paperRunResult?.paperRunsAfter ?? 0) > 0
                        ? "Paper evidence collecting."
                        : "No paper evidence runs yet.")}
                  </p>
                  <p>Live trading: LOCKED · Auto: LOCKED · All P&L is SIMULATED</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="text-xs font-medium">Dashboard View:</span>
                  <Button
                    size="sm"
                    variant={isCurrentRecordView ? "default" : "outline"}
                    onClick={() => setDashboardView("current_record")}
                  >
                    Current Record
                  </Button>
                  <Button
                    size="sm"
                    variant={isAllTimeView ? "default" : "outline"}
                    onClick={() => setDashboardView("all_time")}
                  >
                    All-Time / Debug
                  </Button>
                </div>

                {isCurrentRecordView && data?.paper_evidence?.dashboardDataSource && (
                  <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs space-y-1">
                    <p className="font-medium">
                      Dashboard data source: {data.paper_evidence.dashboardDataSource.label}
                    </p>
                    <p className="text-muted-foreground">
                      Active record ID: {data.paper_evidence.dashboardDataSource.recordId}
                    </p>
                    <p className="text-muted-foreground">
                      Record started:{" "}
                      {new Date(data.paper_evidence.dashboardDataSource.startedAt).toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">{data.paper_evidence.dashboardDataSource.scopeNote}</p>
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.botHealthCheck?.isWorking &&
                  (data.paper_evidence.recordActivityCounts?.newTradesOpenedInRecord ?? 0) === 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                    Bot is working. It is scanning and rejecting weak setups. No new trade was opened because no setup passed the filters.
                  </p>
                )}

                {isCurrentRecordView && data?.paper_evidence?.performanceSummary && (
                  <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
                    <p className="text-sm font-semibold">CURRENT RECORD — SIMULATED</p>
                    <p className="text-xs text-muted-foreground">
                      Record #{data.paper_evidence.activeRecord?.recordNumber ?? "—"} ·{" "}
                      {data.paper_evidence.activeRecord?.recordName ?? "Current Paper Record"} ·{" "}
                      {data.paper_evidence.activeRecord?.strategyVersion ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started:{" "}
                      {data.paper_evidence.activeRecord?.startedAt
                        ? new Date(data.paper_evidence.activeRecord.startedAt).toLocaleString()
                        : "—"}
                    </p>
                    {(data.paper_evidence.performanceSummary as { freshRecordMessage?: string | null })
                      .freshRecordMessage && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        {
                          (data.paper_evidence.performanceSummary as { freshRecordMessage?: string | null })
                            .freshRecordMessage
                        }
                      </p>
                    )}
                    <p className="text-sm italic text-muted-foreground">
                      {data.paper_evidence.performanceSummary.simpleVerdict}
                    </p>
                    {(
                      data.paper_evidence as {
                        recordVerdicts?: {
                          totalRecordVerdict: { code: string; message: string };
                          newTradesVerdict: { code: string; message: string };
                          carriedTradesVerdict: { code: string; message: string };
                        };
                      }
                    ).recordVerdicts && (
                      <div className="space-y-1 text-xs border rounded p-2 bg-background/50">
                        <p>
                          <span className="font-medium">Total Record Verdict:</span>{" "}
                          {
                            (data.paper_evidence as { recordVerdicts?: { totalRecordVerdict: { code: string; message: string } } })
                              .recordVerdicts!.totalRecordVerdict.code
                          }
                        </p>
                        <p className="text-muted-foreground">
                          {
                            (data.paper_evidence as { recordVerdicts?: { totalRecordVerdict: { message: string } } })
                              .recordVerdicts!.totalRecordVerdict.message
                          }
                        </p>
                        <p>
                          <span className="font-medium">New Trades Verdict:</span>{" "}
                          {
                            (data.paper_evidence as { recordVerdicts?: { newTradesVerdict: { code: string; message: string } } })
                              .recordVerdicts!.newTradesVerdict.code
                          }
                        </p>
                        <p className="text-muted-foreground">
                          {
                            (data.paper_evidence as { recordVerdicts?: { newTradesVerdict: { message: string } } })
                              .recordVerdicts!.newTradesVerdict.message
                          }
                        </p>
                        <p>
                          <span className="font-medium">Carried Trades Verdict:</span>{" "}
                          {
                            (data.paper_evidence as { recordVerdicts?: { carriedTradesVerdict: { code: string; message: string } } })
                              .recordVerdicts!.carriedTradesVerdict.code
                          }
                        </p>
                        <p className="text-muted-foreground">
                          {
                            (data.paper_evidence as { recordVerdicts?: { carriedTradesVerdict: { message: string } } })
                              .recordVerdicts!.carriedTradesVerdict.message
                          }
                        </p>
                      </div>
                    )}
                    <p className="text-sm font-semibold pt-2">TOTAL RECORD PERFORMANCE (SIMULATED)</p>
                    <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Starting equity:</span>{" "}
                        {fmtMetric(data.paper_evidence.performanceSummary.startingPaperBalance)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Current equity:</span>{" "}
                        {fmtMetric(data.paper_evidence.performanceSummary.currentPaperBalance)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Cash balance:</span>{" "}
                        {fmtMetric(
                          (
                            data.paper_evidence.performanceSummary as {
                              currentRecordAccounting?: { cashBalance: number };
                            }
                          ).currentRecordAccounting?.cashBalance ??
                            data.paper_evidence.performanceSummary.startingPaperBalance +
                              data.paper_evidence.performanceSummary.totalRealizedPnl,
                        )}{" "}
                        SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Total record P&L:</span>{" "}
                        {data.paper_evidence.performanceSummary.totalNetPnl >= 0 ? "+" : ""}
                        {fmtMetric(data.paper_evidence.performanceSummary.totalNetPnl)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Overall record status:</span>{" "}
                        {(data.paper_evidence.performanceSummary as { overallRecordStatus?: string }).overallRecordStatus ??
                          "UNKNOWN"}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total record P&L includes carried trade impact.
                    </p>
                    <p className="text-sm font-semibold pt-2">NEW TRADE PERFORMANCE (SIMULATED)</p>
                    <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">New realized P&L:</span>{" "}
                        {fmtMetric(data.paper_evidence.performanceSummary.totalRealizedPnl)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">New unrealized P&L:</span>{" "}
                        {fmtMetric(data.paper_evidence.performanceSummary.totalUnrealizedPnl)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">New wins / losses:</span>{" "}
                        {data.paper_evidence.performanceSummary.wins} / {data.paper_evidence.performanceSummary.losses}
                      </p>
                      <p>
                        <span className="text-muted-foreground">New trade win rate:</span>{" "}
                        {(data.paper_evidence.performanceSummary as { newTradeWinRateLabel?: string }).newTradeWinRateLabel ??
                          (data.paper_evidence.performanceSummary.winRate !== null
                            ? `${(data.paper_evidence.performanceSummary.winRate * 100).toFixed(1)}%`
                            : "Not enough data")}
                      </p>
                      <p>
                        <span className="text-muted-foreground">New profit factor:</span>{" "}
                        {data.paper_evidence.performanceSummary.wins > 0 &&
                        data.paper_evidence.performanceSummary.losses === 0
                          ? "No losses yet — profit factor not meaningful"
                          : data.paper_evidence.performanceSummary.profitFactor !== null
                            ? fmtMetric(data.paper_evidence.performanceSummary.profitFactor)
                            : "Not enough data"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">New trades opened:</span>{" "}
                        {(data.paper_evidence.performanceSummary as { newTradesOpened?: number }).newTradesOpened ?? 0}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Closed new trades:</span>{" "}
                        {(data.paper_evidence.performanceSummary as { closedTradesInRecord?: number })
                          .closedTradesInRecord ?? 0}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      New-trade win rate excludes carried trades.
                    </p>
                    <p className="text-sm font-semibold pt-2">CARRIED TRADE PERFORMANCE (SIMULATED)</p>
                    <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Carried P&L since carry:</span>{" "}
                        {fmtMetric(
                          (data.paper_evidence.performanceSummary as { carriedPnlSinceCarry?: number })
                            .carriedPnlSinceCarry ?? 0,
                        )}{" "}
                        SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Carried open trades:</span>{" "}
                        {data.paper_evidence.carriedOpenTradesCount ?? 0}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Carried closed trades:</span>{" "}
                        {(data.paper_evidence as { carriedTradeStats?: { closedCount: number } }).carriedTradeStats
                          ?.closedCount ?? 0}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Carried wins / losses:</span>{" "}
                        {(data.paper_evidence as { carriedTradeStats?: { wins: number; losses: number } })
                          .carriedTradeStats?.wins ?? 0}{" "}
                        /{" "}
                        {(data.paper_evidence as { carriedTradeStats?: { losses: number } }).carriedTradeStats
                          ?.losses ?? 0}
                      </p>
                    </div>
                    <p className="text-sm font-semibold pt-2">RISK MODE (SIMULATED)</p>
                    <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Current risk mode:</span>{" "}
                        {data.paper_evidence.riskLevel ?? "UNKNOWN"}
                      </p>
                      {data.paper_evidence.recordCautionMode?.active && (
                        <p className="text-amber-700 dark:text-amber-400 sm:col-span-2">
                          {data.paper_evidence.recordCautionMode.dashboardMessage}
                        </p>
                      )}
                      {(
                        data.paper_evidence.recordCautionMode as {
                          triggerSource?: string;
                          metricsUsed?: {
                            newTradeLosses: number;
                            carriedTradeLosses: number;
                            allRecordLosses: number;
                            recordPnl: number;
                          };
                        }
                      )?.metricsUsed && (
                        <>
                          <p>
                            <span className="text-muted-foreground">Trigger source:</span>{" "}
                            {(
                              data.paper_evidence.recordCautionMode as { triggerSource?: string }
                            ).triggerSource ?? "unknown"}
                          </p>
                          <p className="sm:col-span-2">
                            <span className="text-muted-foreground">Metrics used:</span> new losses{" "}
                            {
                              (
                                data.paper_evidence.recordCautionMode as {
                                  metricsUsed?: { newTradeLosses: number };
                                }
                              ).metricsUsed!.newTradeLosses
                            }
                            , carried losses{" "}
                            {
                              (
                                data.paper_evidence.recordCautionMode as {
                                  metricsUsed?: { carriedTradeLosses: number };
                                }
                              ).metricsUsed!.carriedTradeLosses
                            }
                            , all record losses{" "}
                            {
                              (
                                data.paper_evidence.recordCautionMode as {
                                  metricsUsed?: { allRecordLosses: number };
                                }
                              ).metricsUsed!.allRecordLosses
                            }
                            , record P&L{" "}
                            {fmtMetric(
                              (
                                data.paper_evidence.recordCautionMode as {
                                  metricsUsed?: { recordPnl: number };
                                }
                              ).metricsUsed!.recordPnl,
                            )}{" "}
                            SIM
                          </p>
                        </>
                      )}
                    </div>
                    {data.paper_evidence.recordActivityCounts && (
                      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 border-t pt-2">
                        <p>Runs completed in this record: {data.paper_evidence.recordActivityCounts.runsCompletedInRecord}</p>
                        <p>Trades updated in this record: {data.paper_evidence.recordActivityCounts.tradesUpdatedInRecord}</p>
                        <p>Candidates scanned in this record: {data.paper_evidence.recordActivityCounts.candidatesScannedInRecord}</p>
                        <p>Rejections in this record: {data.paper_evidence.recordActivityCounts.rejectionsInRecord}</p>
                      </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && (data?.paper_evidence as { carriedClosedTradesDetail?: Array<{
                  tradeId: string;
                  symbol: string;
                  side: string;
                  originalEntryTime: string;
                  carriedIntoRecordTime: string;
                  exitTime: string;
                  pnlSinceCarryDisplay: string;
                  allTimePnl: number;
                  exitReason: string | null;
                  thesisStatus: string;
                }> })?.carriedClosedTradesDetail && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 space-y-2">
                    <p className="text-sm font-semibold">Carried Closed Trades (SIMULATED)</p>
                    <p className="text-xs text-muted-foreground">
                      Carried trades closed during this record — P&L since carry counts toward total record P&L.
                    </p>
                    {((data.paper_evidence as { carriedClosedTradesDetail?: unknown[] }).carriedClosedTradesDetail?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No carried closed trades in this record.</p>
                    ) : (
                      <div className="space-y-2 text-xs">
                        {(
                          data.paper_evidence as {
                            carriedClosedTradesDetail: Array<{
                              tradeId: string;
                              symbol: string;
                              side: string;
                              originalEntryTime: string;
                              carriedIntoRecordTime: string;
                              exitTime: string;
                              pnlSinceCarryDisplay: string;
                              allTimePnl: number;
                              exitReason: string | null;
                              thesisStatus: string;
                            }>;
                          }
                        ).carriedClosedTradesDetail.map((t) => (
                          <div key={t.tradeId} className="rounded border p-2">
                            <p className="font-medium">
                              {t.symbol} {t.side}
                            </p>
                            <p>Original entry: {new Date(t.originalEntryTime).toLocaleString()}</p>
                            <p>Carried into record: {new Date(t.carriedIntoRecordTime).toLocaleString()}</p>
                            <p>Exit: {new Date(t.exitTime).toLocaleString()}</p>
                            <p>P&L since carry: {t.pnlSinceCarryDisplay} SIM</p>
                            <p>All-time P&L: {fmtMetric(t.allTimePnl)} SIM</p>
                            <p>Exit reason: {t.exitReason ?? "UNKNOWN"}</p>
                            <p>Thesis status: {t.thesisStatus}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.botHealthCheck && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                    <p className="text-sm font-semibold">Bot Health Check (SIMULATED)</p>
                    <p className="text-xs">{data.paper_evidence.botHealthCheck.plainEnglishSummary}</p>
                    <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <p>Bot working: {data.paper_evidence.botHealthCheck.isWorking ? "YES" : "NO"}</p>
                      <p>Latest run completed: {data.paper_evidence.botHealthCheck.latestRunCompleted ? "YES" : "NO"}</p>
                      <p>
                        Latest run time:{" "}
                        {data.paper_evidence.botHealthCheck.latestRunTime
                          ? new Date(data.paper_evidence.botHealthCheck.latestRunTime).toLocaleString()
                          : "—"}
                      </p>
                      <p>Latest action: {data.paper_evidence.latestRecordRun?.latestAction ?? "—"}</p>
                      <p>Latest reason code: {data.paper_evidence.botHealthCheck.currentReason ?? "—"}</p>
                      <p>Runs completed in this record: {data.paper_evidence.botHealthCheck.currentRecordRuns}</p>
                      <p>Trades updated in this record: {data.paper_evidence.botHealthCheck.tradesUpdatedInRecord ?? data.paper_evidence.recordActivityCounts?.tradesUpdatedInRecord ?? 0}</p>
                      <p>Candidates scanned in this record: {data.paper_evidence.recordActivityCounts?.candidatesScannedInRecord ?? data.paper_evidence.botHealthCheck.candidatesScanned}</p>
                      <p>Rejections in this record: {data.paper_evidence.botHealthCheck.rejectionsInRecord ?? data.paper_evidence.recordActivityCounts?.rejectionsInRecord ?? 0}</p>
                      <p>Carried trades monitored: {data.paper_evidence.botHealthCheck.carriedTradesMonitored}</p>
                    </div>
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
                    <p className="text-sm font-semibold">Carried Open Trades (SIMULATED)</p>
                    <p className="text-xs text-muted-foreground">
                      These trades were opened before this record started. Only P&L changes after carry time count toward the current record.
                    </p>
                    {(data.paper_evidence.carriedOpenTradesDetail?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No carried open trades in this record.</p>
                    ) : (
                    <div className="space-y-2 text-xs">
                      {data.paper_evidence.carriedOpenTradesDetail!.map((t) => {
                        const review = data.paper_evidence?.recordOpenTrades?.find((r) => r.tradeId === t.tradeId);
                        return (
                        <div key={t.tradeId} className="rounded border p-2">
                          <p className="font-medium">
                            {t.symbol} {t.side} · {t.status}
                          </p>
                          <p>Original entry: {new Date(t.originalEntryTime).toLocaleString()}</p>
                          <p>Carried into record: {new Date(t.carriedIntoRecordTime).toLocaleString()}</p>
                          <p>
                            Entry {fmtMetric(t.entryPrice)} → Current {fmtMetric(t.currentPrice)} SIM
                          </p>
                          <p>
                            P&L since carried into this record:{" "}
                            {t.legacyBaselineMissing
                              ? "Legacy carry baseline missing. Run db:generate + db:push, then start a new record for accurate carry delta."
                              : `${fmtMetric(t.unrealizedSinceCarry)} SIM`}
                          </p>
                          <p>All-time P&L from this trade: {fmtMetric(t.allTimeUnrealizedPnl)} SIM</p>
                          {review && (
                            <>
                              <p>Distance to TP / SL: {review.distanceToTpPct ?? "—"}% / {review.distanceToSlPct ?? "—"}%</p>
                              <p>Thesis: {review.thesisStatus} · {review.recommendation} · {review.reasons.join("; ")}</p>
                              {review.candleData && (
                                <p>
                                  Candles: {review.candleData.available ? "YES" : "NO"} · count{" "}
                                  {review.candleData.candleCount} · {review.candleData.timeframe} · provider{" "}
                                  {review.candleData.provider ?? "—"}
                                  {review.candleData.missingReason
                                    ? ` · ${review.candleData.missingReason}`
                                    : ""}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      );})}
                    </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.whyNoTradeReport && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Why No Trade Opened (SIMULATED)</p>
                    <p className="text-xs">{data.paper_evidence.whyNoTradeReport.finalReason}</p>
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.tradeFrequencyHealth && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Trade Frequency Health (SIMULATED)</p>
                    <p className="text-xs">{data.paper_evidence.tradeFrequencyHealth.recommendation}</p>
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.latestRecordRun && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Latest Current Record Run (SIMULATED)</p>
                    {data.paper_evidence.latestRecordRun.emptyMessage ? (
                      <p className="text-xs text-muted-foreground">
                        {data.paper_evidence.latestRecordRun.emptyMessage}
                      </p>
                    ) : (
                      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                        <p>
                          Run time:{" "}
                          {data.paper_evidence.latestRecordRun.startedAt
                            ? new Date(data.paper_evidence.latestRecordRun.startedAt).toLocaleString()
                            : "—"}
                        </p>
                        <p>Status: {data.paper_evidence.latestRecordRun.status ?? "—"}</p>
                        <p>Latest action: {data.paper_evidence.latestRecordRun.latestAction ?? "—"}</p>
                        <p>
                          Opened / updated / closed: {data.paper_evidence.latestRecordRun.tradesOpened} /{" "}
                          {data.paper_evidence.latestRecordRun.tradesUpdated} /{" "}
                          {data.paper_evidence.latestRecordRun.tradesClosed}
                        </p>
                        <p>
                          Candidates / signals / snapshots:{" "}
                          {data.paper_evidence.latestRecordRun.candidatesStored} /{" "}
                          {data.paper_evidence.latestRecordRun.signalsStored} /{" "}
                          {data.paper_evidence.latestRecordRun.snapshotsStored}
                        </p>
                        <p>
                          Discovered / evaluated:{" "}
                          {data.paper_evidence.latestRecordRun.coinsDiscovered ?? "—"} /{" "}
                          {data.paper_evidence.latestRecordRun.coinsEvaluated ?? "—"}
                        </p>
                        <p>
                          Realized / unrealized / net this run:{" "}
                          {fmtMetric(data.paper_evidence.latestRecordRun.realizedPnlThisRun)} /{" "}
                          {fmtMetric(data.paper_evidence.latestRecordRun.unrealizedPnlChangeThisRun)} /{" "}
                          {fmtMetric(data.paper_evidence.latestRecordRun.netChangeThisRun)} SIM
                        </p>
                        {(data.paper_evidence.latestRecordRun as { pnlSource?: string }).pnlSource ===
                          "computed_from_snapshots" && (
                          <p className="text-xs text-muted-foreground">P&L computed from run snapshots (not stored in scan summary).</p>
                        )}
                        {(data.paper_evidence.latestRecordRun as { pnlUnavailableMessage?: string | null })
                          .pnlUnavailableMessage && (
                          <p className="text-xs text-amber-600">
                            {
                              (data.paper_evidence.latestRecordRun as { pnlUnavailableMessage?: string | null })
                                .pnlUnavailableMessage
                            }
                          </p>
                        )}
                        <p>
                          Reason: [{data.paper_evidence.latestRecordRun.reasonCode ?? "—"}]{" "}
                          {data.paper_evidence.latestRecordRun.reasonText ?? ""}
                        </p>
                        <p>Best decision: {data.paper_evidence.latestRecordRun.bestDecision ?? "—"}</p>
                      </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.recordScanner && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Record Scan Summary (SIMULATED)</p>
                    <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <p>Discovered: {data.paper_evidence.recordScanner.coinsDiscovered ?? data.paper_evidence.recordScanner.pipeline?.coinsDiscovered ?? "—"}</p>
                      <p>Evaluated: {data.paper_evidence.recordScanner.coinsEvaluated ?? data.paper_evidence.recordScanner.pipeline?.deepEvaluated ?? "—"}</p>
                      <p>Ranked: {data.paper_evidence.recordScanner.pipeline?.finalCandidates ?? "—"}</p>
                      <p>High-vol: {data.paper_evidence.recordScanner.scannerHealth?.highVolCount ?? "—"}</p>
                      <p>Watchlist: {data.paper_evidence.recordScanner.scannerHealth?.watchlistCount ?? "—"}</p>
                      <p>
                        Rejected bad risk/reward:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.BAD_RISK_REWARD ??
                          (data.paper_evidence.recordScanner as { rejectionCategories?: Record<string, number> | undefined })
                            ?.rejectionCategories?.BAD_RISK_REWARD ??
                          0}
                      </p>
                      <p>
                        Fake pump watch/reject:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.FAKE_PUMP ??
                          (data.paper_evidence.recordScanner as { rejectionCategories?: Record<string, number> | undefined })
                            ?.rejectionCategories?.FAKE_PUMP ??
                          0}
                      </p>
                      <p>
                        Score too low:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.SCORE_TOO_LOW ??
                          data.paper_evidence.latestRecordRun?.rejectionSummary?.SCORE_TOO_LOW ??
                          data.paper_evidence.recordScanner.rejectionSummary?.SCORE_TOO_LOW ??
                          0}
                      </p>
                      <p>
                        Volume too low:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.VOLUME_TOO_LOW ??
                          data.paper_evidence.latestRecordRun?.rejectionSummary?.VOLUME_TOO_LOW ??
                          data.paper_evidence.recordScanner.rejectionSummary?.VOLUME_TOO_LOW ??
                          0}
                      </p>
                      <p>
                        Spread too wide:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.SPREAD_TOO_WIDE ??
                          data.paper_evidence.latestRecordRun?.rejectionSummary?.SPREAD_TOO_WIDE ??
                          data.paper_evidence.recordScanner.rejectionSummary?.SPREAD_TOO_WIDE ??
                          0}
                      </p>
                      <p>
                        Not tradable:{" "}
                        {(data.paper_evidence.latestRecordRun as { rejectionCategories?: Record<string, number> })
                          .rejectionCategories?.NOT_TRADABLE_ON_EXCHANGE ??
                          data.paper_evidence.recordScanner.pipeline?.removedByExchangeAvailability ??
                          0}
                      </p>
                    </div>
                    {(data.paper_evidence.recordScanner.topCandidates?.length ?? 0) > 0 ? (
                      <div className="text-xs space-y-1 border-t pt-2">
                        <p className="font-medium">Top candidates this run</p>
                        <ul className="space-y-0.5">
                          {data.paper_evidence.recordScanner.topCandidates.slice(0, 5).map((c, i) => (
                            <li key={`${c.symbol}-${i}`}>
                              {c.symbol} — score {c.score?.toFixed(0) ?? "—"} —{" "}
                              {(c as { runDisplayLabel?: string }).runDisplayLabel ??
                                c.action ??
                                "—"}{" "}
                              — {c.reasonCode ?? c.reason ?? "—"}
                              {c.reason && c.reasonCode === "SCORE_TOO_LOW" ? ` (${c.reason})` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground border-t pt-2">No top candidates stored for latest run.</p>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.latestRecordRun && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Rejection Summary (SIMULATED)</p>
                    {Object.keys(data.paper_evidence.latestRecordRun.rejectionSummary ?? {}).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No rejections recorded for latest run.</p>
                    ) : (
                      <ul className="text-xs space-y-0.5">
                        {Object.entries(data.paper_evidence.latestRecordRun.rejectionSummary ?? {})
                          .sort((a, b) => b[1] - a[1])
                          .map(([code, count]) => (
                            <li key={code}>
                              {code}: {count}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Record Open Trades — New Only (SIMULATED)</p>
                    {(data.paper_evidence.recordOpenTrades?.filter((t) => !t.isCarried).length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No new trades opened in this record yet.</p>
                    ) : (
                    <div className="space-y-2 text-xs">
                      {data.paper_evidence.recordOpenTrades!.filter((t) => !t.isCarried).map((t) => (
                        <div key={t.tradeId} className="rounded border p-2">
                          <p className="font-medium">
                            {t.symbol} {t.side} · {t.isCarried ? "carried" : "new in record"}
                          </p>
                          <p>
                            Entry {fmtMetric(t.entryPrice)} → Current {fmtMetric(t.currentPrice)} SIM
                          </p>
                          <p>All-time P&L: {t.allTimePnl !== null ? fmtMetric(t.allTimePnl) : "UNKNOWN"} SIM</p>
                          <p>P&L since record start/carry: {t.recordPnlDisplay} SIM</p>
                          <p>
                            Distance to TP / SL: {t.distanceToTpPct ?? "—"}% / {t.distanceToSlPct ?? "—"}%
                          </p>
                          <p>
                            Thesis: {t.thesisStatus} · {t.recommendation} · {t.reasons.join("; ")}
                          </p>
                          {(t as { candleData?: { available: boolean; candleCount: number; timeframe: string; provider: string | null; missingReason: string | null } }).candleData && (
                            <p>
                              Candles:{" "}
                              {(t as { candleData: { available: boolean; candleCount: number; timeframe: string; provider: string | null; missingReason: string | null } }).candleData.available
                                ? "YES"
                                : "NO"}{" "}
                              · count{" "}
                              {(t as { candleData: { candleCount: number } }).candleData.candleCount} ·{" "}
                              {(t as { candleData: { timeframe: string } }).candleData.timeframe} · provider{" "}
                              {(t as { candleData: { provider: string | null } }).candleData.provider ?? "—"}
                              {(t as { candleData: { missingReason: string | null } }).candleData.missingReason
                                ? ` · ${(t as { candleData: { missingReason: string | null } }).candleData.missingReason}`
                                : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && (data?.paper_evidence?.recordOpenTrades?.length ?? 0) > 0 && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Record Open Trade Review (SIMULATED)</p>
                    <div className="space-y-2 text-xs">
                      {data.paper_evidence!.recordOpenTrades!.map((t) => (
                        <div key={`review-${t.tradeId}`} className="rounded border p-2">
                          <p className="font-medium">
                            {t.symbol} {t.side} · {t.isCarried ? "carried" : "new in record"}
                          </p>
                          <p>Thesis: {t.thesisStatus} · {t.recommendation}</p>
                          <p>Reason: {t.reasons.join("; ")}</p>
                          {(t as { candleData?: { available: boolean; candleCount: number; timeframe: string; provider: string | null; missingReason: string | null } }).candleData && (
                            <p>
                              Candles:{" "}
                              {(t as { candleData: { available: boolean } }).candleData.available ? "YES" : "NO"} · count{" "}
                              {(t as { candleData: { candleCount: number } }).candleData.candleCount} ·{" "}
                              {(t as { candleData: { timeframe: string } }).candleData.timeframe} · provider{" "}
                              {(t as { candleData: { provider: string | null } }).candleData.provider ?? "—"}
                              {(t as { candleData: { missingReason: string | null } }).candleData.missingReason
                                ? ` · ${(t as { candleData: { missingReason: string | null } }).candleData.missingReason}`
                                : ""}
                            </p>
                          )}
                          <p>Distance to TP / SL: {t.distanceToTpPct ?? "—"}% / {t.distanceToSlPct ?? "—"}%</p>
                          <p>P&L since record start/carry: {t.recordPnlDisplay} SIM · All-time: {t.allTimePnl !== null ? fmtMetric(t.allTimePnl) : "UNKNOWN"} SIM</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.recordNewTradeHistory && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Record Trade History (SIMULATED)</p>
                    {data.paper_evidence.recordNewTradeHistory.rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No new trades opened in this record yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b">
                              <th className="py-1 pr-2">Coin</th>
                              <th className="py-1 pr-2">Entry</th>
                              <th className="py-1 pr-2">Exit</th>
                              <th className="py-1 pr-2">Net P&L</th>
                              <th className="py-1">Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.paper_evidence.recordNewTradeHistory.rows.slice(0, 20).map((t) => (
                              <tr key={t.tradeNumber} className="border-b border-dashed">
                                <td className="py-1 pr-2">{t.coin}</td>
                                <td className="py-1 pr-2">{t.entryTime ? new Date(t.entryTime).toLocaleString() : "—"}</td>
                                <td className="py-1 pr-2">{t.exitTime ? new Date(t.exitTime).toLocaleString() : "OPEN"}</td>
                                <td className="py-1 pr-2">{t.netPnl?.toFixed(4) ?? "—"} SIM</td>
                                <td className="py-1">{t.finalResult}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Record Activity Feed (SIMULATED)</p>
                    {(data.paper_evidence.recordActivityFeed?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No record activity yet — run a paper evidence step.</p>
                    ) : (
                    <ul className="text-xs space-y-1">
                      {data.paper_evidence.recordActivityFeed!.map((event, i) => (
                        <li key={`${event.timestamp}-${i}`}>
                          [{new Date(event.timestamp).toLocaleString()}] {event.type}: {event.summary}
                        </li>
                      ))}
                    </ul>
                    )}
                  </div>
                )}

                {isCurrentRecordView && (data?.paper_evidence?.recordWarnings?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
                    <p className="text-sm font-semibold">Current Warnings and Errors</p>
                    <ul className="text-xs space-y-1">
                      {data.paper_evidence!.recordWarnings!.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                      {data.paper_evidence?.prismaStaleMessage && <li>{data.paper_evidence.prismaStaleMessage}</li>}
                      {data.paper_evidence?.historicalPrismaWarning && <li>{data.paper_evidence.historicalPrismaWarning}</li>}
                    </ul>
                  </div>
                )}

                {isCurrentRecordView && data?.next_steps_checklist && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">System Checks</p>
                    <p className="text-xs text-muted-foreground">Connection and readiness — safety checks, not record P&L.</p>
                    <ul className="space-y-2 text-xs">
                      {data.next_steps_checklist.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        </li>
                      ))}
                    </ul>
                    <StatusRow label="Local Owner Mode active" status={data.local_owner_mode ? "YES" : "NO"} />
                    <StatusRow label="Read-only API key stored" status={data.exchange_account_readiness?.readOnlyKeyConfigured ? "YES" : "NO"} />
                    <StatusRow label="Live trading locked" status="LOCKED" />
                    <StatusRow label="Auto execution locked" status="LOCKED" />
                  </div>
                )}

                {isCurrentRecordView && data?.same_day_reality && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <p className="text-sm font-semibold">Safe Path / Same-Day Reality Check</p>
                    <p className="text-xs text-muted-foreground">Safety checks — not current record performance.</p>
                    <p className="text-sm font-medium">{data.same_day_reality.headline}</p>
                    <Badge variant="outline">{data.same_day_reality.status}</Badge>
                    {data.same_day_reality.evidence_missing.length > 0 && (
                      <ul className="list-inside list-disc text-xs">
                        {data.same_day_reality.evidence_missing.slice(0, 7).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {isCurrentRecordView && data?.paper_evidence?.recordHistory && data.paper_evidence.recordHistory.length > 0 && (
                  <details className="rounded-lg border p-3">
                    <summary className="text-xs font-medium cursor-pointer">
                      Archived Records / All-Time ({data.paper_evidence.recordHistory.filter((r) => r.status === "ARCHIVED").length})
                    </summary>
                    <div className="mt-3 space-y-2 text-xs">
                      {data.paper_evidence.recordHistory
                        .filter((r) => r.status === "ARCHIVED")
                        .map((r) => (
                        <div key={r.recordId} className="rounded border p-2">
                          <p className="font-medium">
                            Record #{r.recordNumber} — {r.recordName} — {r.status}
                          </p>
                          <p>
                            P&L: {fmtMetric(r.recordPnl)} SIM · Trades: {r.closedTrades} · Win rate:{" "}
                            {r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "UNKNOWN"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {isCurrentRecordView && (
                <>
                <div className="rounded-lg border border-dashed p-3 space-y-2">
                  <p className="text-xs font-medium">Start New Record</p>
                  <p className="text-xs text-muted-foreground">
                    Creates a clean dashboard scorecard. Old data is archived. Open trades can be carried separately and will not count as new trades.
                  </p>
                  <input
                    className="w-full rounded border bg-background px-2 py-1 text-xs"
                    placeholder="Optional name (e.g. v0.9 Loss Shield Test)"
                    value={recordNameInput}
                    onChange={(e) => setRecordNameInput(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="recordStartMode"
                        checked={recordStartMode === "soft"}
                        onChange={() => setRecordStartMode("soft")}
                      />
                      Soft Fresh Start (carry open trades separately)
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="recordStartMode"
                        checked={recordStartMode === "clean"}
                        onChange={() => setRecordStartMode("clean")}
                      />
                      Clean Fresh Start (require no open trades)
                    </label>
                  </div>
                  <p className="text-xs">
                    Clean Fresh Start available:{" "}
                    {(data?.paper_evidence as { cleanFreshStart?: { available: boolean } })?.cleanFreshStart?.available
                      ? "YES"
                      : "NO"}
                  </p>
                  {(data?.paper_evidence as {
                    cleanFreshStart?: { blockingOpenTradeCount: number; blockingSymbols: string[] };
                  })?.cleanFreshStart &&
                    !(data.paper_evidence as { cleanFreshStart?: { available: boolean } }).cleanFreshStart!.available && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Blocking open trades:{" "}
                        {
                          (data.paper_evidence as { cleanFreshStart?: { blockingOpenTradeCount: number } })
                            .cleanFreshStart!.blockingOpenTradeCount
                        }{" "}
                        (
                        {(
                          data.paper_evidence as { cleanFreshStart?: { blockingSymbols: string[] } }
                        ).cleanFreshStart!.blockingSymbols.join(", ") || "unknown"}
                        )
                      </p>
                    )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={recordLoading}
                    onClick={() => void startPaperRecord(false)}
                  >
                    {recordLoading ? "Starting record…" : "Start New Record"}
                  </Button>
                  {recordMessage && <p className="text-xs text-muted-foreground">{recordMessage}</p>}
                  {showStartRecordDialog && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 space-y-2 text-xs">
                      <p>
                        You have {pendingOpenTradeCount} open paper trade(s). Carry them into the new record or wait until they close.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => void startPaperRecord(true)}>
                          Carry open trades
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowStartRecordDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={exportLogLoading} onClick={() => void exportPaperLogMode("CURRENT_RECORD_EXPORT")}>
                    Export Current Record
                  </Button>
                  <Button size="sm" variant="outline" disabled={exportLogLoading} onClick={() => void exportPaperLogMode("ALL_RECORDS_EXPORT")}>
                    Export All Records
                  </Button>
                  <Button size="sm" variant="outline" disabled={exportLogLoading} onClick={() => void exportPaperLogMode("ARCHIVED_RECORDS_EXPORT")}>
                    Export Archived Records
                  </Button>
                </div>

                {data?.paper_evidence?.recordHistory && data.paper_evidence.recordHistory.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Record History</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-1 pr-2">#</th>
                            <th className="py-1 pr-2">Name</th>
                            <th className="py-1 pr-2">Version</th>
                            <th className="py-1 pr-2">Started</th>
                            <th className="py-1 pr-2">Ended</th>
                            <th className="py-1 pr-2">Status</th>
                            <th className="py-1 pr-2">P&L</th>
                            <th className="py-1 pr-2">Trades</th>
                            <th className="py-1 pr-2">Win rate</th>
                            <th className="py-1 pr-2">PF</th>
                            <th className="py-1">Export</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.paper_evidence.recordHistory.map((r) => (
                            <tr key={r.recordId} className="border-b border-dashed">
                              <td className="py-1 pr-2">{r.recordNumber}</td>
                              <td className="py-1 pr-2">{r.recordName}</td>
                              <td className="py-1 pr-2">{r.strategyVersion}</td>
                              <td className="py-1 pr-2">{new Date(r.startedAt).toLocaleDateString()}</td>
                              <td className="py-1 pr-2">
                                {r.endedAt ? new Date(r.endedAt).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-1 pr-2">{r.status}</td>
                              <td className="py-1 pr-2">
                                {r.recordPnl !== null ? `${fmtMetric(r.recordPnl)} SIM` : "UNKNOWN"}
                              </td>
                              <td className="py-1 pr-2">{r.closedTrades}</td>
                              <td className="py-1 pr-2">
                                {r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "UNKNOWN"}
                              </td>
                              <td className="py-1 pr-2">{fmtMetric(r.profitFactor)}</td>
                              <td className="py-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  disabled={exportLogLoading}
                                  onClick={() =>
                                    void exportPaperLogMode(
                                      r.status === "ACTIVE" ? "CURRENT_RECORD_EXPORT" : "ARCHIVED_RECORDS_EXPORT",
                                      r.recordId,
                                    )
                                  }
                                >
                                  Export
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                </>
                )}

                {isAllTimeView && (
                <>
                {data?.paper_evidence?.profitQuality && (
                  <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                    <p className="text-sm font-semibold">Profit Quality (SIMULATED)</p>
                    <p className="text-sm italic">{data.paper_evidence.profitQuality.profitQualityVerdict}</p>
                    <p className="text-xs text-muted-foreground">
                      Risk mode ({data.paper_evidence.riskPerformanceScope ?? "all_time"}):{" "}
                      {data.paper_evidence.profitQuality.riskMode.dashboardLabel}
                      {data.paper_evidence.profitQuality.riskMode.active
                        ? ` — ${data.paper_evidence.profitQuality.riskMode.dashboardMessage}`
                        : ""}
                    </p>
                    <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Current balance:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.currentPaperBalance)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Portfolio P&L:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.portfolioPnl)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Realized / unrealized:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.totalRealizedPnl)} /{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.totalUnrealizedPnl)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Gross profit / loss:</span> +
                        {fmtMetric(data.paper_evidence.profitQuality.totalGrossProfit)} / -
                        {fmtMetric(data.paper_evidence.profitQuality.totalGrossLoss)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Wins / losses:</span>{" "}
                        {data.paper_evidence.profitQuality.wins} / {data.paper_evidence.profitQuality.losses}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Win rate:</span>{" "}
                        {data.paper_evidence.profitQuality.winRate !== null
                          ? `${(data.paper_evidence.profitQuality.winRate * 100).toFixed(1)}%`
                          : "UNKNOWN"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Avg win / avg loss:</span> +
                        {fmtMetric(data.paper_evidence.profitQuality.averageWin)} / -
                        {fmtMetric(data.paper_evidence.profitQuality.averageLoss)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Loss/win ratio:</span>{" "}
                        {data.paper_evidence.profitQuality.avgLossToWinRatio !== null
                          ? `${data.paper_evidence.profitQuality.avgLossToWinRatio.toFixed(2)}×`
                          : "UNKNOWN"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Profit factor:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.profitFactor)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Expectancy:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.expectancy)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Largest win / loss:</span> +
                        {fmtMetric(data.paper_evidence.profitQuality.largestWin)} /{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.largestLoss)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Max drawdown:</span>{" "}
                        {fmtMetric(data.paper_evidence.profitQuality.maxDrawdown)} SIM
                      </p>
                      <p>
                        <span className="text-muted-foreground">Capital exposure:</span>{" "}
                        {data.paper_evidence.profitQuality.capitalExposurePct !== null &&
                        data.paper_evidence.profitQuality.capitalExposurePct !== undefined
                          ? `${data.paper_evidence.profitQuality.capitalExposurePct.toFixed(2)}%`
                          : data.paper_evidence.profitQuality.currentExposurePct !== null
                            ? `${data.paper_evidence.profitQuality.currentExposurePct.toFixed(2)}%`
                            : "UNKNOWN"}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Risk-at-stop:</span>{" "}
                        {data.paper_evidence.profitQuality.riskAtStopPct !== null &&
                        data.paper_evidence.profitQuality.riskAtStopPct !== undefined
                          ? `${data.paper_evidence.profitQuality.riskAtStopPct.toFixed(2)}%`
                          : "UNKNOWN"}
                      </p>
                    </div>
                    {data.paper_evidence.historyDiagnostic && (
                      <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                        <p className="font-medium text-foreground">Historical rule diagnostic (paper-only)</p>
                        <p>
                          Would block {data.paper_evidence.historyDiagnostic.wouldBlockAtEntry.length} of{" "}
                          {data.paper_evidence.historyDiagnostic.totalClosedLosses} losing trades at entry
                        </p>
                        <p>
                          Estimated loss reduction: ~
                          {data.paper_evidence.historyDiagnostic.estimatedLossReductionUsd.toFixed(2)} SIM
                        </p>
                        <p>
                          Winners still passing: {data.paper_evidence.historyDiagnostic.winnersStillPassing} ·
                          blocked: {data.paper_evidence.historyDiagnostic.winnersBlocked}
                        </p>
                        {data.paper_evidence.historyDiagnostic.overFilterWarning && (
                          <p>{data.paper_evidence.historyDiagnostic.overFilterWarning}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {data?.paper_evidence?.lossAnalysis &&
                  data.paper_evidence.lossAnalysis.losses.length > 0 && (
                    <div className="rounded-lg border border-destructive/30 p-3 space-y-2">
                      <p className="text-sm font-medium">
                        Loss Diagnosis — all {data.paper_evidence.lossAnalysis.analyzedCount} losing
                        trades (SIMULATED)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {data.paper_evidence.lossAnalysis.note}
                      </p>
                      {data.paper_evidence.lossAnalysis.losses.map((l) => (
                        <div
                          key={(l.tradeId ?? l.symbol) + String(l.netPnl ?? 0)}
                          className="rounded border p-2 text-xs space-y-0.5"
                        >
                          <p className="font-medium">{l.symbol}</p>
                          <p>
                            Entry {l.entryPrice?.toFixed(4) ?? "UNKNOWN"} → Exit{" "}
                            {l.exitPrice?.toFixed(4) ?? "UNKNOWN"} · Loss{" "}
                            {l.lossAmount?.toFixed(4) ?? l.netPnl?.toFixed(4) ?? "UNKNOWN"} SIM (
                            {l.lossPct?.toFixed(2) ?? "UNKNOWN"}%)
                          </p>
                          <p>
                            Alloc {l.allocationPct?.toFixed(2) ?? "UNKNOWN"}% · SL dist{" "}
                            {l.stopLossDistancePct?.toFixed(2) ?? "UNKNOWN"}% · TP dist{" "}
                            {l.takeProfitDistancePct?.toFixed(2) ?? "UNKNOWN"}% · Score{" "}
                            {l.scoreAtEntry ?? "UNKNOWN"}
                          </p>
                          <p>Exit: {l.exitReason ?? "UNKNOWN"}</p>
                          <p>
                            Avg loss too large:{" "}
                            {l.averageLossTooLarge === null || l.averageLossTooLarge === undefined
                              ? "UNKNOWN"
                              : l.averageLossTooLarge
                                ? "yes"
                                : "no"}
                            · Exit too late:{" "}
                            {l.exitTooLate === null || l.exitTooLate === undefined
                              ? "UNKNOWN"
                              : l.exitTooLate
                                ? "yes"
                                : "no"}
                            · Stop hit:{" "}
                            {l.stopLossHit === null || l.stopLossHit === undefined
                              ? "UNKNOWN"
                              : l.stopLossHit
                                ? "yes"
                                : "no"}
                          </p>
                          <p>
                            Momentum reversed:{" "}
                            {l.momentumReversed === null ? "UNKNOWN" : l.momentumReversed ? "yes" : "no"}
                            · Volume weakened:{" "}
                            {l.volumeWeakened === null || l.volumeWeakened === undefined
                              ? "UNKNOWN"
                              : l.volumeWeakened
                                ? "yes"
                                : "no"}
                            · Spread widened:{" "}
                            {l.spreadWidened === null || l.spreadWidened === undefined
                              ? "UNKNOWN"
                              : l.spreadWidened
                                ? "yes"
                                : "no"}
                          </p>
                          <p className="text-muted-foreground">
                            Suggested fix: {l.suggestedFix ?? l.suggestedRuleImprovement ?? "UNKNOWN"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                {data?.paper_evidence?.performanceSummary && (
                  <details className="rounded-lg border p-3">
                    <summary className="text-xs font-medium cursor-pointer">
                      Detailed performance metrics (SIMULATED)
                    </summary>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <p>Expectancy/trade: {fmtMetric(data.paper_evidence.performanceSummary.expectancyPerTrade)} SIM</p>
                      <p>Best coin: {data.paper_evidence.performanceSummary.bestCoin ?? "UNKNOWN"}</p>
                      <p>Worst coin: {data.paper_evidence.performanceSummary.worstCoin ?? "UNKNOWN"}</p>
                      <p>Most traded: {data.paper_evidence.performanceSummary.mostTradedCoin ?? "UNKNOWN"}</p>
                      <p>
                        Avg duration:{" "}
                        {data.paper_evidence.performanceSummary.averageTradeDurationHours !== null
                          ? `${data.paper_evidence.performanceSummary.averageTradeDurationHours}h`
                          : "UNKNOWN"}
                      </p>
                      <p>Stop-loss exits: {data.paper_evidence.performanceSummary.stopLossHitCount}</p>
                      <p>Take-profit exits: {data.paper_evidence.performanceSummary.takeProfitHitCount}</p>
                      <p>Expiry exits: {data.paper_evidence.performanceSummary.expiryExitCount}</p>
                      <p>Thesis invalidation: {data.paper_evidence.performanceSummary.thesisInvalidationExitCount}</p>
                      <p>
                        Capital exposure:{" "}
                        {data.paper_evidence.performanceSummary.capitalExposurePct !== null &&
                        data.paper_evidence.performanceSummary.capitalExposurePct !== undefined
                          ? `${data.paper_evidence.performanceSummary.capitalExposurePct.toFixed(2)}%`
                          : data.paper_evidence.performanceSummary.currentExposurePct !== null
                            ? `${data.paper_evidence.performanceSummary.currentExposurePct.toFixed(2)}%`
                            : "UNKNOWN"}
                      </p>
                      <p>
                        Risk-at-stop:{" "}
                        {data.paper_evidence.performanceSummary.riskAtStopPct !== null &&
                        data.paper_evidence.performanceSummary.riskAtStopPct !== undefined
                          ? `${data.paper_evidence.performanceSummary.riskAtStopPct.toFixed(2)}%`
                          : "UNKNOWN"}
                      </p>
                      <p>
                        Peak capital exposure:{" "}
                        {data.paper_evidence.performanceSummary.maxExposureUsedPct !== null
                          ? `${data.paper_evidence.performanceSummary.maxExposureUsedPct.toFixed(2)}%`
                          : "UNKNOWN"}
                      </p>
                      <p>
                        Largest single trade:{" "}
                        {data.paper_evidence.performanceSummary.largestSingleTradeExposurePct !== null
                          ? `${data.paper_evidence.performanceSummary.largestSingleTradeExposurePct.toFixed(2)}%`
                          : "UNKNOWN"}
                      </p>
                    </div>
                  </details>
                )}

                <details className="rounded-lg border p-3">
                  <summary className="text-xs font-medium cursor-pointer">
                    Advanced / All-Time Debug
                  </summary>
                  <div className="mt-3 space-y-3 text-xs">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">All-time paper P&L (SIMULATED)</p>
                    <p className="font-medium">
                      {(data.paper_evidence.allTimeDebug?.simulatedNetPnl ?? data.paper_evidence.simulatedNetPnl).toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      W/L: {data.paper_evidence.allTimeDebug?.wins ?? data.paper_evidence.wins}/
                      {data.paper_evidence.allTimeDebug?.losses ?? data.paper_evidence.losses}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">All-time paper runs</p>
                    <p className="font-medium">{data.paper_evidence.allTimeDebug?.paperRuns ?? data.paper_evidence.paperRuns ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      Last run: {data.paper_evidence.allTimeDebug?.lastRunAt ?? data.paper_evidence.lastRunAt ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">All-time open / closed</p>
                    <p className="font-medium">
                      {data.paper_evidence.allTimeDebug?.openPaperTrades ?? data.paper_evidence.openPaperTrades} /{" "}
                      {data.paper_evidence.allTimeDebug?.closedPaperTrades ?? data.paper_evidence.closedPaperTrades}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Bot status</p>
                    <p className="font-medium">{data.paper_evidence.currentStatus}</p>
                    <p className="text-xs text-muted-foreground">Risk: {data.paper_evidence.riskLevel ?? "—"}</p>
                  </div>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="text-xs font-medium">Evidence Counts (all-time)</p>
                  <p>Paper Runs: {data.paper_evidence.allTimeDebug?.paperRuns ?? data.paper_evidence.paperRuns ?? "—"}</p>
                  <p>Candidates Stored: {data.paper_evidence.candidatesStored ?? "—"}</p>
                  <p>Signals Stored: {data.paper_evidence.signalsStored ?? "—"}</p>
                  <p>Snapshots Stored: {data.paper_evidence.snapshotsStored ?? "—"}</p>
                  <p>
                    Paper Evidence Count Total:{" "}
                    {data.paper_evidence.paperEvidenceCountTotal ??
                      data.paper_evidence.paperEvidenceCount}
                  </p>
                </div>
                  </div>
                </details>

                {(data.paper_evidence.scanner?.finalCandidateOutputs?.length ??
                  data.paper_evidence.scanner?.tradablePaperCandidates?.length ??
                  0) > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Best candidates (real market data)</p>
                      <ul className="text-xs space-y-0.5">
                        {(
                          data.paper_evidence.scanner?.finalCandidateOutputs?.slice(0, 5) ??
                          data.paper_evidence.scanner?.tradablePaperCandidates?.slice(0, 5) ??
                          []
                        ).map((c, i) => (
                          <li key={`best-${"symbol" in c ? c.symbol : i}-${i}`}>
                            {"symbol" in c ? c.symbol : "—"} —{" "}
                            {"scores" in c
                              ? `score ${c.scores.finalTotal.toFixed(0)}`
                              : `score ${(c as { score?: number }).score?.toFixed(0) ?? "—"}`}{" "}
                            —{" "}
                            {"finalRecommendation" in c
                              ? c.finalRecommendation
                              : (c as { action?: string }).action ?? "—"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                <StatusRow label="Paper Mode" status={data.paper_evidence.paperModeReady ? "READY" : "NO"} />
                <StatusRow
                  label="Market Data"
                  status={data.paper_evidence.marketDataReady ? "READY" : "NOT_CONFIGURED"}
                />
                <p>Last run in current record: {data.paper_evidence.lastRunAt ?? "—"}</p>
                <p>Open paper trades (new in record): {data.paper_evidence.openPaperTrades}</p>
                <p>Closed paper trades (in record): {data.paper_evidence.closedPaperTrades}</p>
                <p>No-Trade Signals: {data.paper_evidence.noTradeSignals}</p>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="text-xs font-medium">Open Trade Capacity</p>
                  <p>
                    Base max open trades:{" "}
                    {data.paper_evidence.openTradeCapacity?.baseMaxOpenTrades ??
                      data.paper_evidence.maxOpenTrades ??
                      "UNKNOWN"}
                  </p>
                  <p>
                    Dynamic max open trades:{" "}
                    {data.paper_evidence.openTradeCapacity?.dynamicMaxOpenTrades ??
                      data.paper_evidence.maxOpenTrades ??
                      "UNKNOWN"}
                  </p>
                  <p>Current open trades: {data.paper_evidence.openPaperTrades}</p>
                  <p>Available slots: {data.paper_evidence.availableSlots ?? "UNKNOWN"}</p>
                  <p>
                    Capital exposure:{" "}
                    {data.paper_evidence.openTradeCapacity?.capitalExposurePct !== undefined
                      ? `${data.paper_evidence.openTradeCapacity.capitalExposurePct.toFixed(2)}%`
                      : data.paper_evidence.openTradeCapacity?.totalExposurePct !== undefined
                        ? `${data.paper_evidence.openTradeCapacity.totalExposurePct.toFixed(2)}%`
                        : "UNKNOWN"}
                  </p>
                  <p>
                    Risk-at-stop:{" "}
                    {data.paper_evidence.openTradeCapacity?.riskAtStopPct !== undefined
                      ? `${data.paper_evidence.openTradeCapacity.riskAtStopPct.toFixed(2)}%`
                      : "UNKNOWN"}
                  </p>
                  <p>
                    Max allowed risk-at-stop:{" "}
                    {data.paper_evidence.openTradeCapacity?.maxAllowedRiskAtStopPct ??
                      data.paper_evidence.openTradeCapacity?.maxTotalExposurePct ??
                      "UNKNOWN"}
                    %
                  </p>
                  <p>
                    Max allowed daily risk used:{" "}
                    {data.paper_evidence.openTradeCapacity?.maxAllowedDailyRiskPct ??
                      data.paper_evidence.openTradeCapacity?.dailyRiskBudgetPct ??
                      "UNKNOWN"}
                    %
                  </p>
                  <p>
                    Daily risk used:{" "}
                    {data.paper_evidence.openTradeCapacity?.riskUsedTodayPct !== undefined
                      ? `${data.paper_evidence.openTradeCapacity.riskUsedTodayPct.toFixed(2)}%`
                      : "UNKNOWN"}
                  </p>
                  <p>
                    New trade opening:{" "}
                    {data.paper_evidence.newTradeOpening ??
                      (data.paper_evidence.maxOpenTradesReached ? "BLOCKED" : "ALLOWED")}
                  </p>
                  {data.paper_evidence.openTradeCapacity?.newTradeAllowedReason && (
                    <p className="text-muted-foreground text-xs">
                      {data.paper_evidence.openTradeCapacity.newTradeAllowedReason}
                    </p>
                  )}
                  {data.paper_evidence.openTradeCapacity?.capacityLimitedBy && (
                    <p className="text-amber-600 text-xs">
                      Limited by: {data.paper_evidence.openTradeCapacity.capacityLimitedBy}
                    </p>
                  )}
                  {data.paper_evidence.openTradeCapacity?.capacityFactors &&
                    data.paper_evidence.openTradeCapacity.capacityFactors.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        {data.paper_evidence.openTradeCapacity.capacityFactors.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                  {data.paper_evidence.maxOpenTradesReached && (
                    <p className="text-amber-600">
                      Reason: {data.paper_evidence.maxOpenTradesBlockReason ?? "MAX_OPEN_TRADES_REACHED"}
                    </p>
                  )}
                  {data.paper_evidence.rotationWarning && (
                    <p className="text-sm text-amber-600 rounded-lg border border-amber-500/30 p-2">
                      {data.paper_evidence.rotationWarning}
                    </p>
                  )}
                  {data.paper_evidence.rotationEnabled !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      Paper rotation:{" "}
                      {data.paper_evidence.rotationEnabled
                        ? "auto_paper_only (experimental)"
                        : `${data.paper_evidence.rotationMode ?? "disabled"} (default — secondary to quality selection)`}
                    </p>
                  )}
                </div>

                {data.paper_evidence.openTradeCapacity?.openTradeDetails &&
                  data.paper_evidence.openTradeCapacity.openTradeDetails.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Open Paper Trades</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="pr-2">Symbol</th>
                              <th className="pr-2">Tier</th>
                              <th className="pr-2">Entry</th>
                              <th className="pr-2">Current</th>
                              <th className="pr-2">Unreal. P&L</th>
                              <th className="pr-2">P&L bps</th>
                              <th className="pr-2">Age (h)</th>
                              <th className="pr-2">Dist TP</th>
                              <th className="pr-2">Dist SL</th>
                              <th className="pr-2">Score</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.paper_evidence.openTradeCapacity.openTradeDetails.map((t) => (
                              <tr key={t.symbol} className="border-t border-border/50">
                                <td className="pr-2 py-1">{t.symbol}</td>
                                <td className="pr-2">{t.riskTier ?? "—"}</td>
                                <td className="pr-2">{t.entryPrice?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">{t.currentPrice?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">
                                  {t.unrealizedSimulatedPnl?.toFixed(4) ?? "—"} (SIM)
                                </td>
                                <td className="pr-2">{t.unrealizedPnlBps?.toFixed(1) ?? "—"}</td>
                                <td className="pr-2">{t.ageHours ?? "—"}</td>
                                <td className="pr-2">
                                  {t.distanceToTargetBps?.toFixed(1) ?? "—"} bps
                                </td>
                                <td className="pr-2">{t.plannedStopLoss?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">{t.opportunityScore?.toFixed(0) ?? "—"}</td>
                                <td>{t.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                {data.paper_evidence.paperRotation && (
                  <div className="rounded-lg border p-3 space-y-1 opacity-70">
                    <p className="text-xs font-medium">Paper Rotation (deprecated — not used for trade selection)</p>
                    <p>
                      Rotation enabled:{" "}
                      {data.paper_evidence.paperRotation.rotationConfig.enabled ? "yes" : "no"}
                    </p>
                    <p>
                      Require profit:{" "}
                      {data.paper_evidence.paperRotation.rotationConfig.requireProfit ? "yes" : "no"}
                    </p>
                    <p>
                      Min score advantage:{" "}
                      {data.paper_evidence.paperRotation.rotationConfig.minScoreAdvantage}
                    </p>
                    <p>
                      Min exit P&L: {data.paper_evidence.paperRotation.rotationConfig.minExitPnlBps}{" "}
                      bps (simulated)
                    </p>
                    <p>Rotations total: {data.paper_evidence.paperRotation.rotationsTotal}</p>
                    <p>
                      Missed (no safe exit): {data.paper_evidence.paperRotation.missedDueToNoSafeExit}
                    </p>
                    <p>
                      Missed (score too small):{" "}
                      {data.paper_evidence.paperRotation.missedDueToScoreTooSmall}
                    </p>
                    {data.paper_evidence.paperRotation.rotationEvents.length > 0 && (
                      <ul className="space-y-1 text-xs">
                        {data.paper_evidence.paperRotation.rotationEvents.map((e, i) => (
                          <li key={`rot-${i}`}>
                            Out {e.rotatedOut} → In {e.rotatedIn} — exit SIM P&L{" "}
                            {e.exitSimulatedPnl?.toFixed(4) ?? "—"} — advantage{" "}
                            {e.scoreAdvantage?.toFixed(1) ?? "—"} — {e.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {(data.paper_evidence.missedOpportunitiesTotal ?? 0) > 0 &&
                  data.paper_evidence.missedOpportunities && (
                    <div className="rounded-lg border border-amber-500/30 p-3 space-y-1">
                      <p className="text-xs font-medium">Missed Opportunities</p>
                      <p>Total missed: {data.paper_evidence.missedOpportunities.missedOpportunitiesTotal}</p>
                      {data.paper_evidence.missedOpportunities.rotationHint && (
                        <p className="text-xs text-amber-600">
                          {data.paper_evidence.missedOpportunities.rotationHint}
                        </p>
                      )}
                      <ul className="space-y-1 text-xs">
                        {data.paper_evidence.missedOpportunities.topMissedOpportunities.map((m, i) => (
                          <li key={`${m.symbol}-miss-${i}`}>
                            {m.symbol} — {m.riskTier ?? "—"} — score {m.score?.toFixed(0) ?? "—"} —{" "}
                            {m.reason}
                            {m.blockedByMaxOpenTrades ? " (max open trades)" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {data.paper_evidence.tradeHistory && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Trade History (SIMULATED)</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p>Total closed: {data.paper_evidence.tradeHistory.summary.totalTrades}</p>
                      <p>
                        Win rate:{" "}
                        {data.paper_evidence.tradeHistory.summary.winRate !== null
                          ? `${(data.paper_evidence.tradeHistory.summary.winRate * 100).toFixed(1)}%`
                          : "—"}
                      </p>
                      <p>
                        Net P&L: {data.paper_evidence.tradeHistory.summary.netProfitLoss.toFixed(4)} (SIM)
                      </p>
                    </div>
                    {data.paper_evidence.tradeHistory.rows.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="pr-2">Coin</th>
                              <th className="pr-2">Market</th>
                              <th className="pr-2">Entry</th>
                              <th className="pr-2">Exit</th>
                              <th className="pr-2">Entry px</th>
                              <th className="pr-2">Exit px</th>
                              <th className="pr-2">Alloc%</th>
                              <th className="pr-2">Lev</th>
                              <th className="pr-2">Net P&L</th>
                              <th className="pr-2">P&L%</th>
                              <th className="pr-2">Entry reason</th>
                              <th className="pr-2">Exit reason</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.paper_evidence.tradeHistory.rows.slice(0, 20).map((t) => (
                              <tr key={t.tradeNumber} className="border-t border-border/50">
                                <td className="pr-2 py-1">{t.coin}</td>
                                <td className="pr-2">{t.marketType}</td>
                                <td className="pr-2">
                                  {t.entryTime ? new Date(t.entryTime).toLocaleString() : "—"}
                                </td>
                                <td className="pr-2">
                                  {t.exitTime ? new Date(t.exitTime).toLocaleString() : "—"}
                                </td>
                                <td className="pr-2">{t.entryPrice?.toFixed(4) ?? "UNKNOWN"}</td>
                                <td className="pr-2">{t.exitPrice?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">
                                  {t.allocationPct?.toFixed(2) ?? "UNKNOWN"}%
                                </td>
                                <td className="pr-2">{t.leverageUsed}x</td>
                                <td className="pr-2">{t.netPnl?.toFixed(4) ?? "—"} SIM</td>
                                <td className="pr-2">{t.pctGainLoss?.toFixed(2) ?? "—"}%</td>
                                <td className="pr-2 max-w-[120px] truncate" title={t.entryReason}>
                                  {t.entryReason}
                                </td>
                                <td className="pr-2 max-w-[120px] truncate" title={t.exitReason ?? ""}>
                                  {t.exitReason ?? "—"}
                                </td>
                                <td>{t.finalResult}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {data.paper_evidence.activeTradingRules && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Active Trading Rules (paper-only)</p>
                    {data.paper_evidence.activeTradingRules.groups.map((g) => (
                      <div key={g.title}>
                        <p className="text-xs font-medium">{g.title}</p>
                        <ul className="text-xs text-muted-foreground list-disc pl-4">
                          {g.rules.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <ul className="text-xs text-muted-foreground list-disc pl-4">
                      {data.paper_evidence.activeTradingRules.safetyCaps.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}


                <StatusRow label="Evidence status" status={data.paper_evidence.currentStatus} />

                {data.scanner_provider_status && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Provider status</p>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      {data.scanner_provider_status.providers.map((p) => (
                        <div key={p.provider} className="rounded border p-2 space-y-0.5">
                          <p className="font-medium text-foreground">{p.label}</p>
                          <p>Connection: {p.connectionStatusLabel ?? p.status}</p>
                          <p>
                            Current run:{" "}
                            {p.currentRunContribution ??
                              (p.contributedLastRun ? "CONTRIBUTED" : "NOT_USED")}
                          </p>
                          {p.currentRunReason && <p>Reason: {p.currentRunReason}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.paper_evidence.prismaClientStale && data.paper_evidence.prismaStaleMessage && (
                  <p className="text-sm text-destructive rounded-lg border border-destructive/30 p-2">
                    {data.paper_evidence.prismaStaleMessage}
                  </p>
                )}

                <details className="rounded-lg border p-3">
                  <summary className="text-xs font-medium cursor-pointer">Detailed diagnostics</summary>
                  <div className="mt-3 space-y-3">
                {data.paper_evidence.scanner && (
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-medium">Scanner Mode</p>
                    <p>Mode: {data.paper_evidence.scanner.scannerMode ?? "WIDE"}</p>
                    <p>
                      Discovery source:{" "}
                      {data.paper_evidence.scanner.dataSources?.join(" / ") ?? "Kraken"}
                    </p>
                    <p>Coins discovered: {data.paper_evidence.scanner.coinsDiscovered ?? "—"}</p>
                    <p>Coins evaluated: {data.paper_evidence.scanner.coinsEvaluated ?? "—"}</p>
                    {data.paper_evidence.scanner.pipeline && (
                      <div className="mt-2 space-y-0.5 rounded border p-2">
                        <p className="font-medium">Scan pipeline (SIMULATED)</p>
                        <p>Coins found: {data.paper_evidence.scanner.pipeline.coinsDiscovered ?? "—"}</p>
                        <p>Coins scanned: {data.paper_evidence.scanner.pipeline.coinsScanned ?? "—"}</p>
                        <p>
                          Filtered out: {data.paper_evidence.scanner.pipeline.coinsFilteredOut ?? "—"}
                        </p>
                        <p>
                          Passed basic filters:{" "}
                          {data.paper_evidence.scanner.pipeline.passedBasicFilters ?? "—"}
                        </p>
                        <p>
                          Deep evaluated: {data.paper_evidence.scanner.pipeline.deepEvaluated ?? "—"}
                          {data.paper_evidence.scanner.pipeline.deepEvaluationLimit
                            ? ` / limit ${data.paper_evidence.scanner.pipeline.deepEvaluationLimit}`
                            : ""}
                        </p>
                        <p>
                          Final ranked: {data.paper_evidence.scanner.pipeline.finalCandidates ?? "—"}
                        </p>
                        <p>
                          Final opportunities:{" "}
                          {data.paper_evidence.scanner.pipeline.finalPaperTradeCandidates ?? "—"}
                        </p>
                        {data.paper_evidence.scanner.pipeline.deepEvaluationLimitReason && (
                          <p className="text-muted-foreground">
                            {data.paper_evidence.scanner.pipeline.deepEvaluationLimitReason}
                          </p>
                        )}
                        {data.paper_evidence.scanner.pipeline.selectionExplanation && (
                          <p className="text-muted-foreground">
                            {data.paper_evidence.scanner.pipeline.selectionExplanation}
                          </p>
                        )}
                        <p>
                          Watch-only: {data.paper_evidence.scanner.pipeline.watchOnlyCandidates ?? "—"}
                        </p>
                        <p>
                          Removed (exchange):{" "}
                          {data.paper_evidence.scanner.pipeline.removedByExchangeAvailability ?? 0}
                        </p>
                        <p>
                          Removed (volume):{" "}
                          {data.paper_evidence.scanner.pipeline.removedByVolume ?? 0}
                        </p>
                      </div>
                    )}
                    {data.paper_evidence.scanner.pipeline?.providerStatus && (
                      <p className="text-xs">
                        Providers:{" "}
                        {Object.entries(data.paper_evidence.scanner.pipeline.providerStatus)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {data.paper_evidence.scanner?.finalCandidateOutputs &&
                  data.paper_evidence.scanner.finalCandidateOutputs.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Final Candidate Output (SIMULATED)</p>
                      <ul className="space-y-2 text-xs">
                        {data.paper_evidence.scanner.finalCandidateOutputs.slice(0, 5).map((c) => (
                          <li key={c.symbol} className="rounded border p-2">
                            <p className="font-medium">
                              {c.name} ({c.symbol}) — {c.finalRecommendation} — score{" "}
                              {c.scores.finalTotal.toFixed(0)}
                            </p>
                            <p>
                              Vol ${c.volume24hUsd.toLocaleString()} · 24h {c.change24hPct.toFixed(1)}% ·
                              conf {c.scores.confidenceLevel} · risk {c.scores.riskLevel}
                            </p>
                            <p>
                              Kraken spot {c.availabilitySummary.krakenSpotAvailable} · leverage{" "}
                              {c.availabilitySummary.krakenLeverageAvailable} · U.S.{" "}
                              {c.availabilitySummary.usAvailability}
                            </p>
                            <p>
                              Type: {c.recommendedTradeType} · alloc {c.recommendedCapitalAllocationPct.toFixed(2)}%
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {data.paper_evidence.scanner?.scannerHealth && (
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-medium">Scanner Health</p>
                    <p>Universe size: {data.paper_evidence.scanner.scannerHealth.universeSize}</p>
                    <p>Symbols scanned: {data.paper_evidence.scanner.scannerHealth.symbolsScanned}</p>
                    <p>
                      Fetches OK / failed: {data.paper_evidence.scanner.scannerHealth.successfulFetches}{" "}
                      / {data.paper_evidence.scanner.scannerHealth.failedFetches}
                    </p>
                    <p>
                      Avg spread:{" "}
                      {data.paper_evidence.scanner.scannerHealth.averageSpreadBps?.toFixed(1) ?? "—"} bps
                    </p>
                    <p>Stale symbols: {data.paper_evidence.scanner.scannerHealth.staleSymbols}</p>
                    <p>High-vol candidates: {data.paper_evidence.scanner.scannerHealth.highVolCount ?? 0}</p>
                    <p>Watchlist-only: {data.paper_evidence.scanner.scannerHealth.watchlistCount ?? 0}</p>
                  </div>
                )}

                {data.paper_evidence.scanner?.highVolatilityOpportunities &&
                  data.paper_evidence.scanner.highVolatilityOpportunities.length > 0 && (
                    <div className="rounded-lg border border-amber-500/30 p-3 space-y-1">
                      <p className="text-xs font-medium">Top High-Volatility Opportunities</p>
                      <ul className="space-y-1 text-xs">
                        {data.paper_evidence.scanner.highVolatilityOpportunities.map((c, i) => (
                          <li key={`${c.symbol}-hv-${i}`}>
                            {c.symbol} — {c.riskTier ?? "—"} — 24h{" "}
                            {c.change24hPct?.toFixed(1) ?? "—"}% — score{" "}
                            {c.score?.toFixed(0) ?? "—"} — {c.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {data.paper_evidence.scanner?.tradablePaperCandidates &&
                  data.paper_evidence.scanner.tradablePaperCandidates.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Tradable Paper Candidates</p>
                      <ul className="space-y-1 text-xs">
                        {data.paper_evidence.scanner.tradablePaperCandidates.map((c, i) => (
                          <li key={`${c.symbol}-tp-${i}`}>
                            {c.symbol} — {c.riskTier ?? "—"} — score {c.score?.toFixed(0) ?? "—"} —{" "}
                            {c.action}: {c.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {data.paper_evidence.scanner?.watchlistOnlyMovers &&
                  data.paper_evidence.scanner.watchlistOnlyMovers.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Watchlist-Only Movers</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {data.paper_evidence.scanner.watchlistOnlyMovers.map((c, i) => (
                          <li key={`${c.symbol}-wl-${i}`}>
                            {c.symbol} — 24h {c.change24hPct?.toFixed(1) ?? "—"}% — not tradable on
                            Kraken — {c.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {data.paper_evidence.scanner?.topCandidates &&
                  data.paper_evidence.scanner.topCandidates.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-1">
                      <p className="text-xs font-medium">Top Opportunity Candidates</p>
                      <ul className="space-y-1 text-xs">
                        {data.paper_evidence.scanner.topCandidates.map((c, i) => (
                          <li key={`${c.symbol}-top-${i}`}>
                            {c.symbol} — {c.riskTier ?? "—"} — score {c.score?.toFixed(0) ?? "—"}, 24h{" "}
                            {c.change24hPct?.toFixed(1) ?? "—"}%, spread{" "}
                            {c.spreadBps?.toFixed(1) ?? "—"} bps —{" "}
                            {(c as { runDisplayLabel?: string }).runDisplayLabel ?? c.action}: {c.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {data.paper_evidence.scanner?.whyNoTrade && (
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-xs font-medium">Why Candidates Were Rejected</p>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {data.paper_evidence.scanner.whyNoTrade.topReasons.map((r) => (
                        <li key={r.reason}>
                          {r.reason}: {r.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                  </div>
                </details>
                </>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No paper evidence runs yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
            <Button onClick={() => void runPaperEvidenceStep()} disabled={paperRunLoading}>
              {paperRunLoading ? "Running scanner…" : "Run Paper Evidence Step"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportPaperLog()}
              disabled={exportLogLoading}
            >
              {exportLogLoading ? "Exporting…" : "Export Full Paper Log"}
            </Button>
            </div>
            {paperRunLoading && (
              <p className="text-xs text-muted-foreground">
                Elapsed: {(paperRunElapsedMs / 1000).toFixed(1)}s
              </p>
            )}
            {paperRunError && (
              <p className="text-sm text-destructive rounded-lg border border-destructive/30 p-2">
                Current run error: {paperRunError}
              </p>
            )}
            {exportStatus !== "EXPORT_READY" && (
              <p
                className={`text-sm rounded-lg border p-2 ${
                  exportStatus === "EXPORT_FAILED"
                    ? "text-destructive border-destructive/30"
                    : exportStatus === "EXPORT_DOWNLOADED"
                      ? "text-green-700 border-green-500/30 dark:text-green-400"
                      : "text-muted-foreground border-border"
                }`}
              >
                Export status: {exportStatus}
                {exportMessage ? ` — ${exportMessage}` : ""}
              </p>
            )}
            {paperRunWarnings.length > 0 && (
              <div className="text-sm rounded-lg border border-amber-500/30 p-2 space-y-1">
                <p className="text-xs font-medium">Current run warnings</p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {paperRunWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {isAllTimeView && paperRunResult && (
              <div className="space-y-2 rounded-lg border p-3">
                <StatusRow label="Current run status" status={paperRunResult.status} />
                {paperRunResult.runOutcomeMessage && (
                  <p className="text-sm">{paperRunResult.runOutcomeMessage}</p>
                )}
                {paperRunResult.reasonCode && (
                  <p>
                    Reason: [{paperRunResult.reasonCode}] {paperRunResult.reasonText ?? ""}
                  </p>
                )}
                <StatusRow label="Latest Action" status={paperRunResult.latestAction} />
                {paperRunResult.runId && <p className="text-xs text-muted-foreground">Run ID: {paperRunResult.runId}</p>}
                {paperRunResult.durationMs !== undefined && (
                  <p>Duration: {(paperRunResult.durationMs / 1000).toFixed(1)}s</p>
                )}
                {paperRunResult.countDelta !== undefined && (
                  <p>
                    Evidence count delta: {paperRunResult.countDelta >= 0 ? "+" : ""}
                    {paperRunResult.countDelta} ({paperRunResult.evidenceCountBefore ?? "?"} →{" "}
                    {paperRunResult.evidenceCountAfter ?? "?"})
                  </p>
                )}
                {paperRunResult.paperRunsBefore !== undefined && (
                  <p>
                    Paper runs: {paperRunResult.paperRunsBefore} → {paperRunResult.paperRunsAfter}
                  </p>
                )}
                {(paperRunResult.candidatesStored !== undefined ||
                  paperRunResult.signalsStored !== undefined ||
                  paperRunResult.snapshotsStored !== undefined) && (
                  <p>
                    Stored this run — candidates: {paperRunResult.candidatesStored ?? 0}, signals:{" "}
                    {paperRunResult.signalsStored ?? 0}, snapshots: {paperRunResult.snapshotsStored ?? 0}
                  </p>
                )}
                {paperRunResult.maxOpenTradesReached && (
                  <div className="text-amber-600 space-y-1 text-xs">
                    <p>
                      Open trades before: {paperRunResult.openTradesBefore ?? "?"} · Closed this run:{" "}
                      {paperRunResult.tradesClosed ?? 0} · Opened this run:{" "}
                      {paperRunResult.tradesOpened ?? 0} · Open trades after:{" "}
                      {paperRunResult.openTradesAfter ?? "?"}
                    </p>
                    <p>
                      Max open trades: {paperRunResult.maxOpenTrades ?? "?"} —{" "}
                      {paperRunResult.openTradesAfter === paperRunResult.maxOpenTrades
                        ? "New openings now blocked until one open paper trade closes or expires."
                        : "Slots available for new trades."}
                    </p>
                  </div>
                )}
                {paperRunResult.scannerMode && (
                  <p>
                    Scanner mode: {paperRunResult.scannerMode} · Sources:{" "}
                    {paperRunResult.dataSources?.join(", ") ?? "kraken"}
                  </p>
                )}
                {paperRunResult.universeSize !== undefined && (
                  <p>
                    Discovered: {paperRunResult.coinsDiscovered ?? paperRunResult.universeSize} ·
                    Evaluated: {paperRunResult.coinsEvaluated ?? paperRunResult.scannedSymbolCount} ·
                    Ranked: {paperRunResult.rankedCandidateCount} · High-vol:{" "}
                    {paperRunResult.highVolCount ?? 0} · Watchlist: {paperRunResult.watchlistCount ?? 0}
                  </p>
                )}
                {paperRunResult.tradesOpened !== undefined && (
                  <p>
                    Opened / updated / closed this run: {paperRunResult.tradesOpened} /{" "}
                    {paperRunResult.tradesUpdated ?? 0} / {paperRunResult.tradesClosed ?? 0}
                  </p>
                )}
                <p>Open trades: {paperRunResult.openPaperTrades}</p>
                <p>Closed trades: {paperRunResult.closedPaperTrades}</p>
                <div className="rounded-lg border p-3 space-y-1 text-xs">
                  <p className="font-medium">Current run P&L (SIMULATED)</p>
                  <p>Portfolio P&L before run: {paperRunResult.portfolioPnlBeforeRun?.toFixed(4) ?? "UNKNOWN"} SIM</p>
                  <p>Portfolio P&L after run: {paperRunResult.portfolioPnlAfterRun?.toFixed(4) ?? "UNKNOWN"} SIM</p>
                  <p>
                    Realized P&L this run: {paperRunResult.realizedPnlThisRun?.toFixed(4) ?? "UNKNOWN"} SIM
                  </p>
                  <p>
                    Unrealized P&L change this run:{" "}
                    {paperRunResult.unrealizedPnlChangeThisRun?.toFixed(4) ?? "UNKNOWN"} SIM
                  </p>
                  <p>
                    Net change this run: {paperRunResult.currentRunPnlDelta?.toFixed(4) ?? "UNKNOWN"} SIM
                  </p>
                  <p className="text-muted-foreground">
                    Realized = closed trades this run. Unrealized change = mark-to-market move on open trades.
                    Net = realized + unrealized change.
                  </p>
                </div>
                <p>Simulated net P&L (all time realized): {paperRunResult.simulatedNetPnl.toFixed(4)} SIM</p>
                {paperRunResult.deepEvaluationExplanation && (
                  <p className="text-xs text-muted-foreground">{paperRunResult.deepEvaluationExplanation}</p>
                )}
                {paperRunResult.dynamicCapacity && (
                  <div className="text-xs space-y-0.5">
                    <p>
                      Dynamic capacity — base: {paperRunResult.dynamicCapacity.baseMaxOpenTrades} · dynamic:{" "}
                      {paperRunResult.dynamicCapacity.dynamicMaxOpenTrades} · open:{" "}
                      {paperRunResult.dynamicCapacity.currentOpenTrades} · slots:{" "}
                      {paperRunResult.dynamicCapacity.availableSlots}
                    </p>
                    {paperRunResult.dynamicCapacity.factors.map((f) => (
                      <p key={f} className="text-muted-foreground">
                        {f}
                      </p>
                    ))}
                  </div>
                )}
                {paperRunResult.openedTrades && paperRunResult.openedTrades.length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Paper Trades Opened</p>
                    <ul className="text-xs space-y-1">
                      {paperRunResult.openedTrades.map((t) => (
                        <li key={t.symbol}>
                          {t.symbol} {t.side} — tier {t.riskTier ?? "—"} — risk{" "}
                          {t.riskPercent?.toFixed(2) ?? "—"}%
                          {t.warning ? ` — ${t.warning}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {paperRunResult.highVolatilityOpportunities &&
                  paperRunResult.highVolatilityOpportunities.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">High-Volatility Opportunities</p>
                      <ul className="text-xs space-y-1">
                        {paperRunResult.highVolatilityOpportunities.map((c, i) => (
                          <li key={`${c.symbol}-run-hv-${i}`}>
                            {c.symbol} — {c.riskTier} — 24h {c.change24hPct?.toFixed(1)}% —{" "}
                            {c.reasonText}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {paperRunResult.watchlistOnlyMovers &&
                  paperRunResult.watchlistOnlyMovers.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">Watchlist-Only Movers</p>
                      <ul className="text-xs space-y-1 text-muted-foreground">
                        {paperRunResult.watchlistOnlyMovers.map((c, i) => (
                          <li key={`${c.symbol}-run-wl-${i}`}>
                            {c.symbol} — 24h {c.change24hPct?.toFixed(1)}% — {c.reasonText}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {paperRunResult.topCandidates && paperRunResult.topCandidates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Top candidates this run</p>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {paperRunResult.topCandidates.map((c, i) => (
                        <li key={`${c.symbol}-run-top-${i}`}>
                          {c.symbol} score {c.opportunityScore.toFixed(0)} —{" "}
                          {c.runDisplayLabel ?? c.recommendationLabel ?? c.reasonCode}: {c.reasonText}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {paperRunResult.rejectionSummary &&
                  Object.keys(paperRunResult.rejectionSummary).length > 0 && (
                    <div>
                      <p className="text-xs font-medium">Rejection summary</p>
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        {Object.entries(paperRunResult.rejectionSummary).map(([k, v]) => (
                          <li key={k}>
                            {k}: {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {paperRunResult.errors && paperRunResult.errors.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-destructive">Current run errors</p>
                    <ul className="list-inside list-disc text-xs text-destructive">
                      {paperRunResult.errors.map((e, i) => (
                        <li key={`run-err-${i}`}>
                          {e.includes("__TURBOPACK__")
                            ? e.replace(/__TURBOPACK__[^\s]+/g, "prisma").replace(/\s+/g, " ").trim()
                            : e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {paperRunResult.warnings && paperRunResult.warnings.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {paperRunResult.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              <li>Paper P&L is simulated.</li>
              <li>This does not unlock live trading.</li>
              <li>Auto remains locked.</li>
              <li>Do not treat paper results as real profit.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Exchange Account Readiness</CardTitle>
            <CardDescription>
              Read-only API support — does not unlock live trading or Auto execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.exchange_account_readiness ? (
              <>
                <StatusRow
                  label="Read-only API key stored"
                  status={data.exchange_account_readiness.readOnlyKeyConfigured ? "YES" : "NO"}
                />
                <StatusRow
                  label="Read-only key verification"
                  status={formatVerificationStatusLabel(
                    verifyResult?.verificationStatus ??
                      data.exchange_account_readiness.verificationStatus,
                  )}
                />
                <StatusRow
                  label="Can read balance"
                  status={
                    (verifyResult?.canReadBalance ??
                      data.exchange_account_readiness.canReadBalance)
                      ? "YES"
                      : "NO"
                  }
                />
                <StatusRow
                  label="Can read open orders"
                  status={
                    (verifyResult?.canReadOpenOrders ??
                      data.exchange_account_readiness.canReadOpenOrders)
                      ? "YES"
                      : "NO"
                  }
                />
                <StatusRow
                  label="Can read closed orders"
                  status={
                    (verifyResult?.canReadClosedOrders ??
                      data.exchange_account_readiness.canReadClosedOrders)
                      ? "YES"
                      : "NO"
                  }
                />
                <StatusRow
                  label="Can read trade history"
                  status={formatTradeHistoryStatus(
                    verifyResult,
                    data.exchange_account_readiness,
                  )}
                />
                {(verifyResult?.tradeHistoryCount ??
                  data.exchange_account_readiness.tradeHistoryCount) !== null &&
                  (verifyResult?.tradeHistoryCount ??
                    data.exchange_account_readiness.tradeHistoryCount) !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      Trade history count:{" "}
                      {String(
                        verifyResult?.tradeHistoryCount ??
                          data.exchange_account_readiness.tradeHistoryCount,
                      )}
                    </div>
                  )}
                {formatTradeHistoryStatus(verifyResult, data.exchange_account_readiness) ===
                  "EMPTY" && (
                  <p className="text-xs text-muted-foreground">
                    Trade history readable, but no records returned.
                  </p>
                )}
                {data.exchange_account_readiness.lastVerifiedAt && (
                  <div className="text-xs text-muted-foreground">
                    Last verified:{" "}
                    {new Date(data.exchange_account_readiness.lastVerifiedAt).toLocaleString()}
                  </div>
                )}
                {(verifyResult?.lastVerificationReason ??
                  data.exchange_account_readiness.lastVerificationReason) && (
                  <p className="text-xs text-muted-foreground">
                    {String(
                      verifyResult?.lastVerificationReason ??
                        data.exchange_account_readiness.lastVerificationReason,
                    )}
                  </p>
                )}
                {data.exchange_account_readiness.krakenError && (
                  <p className="text-xs text-amber-600">
                    Kraken: {data.exchange_account_readiness.krakenError}
                    {data.exchange_account_readiness.krakenError
                      .toUpperCase()
                      .includes("INVALID NONCE")
                      ? " — Nonce issue detected. This is usually a request ordering problem, not necessarily a bad key."
                      : ""}
                  </p>
                )}
                <StatusRow
                  label="Trading permission detected"
                  status={data.exchange_account_readiness.tradingPermissionDetected}
                />
                <StatusRow
                  label="Withdrawal permission detected"
                  status={data.exchange_account_readiness.withdrawalPermissionDetected}
                />
                <StatusRow label="Live trading" status="LOCKED" />
                <StatusRow label="Auto execution" status="LOCKED" />
                {data.exchange_account_readiness.permissionWarning && (
                  <p className="text-xs text-amber-600">
                    {data.exchange_account_readiness.permissionWarning}
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No exchange read-only key configured.</p>
            )}
            <div className="space-y-2 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-muted-foreground">
              <p>Read-only key does not allow trading.</p>
              <p>This does not unlock live trading.</p>
              <p>Never use withdrawal-enabled keys.</p>
              <p>
                Trading keys come later after paper evidence, shadow evidence, tiny canary, and
                reconciliation.
              </p>
            </div>
            <Button onClick={() => void runVerifyReadOnlyKey()} disabled={verifyLoading}>
              {verifyLoading ? "Verifying…" : "Verify Read-Only Key"}
            </Button>
            {verifyResult && (
              <div className="space-y-1 rounded-lg border p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span>Result:</span>
                  <Badge variant={verifyResult.safeToUseForReadOnly ? "success" : "warning"}>
                    {String(verifyResult.reasonCode ?? "UNKNOWN")}
                  </Badge>
                </div>
                {formatVerifyReasonMessage(verifyResult.reasonCode) ? (
                  <p className="text-muted-foreground">
                    {formatVerifyReasonMessage(verifyResult.reasonCode)}
                  </p>
                ) : null}
                {verifyResult.permissionWarning ? (
                  <p className="text-amber-600">{String(verifyResult.permissionWarning)}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {data?.next_steps_checklist && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>Next Steps Safe Path</CardTitle>
              <CardDescription>What to do before any live trading or real API keys</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="space-y-2">
                {data.next_steps_checklist.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span>{item.label}</span>
                    <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  </li>
                ))}
              </ul>
              {data.next_steps && (
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {data.next_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Run Safe Paper/Shadow Check</CardTitle>
            <CardDescription>Manual same-day evidence workflow — no live orders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Button onClick={() => void runSafeCheck()} disabled={safeCheckLoading}>
              {safeCheckLoading ? "Running…" : "Run Safe Paper/Shadow Check"}
            </Button>
            {safeCheck && (
              <div className="space-y-2 rounded-lg border p-3">
                <StatusRow label="Status" status={safeCheck.status} />
                <p>Data source: {safeCheck.dataSource}</p>
                <p>Live market data: {safeCheck.liveMarketDataConfigured ? "configured" : "not configured"}</p>
                <p>Paper mode ready: {safeCheck.paperModeReady ? "yes" : "no"}</p>
                <p>Same-day evidence: {safeCheck.sameDayEvidenceExists ? "some present" : "none"}</p>
                {safeCheck.missingRequirements.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {safeCheck.missingRequirements.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs font-medium">{safeCheck.nextRecommendedAction}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Same-Day Reality Check</CardTitle>
              <CardDescription>Truthful evidence — never overstates proof</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data?.same_day_reality ? (
                <>
                  <p className="font-medium">{data.same_day_reality.headline}</p>
                  <Badge variant="outline">{data.same_day_reality.status}</Badge>
                  {data.same_day_reality.evidence_missing.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Missing:</p>
                      <ul className="list-inside list-disc text-xs">
                        {data.same_day_reality.evidence_missing.slice(0, 5).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Not enough data yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>P&L & Costs</CardTitle>
              <CardDescription>Net P&L primary — no fabricated metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Gross P&L: —</p>
              <p className="font-medium text-foreground">Net P&L: — (requires verified live trades)</p>
              <p>Fees / Slippage / Funding: —</p>
              <p className="text-xs">Paper profit is simulated — never labeled as real profit</p>
            </CardContent>
          </Card>
        </div>

        {data?.disclaimers && (
          <p className="text-xs text-muted-foreground">{data.disclaimers.join(" · ")}</p>
        )}
      </main>
    </div>
  );
}

function formatTradeHistoryStatus(
  verifyResult: Record<string, unknown> | null,
  readiness: ExchangeAccountReadiness,
): string {
  const readStatus = String(
    verifyResult?.tradeHistoryReadStatus ?? readiness.tradeHistoryReadStatus ?? "",
  );
  if (readStatus === "EMPTY") return "EMPTY";
  const canRead = Boolean(verifyResult?.canReadTradeHistory ?? readiness.canReadTradeHistory);
  return canRead ? "YES" : "NO";
}

function statusVariant(status: string): "success" | "warning" | "secondary" | "outline" {
  if (status === "PASS") return "success";
  if (status === "BLOCKED" || status === "FAIL") return "warning";
  return "secondary";
}

function StatusRow({ label, status }: { label: string; status: string }) {
  const variant =
    status === "LOCKED" || status === "BLOCK" || status === "NO" || status === "DO_NOT_TRADE_LIVE" || status === "FAILED"
      ? "warning"
      : status === "PARTIAL" || status === "UNKNOWN" || status === "EMPTY"
        ? "secondary"
      : status === "ENABLED" || status === "YES" || status === "PASS" || status === "READY" || status === "READY_FOR_PAPER"
        ? "success"
        : "secondary";
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <Badge variant={variant}>{status}</Badge>
    </div>
  );
}
