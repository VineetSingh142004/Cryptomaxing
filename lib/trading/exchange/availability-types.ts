export type AvailabilityTriState = "YES" | "NO" | "UNKNOWN";

export type RecommendedAvailabilityAction =
  | "WATCH"
  | "SPOT_ONLY"
  | "LEVERAGE_POSSIBLE"
  | "AVOID"
  | "UNKNOWN";

export type BestExchangeLabel = "kraken" | "watch_only" | "unknown" | "unsupported";

export interface ExchangeAvailabilityResult {
  listedOnKraken: AvailabilityTriState;
  krakenSpotAvailable: AvailabilityTriState;
  krakenMarginAvailable: AvailabilityTriState;
  krakenFuturesAvailable: AvailabilityTriState;
  usLeverageAvailable: AvailabilityTriState;
  availablePairs: string[];
  bestExchange: BestExchangeLabel;
  recommendedAction: RecommendedAvailabilityAction;
  evidenceSource: string;
  checkedAt: string;
  confidence: "high" | "medium" | "low";
  availabilityNote: string | null;
}

export function triStateLabel(v: AvailabilityTriState): string {
  return v;
}

export function isConfirmedTradable(result: ExchangeAvailabilityResult): boolean {
  return result.krakenSpotAvailable === "YES";
}

export function isUnconfirmedTradable(result: ExchangeAvailabilityResult): boolean {
  return result.krakenSpotAvailable === "UNKNOWN" || result.listedOnKraken === "UNKNOWN";
}

export function isNotTradable(result: ExchangeAvailabilityResult): boolean {
  return result.krakenSpotAvailable === "NO" && result.listedOnKraken === "NO";
}
