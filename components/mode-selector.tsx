"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModeResponse } from "@/lib/types";
import { formatApiError, parseApiError } from "@/lib/utils/api-error";

const MODE_LABELS: Record<ModeResponse["current_mode"], string> = {
  paper: "Paper Mode",
  manual: "Manual Mode",
  auto: "Auto Mode",
};

export function ModeSelector() {
  const [mode, setMode] = useState<ModeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchMode = useCallback(async () => {
    try {
      const res = await fetch("/api/mode");
      if (!res.ok) {
        const apiErr = await parseApiError(res);
        throw new Error(formatApiError(apiErr, "Mode unavailable"));
      }
      const data = (await res.json()) as ModeResponse;
      setMode(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMode();
  }, [fetchMode]);

  async function handleModeChange(target: ModeResponse["current_mode"]) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to change mode");
      setMode(data as ModeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmergencyPause() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: mode?.current_mode ?? "paper", emergency_pause: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to pause");
      setMode(data as ModeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading mode state…</p>;
  }

  if (error && !mode) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!mode) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trading Mode</CardTitle>
        <CardDescription>
          Paper simulates realistically. Manual shows one trade card. Auto is locked until all proof
          gates pass.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["paper", "manual", "auto"] as const).map((m) => {
            const disabled =
              submitting ||
              (m === "paper" && !mode.paper_enabled) ||
              (m === "manual" && !mode.manual_enabled) ||
              (m === "auto" && !mode.auto_visible);

            return (
              <Button
                key={m}
                variant={mode.current_mode === m ? "default" : "outline"}
                disabled={disabled}
                onClick={() => void handleModeChange(m)}
              >
                {MODE_LABELS[m]}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">State: {mode.auto_state}</Badge>
          {mode.auto_execution_enabled ? (
            <Badge variant="success">Auto execution enabled</Badge>
          ) : (
            <Badge variant="warning">Auto execution locked</Badge>
          )}
          {mode.auto_blocked_reason && (
            <Badge variant="outline">{mode.auto_blocked_reason}</Badge>
          )}
        </div>

        {mode.current_mode === "auto" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={submitting || mode.auto_state === "emergency_stop"}
            onClick={() => void handleEmergencyPause()}
          >
            Emergency Pause
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          Last changed: {new Date(mode.last_changed_at).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
