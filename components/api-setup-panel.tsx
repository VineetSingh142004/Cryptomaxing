"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ProviderCredentialPublic } from "@/lib/vault/types";
import { formatApiError, parseApiError } from "@/lib/utils/api-error";

interface ProviderMeta {
  id: string;
  label: string;
  category: string;
  requiresSecret: boolean;
  legallySupportedDefault: boolean;
  legalNote: string;
}

interface VaultResponse {
  credentials: ProviderCredentialPublic[];
  providers: ProviderMeta[];
  encryption: {
    method: string;
    productionSafe: boolean;
    warning: string | null;
    vaultWritesAllowed?: boolean;
  };
  auth: { implemented: boolean; status: string; message: string };
  vault_writes_allowed: boolean;
  vault_block_reasons: string[];
}

export function ApiSetupPanel() {
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [provider, setProvider] = useState("KRAKEN");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [legallyConfirmed, setLegallyConfirmed] = useState(false);
  const [ipWhitelistConfigured, setIpWhitelistConfigured] = useState(false);

  const fetchVault = useCallback(async () => {
    try {
      const res = await fetch("/api/vault");
      if (!res.ok) {
        const apiErr = await parseApiError(res);
        throw new Error(formatApiError(apiErr, "API vault unavailable"));
      }
      setVault(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchVault();
  }, [fetchVault]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          label,
          apiKey,
          apiSecret: apiSecret || undefined,
          legallyConfirmed,
          ipWhitelistConfigured,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to save key");
      setApiKey("");
      setApiSecret("");
      setLabel("");
      await fetchVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(id: string) {
    const res = await fetch(`/api/vault/${id}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Test failed");
      return;
    }
    await fetchVault();
  }

  async function handleDisable(id: string) {
    const res = await fetch(`/api/vault/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Disabled by user" }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data?.error?.message ?? "Disable failed");
      return;
    }
    await fetchVault();
  }

  async function handleEmergencyDisable() {
    const res = await fetch("/api/vault/emergency-disable", { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data?.error?.message ?? "Emergency disable failed");
      return;
    }
    await fetchVault();
  }

  const selectedMeta = vault?.providers.find((p) => p.id === provider);
  const vaultWritesBlocked = vault ? !vault.vault_writes_allowed : true;
  const blockReasons = vault?.vault_block_reasons ?? [];

  if (loading) return <p className="text-sm text-muted-foreground">Loading API vault…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API Vault</h2>
          <p className="text-sm text-muted-foreground">
            Keys stored server-side only. Never logged. Withdrawal-enabled keys blocked.
          </p>
        </div>
        <Link href="/" className="text-sm text-primary hover:underline">
          ← Dashboard
        </Link>
      </div>

      {vault?.encryption.warning && (
        <Card className="border-amber-600/40 bg-amber-600/10">
          <CardContent className="pt-4 text-sm text-amber-200">{vault.encryption.warning}</CardContent>
        </Card>
      )}

      {vaultWritesBlocked && blockReasons.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="space-y-2 pt-4 text-sm">
            <p className="font-medium text-destructive">Vault writes blocked</p>
            <ul className="list-inside list-disc text-muted-foreground">
              {blockReasons.map((r) => (
                <li key={r}>
                  [{r}]{" "}
                  {r === "ENCRYPTION_KEY_UNSAFE"
                    ? "Set ENCRYPTION_KEY in .env (openssl rand -base64 32), restart dev server"
                    : r === "AUTH_NOT_IMPLEMENTED"
                      ? "User login not implemented — do not store real keys yet"
                      : r}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {vault?.auth && !vault.auth.implemented && (
        <Badge variant="outline">AUTH_NOT_IMPLEMENTED</Badge>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add Provider Key</CardTitle>
          <CardDescription>Read-only keys recommended first. No withdrawal permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {vault?.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.category})
                  </option>
                ))}
              </select>
              {selectedMeta && (
                <p className="text-xs text-muted-foreground">{selectedMeta.legalNote}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <input
                id="label"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                placeholder="e.g. Kraken read-only"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <input
                id="apiKey"
                type="password"
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
            </div>

            {selectedMeta?.requiresSecret && (
              <div className="space-y-2">
                <Label htmlFor="apiSecret">API Secret</Label>
                <input
                  id="apiSecret"
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  required
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ipWhitelistConfigured}
                onChange={(e) => setIpWhitelistConfigured(e.target.checked)}
              />
              IP whitelist configured on provider
            </label>

            {selectedMeta && !selectedMeta.legallySupportedDefault && (
              <label className="flex items-center gap-2 text-sm text-amber-200">
                <input
                  type="checkbox"
                  checked={legallyConfirmed}
                  onChange={(e) => setLegallyConfirmed(e.target.checked)}
                />
                I confirm legal jurisdiction allows this provider
              </label>
            )}

            <Button type="submit" disabled={submitting || vaultWritesBlocked}>
              {vaultWritesBlocked
                ? "Vault writes blocked"
                : submitting
                  ? "Saving…"
                  : "Save Key (encrypted)"}
            </Button>
            {vaultWritesBlocked && (
              <p className="text-xs text-muted-foreground">
                Fix block reasons above before storing API keys. Read-only keys recommended when enabled.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored Credentials</CardTitle>
          <CardDescription>Secrets never returned to client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {vault?.credentials.length === 0 && (
            <p className="text-sm text-muted-foreground">No credentials stored.</p>
          )}
          {vault?.credentials.map((cred) => (
            <div key={cred.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="font-medium">{cred.label}</p>
                <p className="text-xs text-muted-foreground">
                  {cred.provider} · {cred.status} · {cred.encryptionMethod}
                </p>
                {cred.permissionReasonCode && (
                  <Badge variant="outline" className="mt-1">
                    {cred.permissionReasonCode}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleTest(cred.id)}>
                  Test
                </Button>
                {cred.status === "ACTIVE" || cred.status === "PERMISSION_UNKNOWN" ? (
                  <Button size="sm" variant="destructive" onClick={() => void handleDisable(cred.id)}>
                    Disable
                  </Button>
                ) : null}
              </div>
            </div>
          ))}

          <Button variant="destructive" size="sm" onClick={() => void handleEmergencyDisable()}>
            Emergency Disable All Keys
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
