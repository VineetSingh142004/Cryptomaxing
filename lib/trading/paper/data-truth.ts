export type DataTruthCategory =
  | "REAL_MARKET_DATA"
  | "SIMULATED_PAPER_TRADE"
  | "SIMULATED_PNL"
  | "UNKNOWN"
  | "UNAVAILABLE";

export interface DataTruthLabel {
  category: DataTruthCategory;
  label: string;
  detail: string;
}

export const DATA_TRUTH = {
  realMarketData: (): DataTruthLabel => ({
    category: "REAL_MARKET_DATA",
    label: "Real market data",
    detail: "Price/volume from configured public or keyed providers — not fabricated.",
  }),
  simulatedPaperTrade: (): DataTruthLabel => ({
    category: "SIMULATED_PAPER_TRADE",
    label: "Simulated paper trade",
    detail: "No real orders placed. Paper-only position.",
  }),
  simulatedPnl: (): DataTruthLabel => ({
    category: "SIMULATED_PNL",
    label: "Simulated P&L",
    detail: "Modeled fees/slippage — not verified live profit or loss.",
  }),
  unknown: (field: string): DataTruthLabel => ({
    category: "UNKNOWN",
    label: "UNKNOWN",
    detail: `${field} was not available for this run.`,
  }),
  unavailable: (field: string, reason?: string): DataTruthLabel => ({
    category: "UNAVAILABLE",
    label: "UNAVAILABLE",
    detail: reason ?? `${field} could not be fetched this run.`,
  }),
} as const;

export function formatDataTruth(value: number | null | undefined, kind: "price" | "pnl"): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return kind === "pnl" ? "UNKNOWN (SIM)" : "UNKNOWN";
  }
  return kind === "pnl" ? `${value.toFixed(4)} (SIMULATED)` : String(value);
}
