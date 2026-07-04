"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ProviderCredentialPublic, ProviderCategory, ProviderTypeId } from "@/lib/vault/types";
import { isPublicEndpointsOnlyProvider } from "@/lib/vault/types";
import type { ConnectionTestResult } from "@/lib/vault/types";
import type { ProviderKeyStatus } from "@prisma/client";
import { credentialStatusLabel } from "@/lib/vault/credential-status";
import { formatApiError, parseApiError } from "@/lib/utils/api-error";
import { formatVerifyReasonMessage } from "@/lib/utils/verify-readonly-messages";
import {
  formatConnectionReasonMessage,
  formatConnectionStatusLabel,
} from "@/lib/vault/connection-messages";

interface ProviderMeta {
  id: string;
  label: string;
  category: string;
  providerCategory: ProviderCategory;
  requiresSecret: boolean;
  requiresApiKey: boolean;
  legallySupportedDefault: boolean;
  legalNote: string;
  connectionTestNote: string;
  tradingPermissionPossible: boolean;
  withdrawalPermissionPossible: boolean;
}

interface ProviderEnvPublic {
  coingeckoConfigured: boolean;
  dexscreenerEnabled: boolean;
  defillamaEnabled: boolean;
  lunarcrushConfigured: boolean;
  lunarcrushEnabled: boolean;
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
  provider_env?: ProviderEnvPublic;
  public_providers?: PublicProviderVaultCard[];
}

interface PublicProviderVaultCard {
  provider: "DEX_SCREENER" | "DEFILLAMA";
  label: string;
  category: string;
  mode: "PUBLIC_ENDPOINT";
  apiKeyRequired: false;
  vaultCredentialRequired: false;
  enabledFromConfig: boolean;
  connectionStatus: "OK" | "ERROR" | "UNKNOWN" | "DISABLED";
  lastTestedAt: string | null;
  endpointTested: string | null;
  latencyMs: number | null;
  reasonCode: string | null;
  usedByScanner: boolean;
  dataUsedFor: string[];
  message: string;
}

export function ApiSetupPanel() {
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publicTesting, setPublicTesting] = useState(false);
  const [lastPublicTest, setLastPublicTest] = useState<ConnectionTestResult | null>(null);
  const [lastCredentialTest, setLastCredentialTest] = useState<ConnectionTestResult | null>(null);

  const [provider, setProvider] = useState("KRAKEN");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [legallyConfirmed, setLegallyConfirmed] = useState(false);
  const [ipWhitelistConfigured, setIpWhitelistConfigured] = useState(false);
  const [noWithdrawalPermission, setNoWithdrawalPermission] = useState(false);
  const [noTradingPermission, setNoTradingPermission] = useState(false);
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  const [marketDataAcknowledged, setMarketDataAcknowledged] = useState(false);

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
          apiKey: apiKey || undefined,
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
      setMarketDataAcknowledged(false);
      await fetchVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest(id: string) {
    setError(null);
    const res = await fetch(`/api/vault/${id}`, { method: "POST" });
    if (!res.ok) {
      const apiErr = await parseApiError(res);
      setError(formatApiError(apiErr, "Connection test failed"));
      return;
    }
    const json = (await res.json()) as { test?: ConnectionTestResult };
    setLastCredentialTest(json.test ?? null);
    await fetchVault();
  }

  async function handlePublicProviderTest(providerId: string) {
    setPublicTesting(true);
    setError(null);
    try {
      const res = await fetch("/api/vault/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!res.ok) {
        const apiErr = await parseApiError(res);
        throw new Error(formatApiError(apiErr, "Connection test failed"));
      }
      const json = (await res.json()) as { test: ConnectionTestResult };
      setLastPublicTest(json.test);
      await fetchVault();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPublicTesting(false);
    }
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
  const providerCategory = selectedMeta?.providerCategory ?? "OTHER";
  const exchangeAttestationRequired = providerCategory === "EXCHANGE";
  const marketDataProvider = providerCategory === "MARKET_DATA";
  const dexDataProvider = providerCategory === "DEX_DATA";
  const defiDataProvider = providerCategory === "DEFI_DATA";
  const socialProvider = providerCategory === "SOCIAL_SENTIMENT";
  const apiKeyRequired = selectedMeta?.requiresApiKey ?? true;
  const publicEndpointsOnly =
    selectedMeta != null && isPublicEndpointsOnlyProvider(selectedMeta.id as ProviderTypeId);

  const publicProviderCard = vault?.public_providers?.find((p) => p.provider === provider);

  const attestationComplete =
    !exchangeAttestationRequired ||
    (noWithdrawalPermission && noTradingPermission && readOnlyConfirmed);

  const marketDataComplete = !marketDataProvider || marketDataAcknowledged;
  const canSubmit = attestationComplete && marketDataComplete;

  if (loading) return <p className="text-sm text-muted-foreground">Loading API vault…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API Vault</h2>
          <p className="text-sm text-muted-foreground">
            Keys stored server-side only. Exchange keys require read-only attestation. Market-data
            providers have no trading or withdrawal permissions.
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

      {vault?.provider_env && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provider environment settings</CardTitle>
            <CardDescription>Server-side flags — secrets never exposed to client.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div>CoinGecko env key: {vault.provider_env.coingeckoConfigured ? "configured" : "not set"}</div>
            <div>DexScreener enabled: {vault.provider_env.dexscreenerEnabled ? "yes" : "no"}</div>
            <div>DeFiLlama enabled: {vault.provider_env.defillamaEnabled ? "yes" : "no"}</div>
            <div>LunarCrush enabled: {vault.provider_env.lunarcrushEnabled ? "yes" : "no"}</div>
            <div>LunarCrush env key: {vault.provider_env.lunarcrushConfigured ? "configured" : "not set"}</div>
          </CardContent>
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>
            {publicEndpointsOnly ? "Public Data Provider" : "Add Provider Key"}
          </CardTitle>
          <CardDescription>
            {publicEndpointsOnly
              ? "No vault credential required — verify public endpoint access and scanner usage below."
              : exchangeAttestationRequired
                ? "Exchange providers require read-only checklist confirmation."
                : "Data providers — no exchange trading or withdrawal permissions apply."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setLastPublicTest(null);
              }}
            >
              {vault?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.providerCategory})
                </option>
              ))}
            </select>
          </div>

          {publicEndpointsOnly && publicProviderCard ? (
            <PublicProviderStatusCard
              card={publicProviderCard}
              testing={publicTesting}
              lastTest={lastPublicTest}
              onTest={() => void handlePublicProviderTest(provider)}
            />
          ) : publicEndpointsOnly ? (
            <p className="text-sm text-muted-foreground">
              No API key is needed for this provider. Use Test Connection to verify public endpoint
              access.
            </p>
          ) : (
            <>
              {exchangeAttestationRequired && (
                <Card className="border-amber-600/40 bg-amber-600/10">
                  <CardContent className="space-y-2 pt-4 text-sm">
                    <p className="font-medium text-amber-200">Exchange read-only checklist (required)</p>
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
                      IP whitelist is configured/reviewed (recommended)
                    </label>
                  </CardContent>
                </Card>
              )}

              {marketDataProvider && (
                <Card className="border-blue-600/40 bg-blue-600/10">
                  <CardContent className="space-y-2 pt-4 text-sm">
                    <p className="font-medium text-blue-200">Market-data provider checklist</p>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      <li>Market data API key only</li>
                      <li>No trading permissions exist for this provider</li>
                      <li>No withdrawal permissions exist for this provider</li>
                      <li>Used only for market data scanning</li>
                    </ul>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={marketDataAcknowledged}
                        onChange={(e) => setMarketDataAcknowledged(e.target.checked)}
                      />
                      I understand this is a market-data key only
                    </label>
                  </CardContent>
                </Card>
              )}

              {socialProvider && (
                <Card className="border-blue-600/40 bg-blue-600/10">
                  <CardContent className="space-y-2 pt-4 text-sm">
                    <p className="font-medium text-blue-200">Social / sentiment provider</p>
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      <li>API key may be required</li>
                      <li>Used only for social hype, sentiment, and trending data</li>
                    </ul>
                  </CardContent>
                </Card>
              )}

              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                {selectedMeta && (
                  <p className="text-xs text-muted-foreground">{selectedMeta.legalNote}</p>
                )}
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
                {apiKeyRequired ? (
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
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="apiKeyOptional">API Key (optional)</Label>
                    <input
                      id="apiKeyOptional"
                      type="password"
                      autoComplete="off"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Leave blank for public endpoints"
                    />
                  </div>
                )}
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
                <Button type="submit" disabled={submitting || vaultWritesBlocked || !canSubmit}>
                  {submitting ? "Saving…" : apiKeyRequired ? "Save Key (encrypted)" : "Save Provider Config (optional key)"}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      {lastCredentialTest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last connection test</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionTestDetails test={lastCredentialTest} />
          </CardContent>
        </Card>
      )}

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
              Verify Exchange Read-Only Key
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
  const isExchange = cred.providerCategory === "EXCHANGE";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-1">
        <p className="font-medium">{cred.label}</p>
        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>Provider: {cred.provider}</div>
          <div>Category: {cred.providerCategoryLabel}</div>
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
              : cred.lastConnectionTestAt
                ? new Date(cred.lastConnectionTestAt).toLocaleString()
                : "—"}
          </div>
          <div>Data access verified: {cred.dataAccessVerified ? "YES" : "NO"}</div>
          <div>Trading permission possible: {cred.tradingPermissionPossible ? "yes" : "no"}</div>
          <div>Withdrawal permission possible: {cred.withdrawalPermissionPossible ? "yes" : "no"}</div>
          {isExchange ? (
            <>
              <div>
                Read-only attested:{" "}
                {cred.permissionSelfAttestation?.readOnlyConfirmed ? "YES" : "NO"}
              </div>
              <div>
                IP whitelist confirmed:{" "}
                {cred.permissionSelfAttestation?.ipWhitelistConfirmed ? "YES" : "NO"}
              </div>
              {cred.canTrade && <div className="text-destructive">Trading permission detected</div>}
              {cred.canWithdraw && (
                <div className="text-destructive">Withdrawal permission detected</div>
              )}
            </>
          ) : (
            <div className="sm:col-span-2 text-blue-300">
              {cred.providerCategory === "MARKET_DATA" &&
                "Market-data provider — no trading/withdrawal permissions."}
              {cred.providerCategory === "DEX_DATA" &&
                "DEX data provider — no trading/withdrawal permissions."}
              {cred.providerCategory === "DEFI_DATA" &&
                "DeFi data provider — no trading/withdrawal permissions."}
              {cred.providerCategory === "SOCIAL_SENTIMENT" &&
                "Social/sentiment provider — no exchange permissions."}
              {cred.providerCategory === "OTHER" &&
                "Non-exchange provider — no trading/withdrawal permissions."}
            </div>
          )}
          {cred.lastConnectionStatus && (
            <>
              <div>
                Connection:{" "}
                {formatConnectionStatusLabel(cred.lastConnectionStatus, cred.lastHealthStatus)}
              </div>
              <div className="sm:col-span-2">
                {formatConnectionReasonMessage(cred.lastConnectionStatus) ||
                  cred.lastConnectionStatus}
              </div>
            </>
          )}
        </div>
        {!enabled && (
          <p className="text-xs text-amber-600">
            Credential is disabled. Verification will not use this key.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            {isExchange && (
              <Button size="sm" variant="outline" onClick={onVerify}>
                Verify Read-Only Key
              </Button>
            )}
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

function PublicProviderStatusCard({
  card,
  testing,
  lastTest,
  onTest,
}: {
  card: PublicProviderVaultCard;
  testing: boolean;
  lastTest: ConnectionTestResult | null;
  onTest: () => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-blue-600/30 bg-blue-600/5 p-4">
      <p className="text-sm text-blue-200">{card.message}</p>
      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>Provider: {card.label}</div>
        <div>Category: {card.category}</div>
        <div>Mode: {card.mode}</div>
        <div>API key required: NO</div>
        <div>Vault credential required: NO</div>
        <div>Enabled from config: {card.enabledFromConfig ? "YES" : "NO"}</div>
        <div>Connection status: {card.connectionStatus}</div>
        <div>Used by scanner: {card.usedByScanner ? "YES" : "NO"}</div>
        <div>
          Last tested:{" "}
          {card.lastTestedAt ? new Date(card.lastTestedAt).toLocaleString() : "—"}
        </div>
        <div>Endpoint: {card.endpointTested ?? "—"}</div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Data used for</p>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {card.dataUsedFor.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <Button type="button" variant="outline" disabled={testing} onClick={onTest}>
        {testing ? "Testing…" : "Test Connection"}
      </Button>
      {lastTest && <ConnectionTestDetails test={lastTest} checkedAt={card.lastTestedAt ?? undefined} />}
      {!lastTest && card.reasonCode && card.lastTestedAt && (
        <p className="text-xs text-muted-foreground">
          Last result: [{card.reasonCode}] {card.connectionStatus}
        </p>
      )}
    </div>
  );
}

function ConnectionTestDetails({
  test,
  checkedAt,
}: {
  test: ConnectionTestResult;
  checkedAt?: string;
}) {
  const safeMessage =
    formatConnectionReasonMessage(test.reasonCode) || test.message || "Connection test completed.";

  return (
    <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
      <div>Status: {formatConnectionStatusLabel(test.reasonCode, test.status)}</div>
      <div>Reason: {test.reasonCode}</div>
      <div className="sm:col-span-2">{safeMessage}</div>
      {test.endpointTested && <div className="sm:col-span-2">Endpoint: {test.endpointTested}</div>}
      {checkedAt && <div>Checked: {new Date(checkedAt).toLocaleString()}</div>}
      <div>Latency: {test.latencyMs}ms</div>
      <div>Key used: {test.keyUsed ? "yes" : "no"}</div>
      <div>Public fallback: {test.publicFallbackUsed ? "yes" : "no"}</div>
      {test.rateLimitStatus && <div>Rate limit: {test.rateLimitStatus}</div>}
    </div>
  );
}
