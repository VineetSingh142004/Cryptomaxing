import type { ProviderType } from "@prisma/client";
import type { ProviderCategory } from "@/lib/vault/categories";
import {
  categoryLabel,
  getProviderCategory,
  isExchangeCategory,
  tradingPermissionPossible,
  withdrawalPermissionPossible,
} from "@/lib/vault/categories";

export type { ProviderCategory } from "@/lib/vault/categories";
export {
  PROVIDER_CATEGORIES,
  getProviderCategory,
  isExchangeCategory,
  requiresReadOnlyAttestation,
  tradingPermissionPossible,
  withdrawalPermissionPossible,
  categoryLabel,
} from "@/lib/vault/categories";

export const PROVIDER_TYPES = [
  "KRAKEN",
  "COINBASE_ADVANCED",
  "BINANCE",
  "BINANCE_US",
  "BYBIT",
  "COINGECKO",
  "DEX_SCREENER",
  "GECKOTERMINAL",
  "DEFILLAMA",
  "LUNARCRUSH",
  "GOPLUS",
] as const satisfies readonly ProviderType[];

export type ProviderTypeId = (typeof PROVIDER_TYPES)[number];

export interface ProviderMetadata {
  id: ProviderTypeId;
  label: string;
  /** @deprecated use providerCategory */
  category: "exchange" | "market_data" | "security";
  providerCategory: ProviderCategory;
  requiresSecret: boolean;
  requiresPassphrase: boolean;
  requiresApiKey: boolean;
  legallySupportedDefault: boolean;
  legalNote: string;
  ipWhitelistRecommended: boolean;
  readOnlyRecommended: boolean;
  supportsTrade: boolean;
  tradingPermissionPossible: boolean;
  withdrawalPermissionPossible: boolean;
  connectionTestNote: string;
}

function meta(
  input: Omit<
    ProviderMetadata,
    "providerCategory" | "tradingPermissionPossible" | "withdrawalPermissionPossible" | "category"
  > & { providerCategory: ProviderCategory; category?: ProviderMetadata["category"] },
): ProviderMetadata {
  const providerCategory = input.providerCategory;
  return {
    ...input,
    category:
      input.category ??
      (providerCategory === "EXCHANGE"
        ? "exchange"
        : providerCategory === "OTHER"
          ? "security"
          : "market_data"),
    tradingPermissionPossible: tradingPermissionPossible(providerCategory),
    withdrawalPermissionPossible: withdrawalPermissionPossible(providerCategory),
  };
}

export const PROVIDER_METADATA: Record<ProviderTypeId, ProviderMetadata> = {
  KRAKEN: meta({
    id: "KRAKEN",
    label: "Kraken",
    providerCategory: "EXCHANGE",
    requiresSecret: true,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: true,
    legalNote: "Verify jurisdiction and product access. Read-only keys only.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
    connectionTestNote: "Verifies public endpoints and private read-only balance access.",
  }),
  COINBASE_ADVANCED: meta({
    id: "COINBASE_ADVANCED",
    label: "Coinbase Advanced Trade",
    providerCategory: "EXCHANGE",
    requiresSecret: true,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: true,
    legalNote: "US-supported. Verify API key permissions.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
    connectionTestNote: "Public endpoint test; private read-only verification NOT_IMPLEMENTED.",
  }),
  BINANCE: meta({
    id: "BINANCE",
    label: "Binance",
    providerCategory: "EXCHANGE",
    requiresSecret: true,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: false,
    legalNote: "Blocked for US persons by default. Enable only if legally supported in your jurisdiction.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
    connectionTestNote: "Public endpoint test; private read-only verification NOT_IMPLEMENTED.",
  }),
  BINANCE_US: meta({
    id: "BINANCE_US",
    label: "Binance.US",
    providerCategory: "EXCHANGE",
    requiresSecret: true,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: true,
    legalNote: "US-only exchange. Verify state restrictions.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
    connectionTestNote: "Public endpoint test; private read-only verification NOT_IMPLEMENTED.",
  }),
  BYBIT: meta({
    id: "BYBIT",
    label: "Bybit",
    providerCategory: "EXCHANGE",
    requiresSecret: true,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: false,
    legalNote: "Restricted in multiple jurisdictions including US. Enable only if legally supported.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
    connectionTestNote: "Public endpoint test; private read-only verification NOT_IMPLEMENTED.",
  }),
  COINGECKO: meta({
    id: "COINGECKO",
    label: "CoinGecko",
    providerCategory: "MARKET_DATA",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: "Market data provider — no trading or withdrawal permissions exist.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests /ping and market data endpoints. Optional API key for higher rate limits.",
  }),
  DEX_SCREENER: meta({
    id: "DEX_SCREENER",
    label: "DexScreener",
    providerCategory: "DEX_DATA",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: "Usually no key required. Used for DEX liquidity, volume, and momentum data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests public token/pair search endpoint.",
  }),
  GECKOTERMINAL: meta({
    id: "GECKOTERMINAL",
    label: "GeckoTerminal",
    providerCategory: "DEX_DATA",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: "On-chain pool and DEX market data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests public networks endpoint.",
  }),
  DEFILLAMA: meta({
    id: "DEFILLAMA",
    label: "DeFiLlama",
    providerCategory: "DEFI_DATA",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: "Usually no key required. Used for TVL, protocol, and chain activity data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests public chains/protocols endpoints.",
  }),
  LUNARCRUSH: meta({
    id: "LUNARCRUSH",
    label: "LunarCrush",
    providerCategory: "SOCIAL_SENTIMENT",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: true,
    legallySupportedDefault: true,
    legalNote: "API key may be required. Used for social hype, sentiment, and trending data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests authenticated social data endpoint when key is configured.",
  }),
  GOPLUS: meta({
    id: "GOPLUS",
    label: "GoPlus Security",
    providerCategory: "OTHER",
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: "Token security checks — no exchange permissions.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: false,
    supportsTrade: false,
    connectionTestNote: "Tests public token security endpoint.",
  }),
};

export interface DetectedPermissions {
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  detected: boolean;
  reasonCode: string;
  detail?: string;
}

export interface ProviderCredentialPublic {
  id: string;
  provider: ProviderTypeId;
  label: string;
  providerCategory: ProviderCategory;
  providerCategoryLabel: string;
  status: string;
  encryptionMethod: string;
  ipWhitelistRecommended: boolean;
  ipWhitelistConfigured: boolean;
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  permissionDetected: boolean;
  permissionReasonCode: string | null;
  tradingPermissionPossible: boolean;
  withdrawalPermissionPossible: boolean;
  dataAccessVerified: boolean;
  permissionSelfAttestation: {
    noWithdrawalPermission: boolean;
    noTradingPermission: boolean;
    readOnlyConfirmed: boolean;
    ipWhitelistConfirmed: boolean;
    confirmedAt: string;
  } | null;
  lastReadOnlyVerifiedAt: string | null;
  lastConnectionTestAt: string | null;
  lastConnectionStatus: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
  lastLatencyMs: number | null;
  keyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  status: string;
  reasonCode: string;
  message: string;
  planTier?: string | null;
  rateLimitStatus?: string | null;
  endpointTested?: string;
  keyUsed?: boolean;
  publicFallbackUsed?: boolean;
}

/** Providers that use public endpoints only — no vault credential should be saved. */
export function isPublicEndpointsOnlyProvider(id: ProviderTypeId): boolean {
  return id === "DEFILLAMA" || id === "DEX_SCREENER";
}

export interface ProviderHealthResult {
  provider: ProviderTypeId;
  credentialId: string | null;
  status: "ok" | "degraded" | "error" | "disabled" | "NOT_IMPLEMENTED";
  latencyMs: number | null;
  reasonCode: string;
  message: string;
  checkedAt: string;
}

export function providerMetaForType(provider: ProviderType): ProviderMetadata {
  const metaEntry = PROVIDER_METADATA[provider as ProviderTypeId];
  if (metaEntry) return metaEntry;
  const category = getProviderCategory(provider);
  return meta({
    id: provider as ProviderTypeId,
    label: provider,
    providerCategory: category,
    requiresSecret: false,
    requiresPassphrase: false,
    requiresApiKey: false,
    legallySupportedDefault: true,
    legalNote: categoryLabel(category),
    ipWhitelistRecommended: isExchangeCategory(category),
    readOnlyRecommended: isExchangeCategory(category),
    supportsTrade: isExchangeCategory(category),
    connectionTestNote: "Provider connection test.",
  });
}
