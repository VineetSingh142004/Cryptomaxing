import type { ProviderType } from "@prisma/client";

export const PROVIDER_CATEGORIES = [
  "EXCHANGE",
  "MARKET_DATA",
  "DEX_DATA",
  "DEFI_DATA",
  "SOCIAL_SENTIMENT",
  "NEWS_DATA",
  "OTHER",
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export function isExchangeCategory(category: ProviderCategory): boolean {
  return category === "EXCHANGE";
}

export function tradingPermissionPossible(category: ProviderCategory): boolean {
  return category === "EXCHANGE";
}

export function withdrawalPermissionPossible(category: ProviderCategory): boolean {
  return category === "EXCHANGE";
}

export function requiresReadOnlyAttestation(category: ProviderCategory): boolean {
  return category === "EXCHANGE";
}

export function categoryLabel(category: ProviderCategory): string {
  switch (category) {
    case "EXCHANGE":
      return "Exchange";
    case "MARKET_DATA":
      return "Market data";
    case "DEX_DATA":
      return "DEX data";
    case "DEFI_DATA":
      return "DeFi data";
    case "SOCIAL_SENTIMENT":
      return "Social / sentiment";
    case "NEWS_DATA":
      return "News data";
    case "OTHER":
      return "Other";
  }
}

/** Maps each ProviderType to its safety category. */
export const PROVIDER_CATEGORY_BY_TYPE: Record<ProviderType, ProviderCategory> = {
  KRAKEN: "EXCHANGE",
  COINBASE_ADVANCED: "EXCHANGE",
  BINANCE: "EXCHANGE",
  BINANCE_US: "EXCHANGE",
  BYBIT: "EXCHANGE",
  COINGECKO: "MARKET_DATA",
  DEX_SCREENER: "DEX_DATA",
  GECKOTERMINAL: "DEX_DATA",
  DEFILLAMA: "DEFI_DATA",
  LUNARCRUSH: "SOCIAL_SENTIMENT",
  GOPLUS: "OTHER",
};

export function getProviderCategory(provider: ProviderType): ProviderCategory {
  return PROVIDER_CATEGORY_BY_TYPE[provider] ?? "OTHER";
}
