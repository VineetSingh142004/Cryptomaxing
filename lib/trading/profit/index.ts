export const PROFIT_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/profit/profit-plan";
export { routeProfitOpportunity, isSpreadWide } from "@/lib/trading/profit/router";
export type { ProfitRouterInput, ProfitRouterResult, ProfitMaximizationBreakdown } from "@/lib/trading/profit/router";
export { analyzeOpportunity, OPPORTUNITY_ENGINE_STATUS } from "@/lib/trading/profit/analyze-opportunity";
export type { AnalyzeOpportunityInput, FullOpportunityAnalysis } from "@/lib/trading/profit/analyze-opportunity";
