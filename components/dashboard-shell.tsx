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
}

interface PaperEvidenceData {
  paperModeReady: boolean;
  marketDataReady: boolean;
  openPaperTrades: number;
  closedPaperTrades: number;
  noTradeSignals: number;
  paperEvidenceCount: number;
  lastRunAt: string | null;
  currentStatus: string;
  nextAction: string;
  simulatedNetPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  warning: string;
  scanner?: {
    scannerMode?: string;
    dataSources?: string[];
    coinsDiscovered?: number;
    coinsEvaluated?: number;
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
  const [paperRunResult, setPaperRunResult] = useState<PaperRunResult | null>(null);
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

      if (json.status === "FAILED") {
        const code = json.reasonCode ?? json.error?.reasonCode ?? "PAPER_RUN_FAILED";
        const text = json.reasonText ?? json.error?.message ?? "Paper evidence run failed";
        setPaperRunError(`[${code}] ${text}`);
      } else if (json.warnings?.some((w) => w.startsWith("COINGECKO_UNAVAILABLE"))) {
        const cgWarn = json.warnings.find((w) => w.startsWith("COINGECKO_UNAVAILABLE"));
        if (cgWarn) setPaperRunError(cgWarn);
      }

      await fetchDashboard();
    } catch (err) {
      setPaperRunError(err instanceof Error ? err.message : "Paper evidence run failed");
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
                <p>Open Paper Trades: {data.paper_evidence.openPaperTrades}</p>
                <p>Closed Paper Trades: {data.paper_evidence.closedPaperTrades}</p>
                <p>No-Trade Signals: {data.paper_evidence.noTradeSignals}</p>
                <p>Paper Evidence Count: {data.paper_evidence.paperEvidenceCount}</p>
                <p>
                  Simulated Net P&L: {data.paper_evidence.simulatedNetPnl.toFixed(4)} (SIMULATED)
                </p>
                <p>
                  Wins / Losses / Breakevens: {data.paper_evidence.wins} / {data.paper_evidence.losses}{" "}
                  / {data.paper_evidence.breakevens}
                </p>
                <StatusRow label="Evidence status" status={data.paper_evidence.currentStatus} />

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
              {paperRunLoading ? "Running…" : "Run Paper Evidence Step"}
            </Button>
            {paperRunError && (
              <p className="text-sm text-destructive rounded-lg border border-destructive/30 p-2">
                {paperRunError}
              </p>
            )}
            {paperRunResult && (
              <div className="space-y-2 rounded-lg border p-3">
                <StatusRow label="Latest Action" status={paperRunResult.latestAction} />
                <p>Run status: {paperRunResult.status}</p>
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
                <p>Simulated net P&L: {paperRunResult.simulatedNetPnl.toFixed(4)}</p>
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
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {paperRunResult.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
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
