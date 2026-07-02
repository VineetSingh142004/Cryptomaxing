export const REPORTS_ENGINE_STATUS = "ACTIVE" as const;

export { attributeProfit } from "@/lib/trading/reports/profit-attribution";
export { buildProfitabilityReport } from "@/lib/trading/reports/profitability-report";
export type { ProfitAttributionResult } from "@/lib/trading/live/types";
export type { ProfitabilityReport, ProfitabilityReportInput } from "@/lib/trading/reports/types";
