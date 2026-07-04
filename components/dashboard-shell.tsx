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
    openTrades: number;
    availableSlots: number;
    newTradeOpening: string;
    maxOpenTradesBlockReason: string | null;
    rotationEnabled: boolean;
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
  warning: string;
  liveTradingLocked?: true;
  autoExecutionLocked?: boolean;
  nextSafeAction?: string;
  tradeHistory?: {
    rows: Array<{
      tradeNumber: number;
      coin: string;
      exchange: string;
      marketType: string;
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
  currentRunPnlDelta?: number;
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
            {data?.paper_evidence ? (
              <>
                <StatusRow label="Paper Mode" status={data.paper_evidence.paperModeReady ? "READY" : "NO"} />
                <StatusRow
                  label="Market Data"
                  status={data.paper_evidence.marketDataReady ? "READY" : "NOT_CONFIGURED"}
                />
                <p>Last Paper Run: {data.paper_evidence.lastRunAt ?? "—"}</p>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="text-xs font-medium">Evidence Counts</p>
                  <p>Paper Runs: {data.paper_evidence.paperRuns ?? "—"}</p>
                  <p>Candidates Stored: {data.paper_evidence.candidatesStored ?? "—"}</p>
                  <p>Signals Stored: {data.paper_evidence.signalsStored ?? "—"}</p>
                  <p>Snapshots Stored: {data.paper_evidence.snapshotsStored ?? "—"}</p>
                  <p>
                    Paper Evidence Count Total:{" "}
                    {data.paper_evidence.paperEvidenceCountTotal ??
                      data.paper_evidence.paperEvidenceCount}
                  </p>
                </div>
                <p>Open Paper Trades: {data.paper_evidence.openPaperTrades}</p>
                <p>Closed Paper Trades: {data.paper_evidence.closedPaperTrades}</p>
                <p>No-Trade Signals: {data.paper_evidence.noTradeSignals}</p>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="text-xs font-medium">Open Trade Capacity</p>
                  <p>Max open trades: {data.paper_evidence.maxOpenTrades ?? "—"}</p>
                  <p>Open trades: {data.paper_evidence.openPaperTrades}</p>
                  <p>Available slots: {data.paper_evidence.availableSlots ?? "—"}</p>
                  <p>
                    New trade opening:{" "}
                    {data.paper_evidence.newTradeOpening ??
                      (data.paper_evidence.maxOpenTradesReached ? "BLOCKED" : "ALLOWED")}
                  </p>
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
                {data.paper_evidence.prismaClientStale && data.paper_evidence.prismaStaleMessage && (
                  <p className="text-sm text-destructive rounded-lg border border-destructive/30 p-2">
                    {data.paper_evidence.prismaStaleMessage}
                  </p>
                )}
                {data.paper_evidence.historicalPrismaWarning && !data.paper_evidence.prismaClientStale && (
                  <p className="text-xs text-muted-foreground rounded-lg border p-2">
                    Previous warning: {data.paper_evidence.historicalPrismaWarning}
                  </p>
                )}
                <p>
                  Simulated Net P&L: {data.paper_evidence.simulatedNetPnl.toFixed(4)} (SIMULATED)
                </p>
                <p>
                  Wins / Losses / Breakevens: {data.paper_evidence.wins} / {data.paper_evidence.losses}{" "}
                  / {data.paper_evidence.breakevens}
                </p>

                {data.paper_evidence.safetyVerification && (
                  <div className="rounded-lg border border-green-500/30 p-3 space-y-1">
                    <p className="text-xs font-medium">Safety Verification (SIMULATED)</p>
                    <p>Live trading: LOCKED</p>
                    <p>
                      Auto execution:{" "}
                      {data.paper_evidence.safetyVerification.autoExecutionLocked ? "LOCKED" : "—"}
                    </p>
                    <ul className="text-xs space-y-0.5">
                      {data.paper_evidence.safetyVerification.checks.map((c) => (
                        <li key={c.id}>
                          {c.passed ? "✓" : "✗"} {c.id.replace(/_/g, " ")}
                        </li>
                      ))}
                    </ul>
                    {data.paper_evidence.nextSafeAction && (
                      <p className="text-xs text-muted-foreground">
                        Next safe action: {data.paper_evidence.nextSafeAction}
                      </p>
                    )}
                  </div>
                )}

                {data.paper_evidence.tradeHistory && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Paper Trade History (SIMULATED)</p>
                    <p className="text-xs text-muted-foreground">{data.paper_evidence.tradeHistory.warning}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p>Total closed: {data.paper_evidence.tradeHistory.summary.totalTrades}</p>
                      <p>
                        Win rate:{" "}
                        {data.paper_evidence.tradeHistory.summary.winRate !== null
                          ? `${(data.paper_evidence.tradeHistory.summary.winRate * 100).toFixed(1)}%`
                          : "—"}
                      </p>
                      <p>Winners: {data.paper_evidence.tradeHistory.summary.profitableTrades}</p>
                      <p>Losers: {data.paper_evidence.tradeHistory.summary.losingTrades}</p>
                      <p>
                        Net P&L: {data.paper_evidence.tradeHistory.summary.netProfitLoss.toFixed(4)} (SIM)
                      </p>
                      <p>
                        Avg leverage:{" "}
                        {data.paper_evidence.tradeHistory.summary.averageLeverageUsed?.toFixed(2) ?? "1.00"}x
                      </p>
                    </div>
                    {data.paper_evidence.tradeHistory.rows.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="pr-2">#</th>
                              <th className="pr-2">Coin</th>
                              <th className="pr-2">Lev</th>
                              <th className="pr-2">Entry</th>
                              <th className="pr-2">Exit</th>
                              <th className="pr-2">Net P&L</th>
                              <th className="pr-2">%</th>
                              <th className="pr-2">Duration</th>
                              <th className="pr-2">Exit reason</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.paper_evidence.tradeHistory.rows.slice(0, 20).map((t) => (
                              <tr key={t.tradeNumber} className="border-t border-border/50">
                                <td className="pr-2 py-1">{t.tradeNumber}</td>
                                <td className="pr-2">{t.coin}</td>
                                <td className="pr-2">{t.leverageUsed}x</td>
                                <td className="pr-2">{t.entryPrice?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">{t.exitPrice?.toFixed(4) ?? "—"}</td>
                                <td className="pr-2">{t.netPnl?.toFixed(4) ?? "—"} SIM</td>
                                <td className="pr-2">{t.pctGainLoss?.toFixed(2) ?? "—"}%</td>
                                <td className="pr-2">{t.durationHours ?? "—"}h</td>
                                <td className="pr-2">{t.exitReason ?? "—"}</td>
                                <td>{t.finalResult}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <StatusRow label="Evidence status" status={data.paper_evidence.currentStatus} />

                {data.scanner_provider_status && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium">Scanner provider status</p>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      {data.scanner_provider_status.providers.map((p) => (
                        <div key={p.provider} className="rounded border p-2 space-y-0.5">
                          <p className="font-medium text-foreground">{p.label}</p>
                          <p>
                            Connection: {p.connectionStatusLabel ?? p.status}
                          </p>
                          <p>
                            Current run: {p.currentRunContribution ?? (p.contributedLastRun ? "CONTRIBUTED" : "NOT_USED")}
                          </p>
                          {p.currentRunReason && <p>Reason: {p.currentRunReason}</p>}
                        </div>
                      ))}
                    </div>
                    {data.scanner_provider_status.lastRunContributions && (
                      <p className="text-xs text-muted-foreground">
                        Last run — CoinGecko:{" "}
                        {data.scanner_provider_status.lastRunContributions.coingeckoContributed
                          ? "yes"
                          : "no"}
                        , DexScreener:{" "}
                        {data.scanner_provider_status.lastRunContributions.dexscreenerContributed
                          ? "yes"
                          : "no"}
                        , DeFiLlama:{" "}
                        {data.scanner_provider_status.lastRunContributions.defillamaContributed
                          ? "yes"
                          : "no"}
                        , Kraken:{" "}
                        {data.scanner_provider_status.lastRunContributions.krakenContributed
                          ? "yes"
                          : "no"}
                      </p>
                    )}
                  </div>
                )}

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
                            {c.spreadBps?.toFixed(1) ?? "—"} bps — {c.action}: {c.reason}
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
              </>
            ) : (
              <p className="text-muted-foreground">No paper evidence runs yet.</p>
            )}
            <Button onClick={() => void runPaperEvidenceStep()} disabled={paperRunLoading}>
              {paperRunLoading ? "Running scanner…" : "Run Paper Evidence Step"}
            </Button>
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
            {paperRunResult && (
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
                <p>Simulated net P&L: {paperRunResult.simulatedNetPnl.toFixed(4)} (portfolio SIM)</p>
                {paperRunResult.currentRunPnlDelta !== undefined && (
                  <p>Current run P&L delta: {paperRunResult.currentRunPnlDelta.toFixed(4)} SIM</p>
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
                          {c.symbol} score {c.opportunityScore.toFixed(0)} — {c.reasonCode}:{" "}
                          {c.reasonText}
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
