"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ModeSelector } from "@/components/mode-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/lib/config/constants";

interface DashboardData {
  version: string;
  auto_unlock: {
    decision: string;
    auto_execution_enabled: boolean;
    failed_gate_count: number;
    scaling_allowed: boolean;
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
}

export function DashboardShell() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json = (await res.json()) as DashboardData & {
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

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
          <div className="flex items-center gap-3">
            <Link href="/settings/api">
              <Button variant="outline" size="sm">
                API Vault
              </Button>
            </Link>
            <Badge variant="outline">v{data?.version ?? "0.8.0"} — Production Readiness</Badge>
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
              ) : error ? (
                <p className="text-destructive">{error}</p>
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
                  {data.why_blocked.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Blocked: {data.why_blocked.join(", ")}
                    </p>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

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
                  {data.same_day_reality.warnings.map((w) => (
                    <p key={w} className="text-xs text-amber-600">
                      {w}
                    </p>
                  ))}
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
              <p>Drawdown: —</p>
              <p>Expectancy / Profit factor: —</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>System Readiness</CardTitle>
            <CardDescription>Final readiness check snapshot</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
            <div>
              <p className="text-muted-foreground">Checks passed</p>
              <p className="text-2xl font-bold">{data?.readiness.passed ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Partial</p>
              <p className="text-2xl font-bold">{data?.readiness.partial ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Workers defined</p>
              <p className="text-2xl font-bold">{data?.workers.total ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Endpoints (Prompt 8)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <code>GET /api/dashboard</code>
            <code>GET /api/readiness</code>
            <code>POST /api/reports/profitability</code>
            <code>GET /api/reality/same-day</code>
            <code>GET /api/auto/unlock</code>
            <code>POST /api/learning</code>
          </CardContent>
        </Card>

        {data?.disclaimers && (
          <p className="text-xs text-muted-foreground">{data.disclaimers.join(" · ")}</p>
        )}
      </main>
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: string }) {
  const variant =
    status === "LOCKED" || status === "BLOCK" || status === "NO"
      ? "warning"
      : status === "ENABLED" || status === "YES" || status === "PASS"
        ? "success"
        : "secondary";
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <Badge variant={variant}>{status}</Badge>
    </div>
  );
}
