import type { ProviderType } from "@prisma/client";

export const PROVIDER_TYPES = [
  "KRAKEN",
  "COINBASE_ADVANCED",
  "BINANCE",
  "BINANCE_US",
  "BYBIT",
  "COINGECKO",
  "DEX_SCREENER",
  "GECKOTERMINAL",
  "GOPLUS",
] as const satisfies readonly ProviderType[];

export type ProviderTypeId = (typeof PROVIDER_TYPES)[number];

export interface ProviderMetadata {
  id: ProviderTypeId;
  label: string;
  category: "exchange" | "market_data" | "security";
  requiresSecret: boolean;
  requiresPassphrase: boolean;
  legallySupportedDefault: boolean;
  legalNote: string;
  ipWhitelistRecommended: boolean;
  readOnlyRecommended: boolean;
  supportsTrade: boolean;
}

export const PROVIDER_METADATA: Record<ProviderTypeId, ProviderMetadata> = {
  KRAKEN: {
    id: "KRAKEN",
    label: "Kraken",
    category: "exchange",
    requiresSecret: true,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "Verify jurisdiction and product access.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
  },
  COINBASE_ADVANCED: {
    id: "COINBASE_ADVANCED",
    label: "Coinbase Advanced Trade",
    category: "exchange",
    requiresSecret: true,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "US-supported. Verify API key permissions.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
  },
  BINANCE: {
    id: "BINANCE",
    label: "Binance",
    category: "exchange",
    requiresSecret: true,
    requiresPassphrase: false,
    legallySupportedDefault: false,
    legalNote: "Blocked for US persons by default. Enable only if legally supported in your jurisdiction.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
  },
  BINANCE_US: {
    id: "BINANCE_US",
    label: "Binance.US",
    category: "exchange",
    requiresSecret: true,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "US-only exchange. Verify state restrictions.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
  },
  BYBIT: {
    id: "BYBIT",
    label: "Bybit",
    category: "exchange",
    requiresSecret: true,
    requiresPassphrase: false,
    legallySupportedDefault: false,
    legalNote: "Restricted in multiple jurisdictions including US. Enable only if legally supported.",
    ipWhitelistRecommended: true,
    readOnlyRecommended: true,
    supportsTrade: true,
  },
  COINGECKO: {
    id: "COINGECKO",
    label: "CoinGecko",
    category: "market_data",
    requiresSecret: false,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "Market data provider.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: true,
    supportsTrade: false,
  },
  DEX_SCREENER: {
    id: "DEX_SCREENER",
    label: "DEX Screener",
    category: "market_data",
    requiresSecret: false,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "DEX market data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: true,
    supportsTrade: false,
  },
  GECKOTERMINAL: {
    id: "GECKOTERMINAL",
    label: "GeckoTerminal",
    category: "market_data",
    requiresSecret: false,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "On-chain pool data.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: true,
    supportsTrade: false,
  },
  GOPLUS: {
    id: "GOPLUS",
    label: "GoPlus Security",
    category: "security",
    requiresSecret: false,
    requiresPassphrase: false,
    legallySupportedDefault: true,
    legalNote: "Token security checks.",
    ipWhitelistRecommended: false,
    readOnlyRecommended: true,
    supportsTrade: false,
  },
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
  status: string;
  encryptionMethod: string;
  ipWhitelistRecommended: boolean;
  ipWhitelistConfigured: boolean;
  canRead: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  permissionDetected: boolean;
  permissionReasonCode: string | null;
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
