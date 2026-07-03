"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ProviderCredentialPublic } from "@/lib/vault/types";
import type { ProviderKeyStatus } from "@prisma/client";
import { credentialStatusLabel } from "@/lib/vault/credential-status";
import { formatApiError, parseApiError } from "@/lib/utils/api-error";
import { formatVerifyReasonMessage } from "@/lib/utils/verify-readonly-messages";

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
  local_owner_mode?: boolean;
  vault_status?: string;
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
  const [noWithdrawalPermission, setNoWithdrawalPermission] = useState(false);
  const [noTradingPermission, setNoTradingPermission] = useState(false);
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);

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
          permissionSelfAttestation: exchangeAttestationRequired
            ? {
                noWithdrawalPermission,
                noTradingPermission,
                readOnlyConfirmed,
                ipWhitelistConfirmed: ipWhitelistConfigured,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const apiErr = await parseApiError(res);
        throw new Error(formatApiError(apiErr, "Vault save failed"));
      }
      setApiKey("");
      setApiSecret("");
      setLabel("");
      setNoWithdrawalPermission(false);
      setNoTradingPermission(false);
      setReadOnlyConfirmed(false);
      await fetchVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(id: string) {
    const res = await fetch(`/api/vault/${id}`, { method: "POST" });
    if (!res.ok) {
      const apiErr = await parseApiError(res);
      setError(formatApiError(apiErr, "Connection test failed"));
      return;
    }
    await fetchVault();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/vault/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const apiErr = await parseApiError(res);
      setError(formatApiError(apiErr, "Delete failed"));
      return;
    }
    await fetchVault();
  }

  async function handleVerifyReadOnly(credentialId?: string) {
    setError(null);
    const res = await fetch("/api/vault/verify-readonly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentialId ? { credentialId } : {}),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const apiErr = await parseApiError(res);
      setError(formatApiError(apiErr, "Verify failed"));
      return;
    }
    const reasonCode = String(json.reasonCode ?? "UNKNOWN");
    const hint = formatVerifyReasonMessage(reasonCode);
    if (!json.safeToUseForReadOnly) {
      setError(hint || `Verify failed: [${reasonCode}]`);
    } else {
      setError(null);
    }
    await fetchVault();
  }

  async function handleEmergencyDisable() {
    const res = await fetch("/api/vault/emergency-disable", { method: "POST" });
    if (!res.ok) {
      const apiErr = await parseApiError(res);
      setError(formatApiError(apiErr, "Emergency disable failed"));
      return;
    }
    await fetchVault();
  }

  const selectedMeta = vault?.providers.find((p) => p.id === provider);
  const vaultWritesBlocked = vault ? !vault.vault_writes_allowed : true;
  const blockReasons = vault?.vault_block_reasons ?? [];
  const exchangeAttestationRequired = selectedMeta?.category === "exchange";
  const attestationComplete =
    !exchangeAttestationRequired ||
    (noWithdrawalPermission && noTradingPermission && readOnlyConfirmed);

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
                  {r === "ENCRYPTION_KEY_UNSAFE" || r === "DEV_ENCRYPTION_ONLY"
                    ? "Set ENCRYPTION_KEY in .env (openssl rand -base64 32), restart dev server"
                    : r === "AUTH_NOT_CONFIGURED"
                      ? "Enable LOCAL_OWNER_MODE or configure Supabase Auth"
                      : r === "AUTH_REQUIRED"
                        ? "Sign in required before storing API keys"
                        : r === "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION"
                          ? "LOCAL_OWNER_MODE blocked in production"
                          : r}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {vault?.auth &&
        vault.auth.status !== "AUTH_READY" &&
        vault.auth.status !== "LOCAL_OWNER_MODE" && (
        <Badge variant="outline">{vault.auth.status}</Badge>
      )}

      {vault?.auth?.status === "LOCAL_OWNER_MODE" && (
        <Badge variant="outline">LOCAL_OWNER_MODE_ACTIVE</Badge>
      )}

      {vault?.vault_writes_allowed === false && (
        <p className="text-xs text-muted-foreground">
          Vault writes are allowed in Local Owner Mode only after ENCRYPTION_KEY is valid. Do not add
          real API keys until you understand exchange permissions. Use read-only keys first. Never
          enable withdrawal permissions.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add Provider Key</CardTitle>
          <CardDescription>
            Read-only keys only for exchanges. No trading or withdrawal permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exchangeAttestationRequired && (
            <Card className="mb-4 border-amber-600/40 bg-amber-600/10">
              <CardContent className="space-y-2 pt-4 text-sm">
                <p className="font-medium text-amber-200">Read-only key checklist (required)</p>
                <p className="text-xs text-muted-foreground">
                  Only read-only keys are allowed. Never use withdrawal-enabled keys.
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={noWithdrawalPermission}
                    onChange={(e) => setNoWithdrawalPermission(e.target.checked)}
                  />
                  This key has no withdrawal permission
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={noTradingPermission}
                    onChange={(e) => setNoTradingPermission(e.target.checked)}
                  />
                  This key has no trading/order placement permission
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={readOnlyConfirmed}
                    onChange={(e) => setReadOnlyConfirmed(e.target.checked)}
                  />
                  This key is read-only
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ipWhitelistConfigured}
                    onChange={(e) => setIpWhitelistConfigured(e.target.checked)}
                  />
                  IP whitelist is configured (recommended)
                </label>
                <p className="text-xs text-muted-foreground">
                  Could not fully verify permissions automatically. Confirm manually that this key
                  has no trading or withdrawal permissions.
                </p>
              </CardContent>
            </Card>
          )}
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

            {!exchangeAttestationRequired && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ipWhitelistConfigured}
                  onChange={(e) => setIpWhitelistConfigured(e.target.checked)}
                />
                IP whitelist configured on provider
              </label>
            )}

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

            <Button type="submit" disabled={submitting || vaultWritesBlocked || !attestationComplete}>
              {vaultWritesBlocked
                ? "Vault writes blocked"
                : !attestationComplete && exchangeAttestationRequired
                  ? "Complete read-only checklist"
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
            <StoredCredentialRow
              key={cred.id}
              cred={cred}
              onTest={() => void handleTest(cred.id)}
              onVerify={() => void handleVerifyReadOnly(cred.id)}
              onDelete={() => void handleDelete(cred.id)}
            />
          ))}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => void handleVerifyReadOnly()}>
              Verify Read-Only Key
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleEmergencyDisable()}>
              Emergency Disable All Keys
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StoredCredentialRow({
  cred,
  onTest,
  onVerify,
  onDelete,
}: {
  cred: ProviderCredentialPublic;
  onTest: () => void;
  onVerify: () => void;
  onDelete: () => void;
}) {
  const enabled = credentialStatusLabel(cred.status as ProviderKeyStatus) === "ENABLED";
  const readOnlyAttested = cred.permissionSelfAttestation?.readOnlyConfirmed ? "YES" : "NO";
  const ipWhitelistConfirmed = cred.permissionSelfAttestation?.ipWhitelistConfirmed ? "YES" : "NO";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1">
        <p className="font-medium">{cred.label}</p>
        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>Provider: {cred.provider}</div>
          <div>Created: {new Date(cred.createdAt).toLocaleString()}</div>
          <div className="flex items-center gap-2">
            <span>Status:</span>
            <Badge variant={enabled ? "success" : "warning"}>
              {credentialStatusLabel(cred.status as ProviderKeyStatus)}
            </Badge>
          </div>
          <div>
            Last verified:{" "}
            {cred.lastReadOnlyVerifiedAt
              ? new Date(cred.lastReadOnlyVerifiedAt).toLocaleString()
              : "—"}
          </div>
          <div>Read-only attested: {readOnlyAttested}</div>
          <div>IP whitelist confirmed: {ipWhitelistConfirmed}</div>
          <div>Encryption: {cred.encryptionMethod}</div>
        </div>
        {!enabled && (
          <p className="text-xs text-amber-600">
            Credential is disabled. Verification will not use this key. Delete it and save a new
            read-only key.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button size="sm" variant="outline" onClick={onVerify}>
              Verify Read-Only Key
            </Button>
            <Button size="sm" variant="outline" onClick={onTest}>
              Test Connection
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="destructive" onClick={onDelete}>
          Delete Credential
        </Button>
      </div>
    </div>
  );
}
