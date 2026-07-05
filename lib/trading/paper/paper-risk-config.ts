function envInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (!v) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export type PaperRiskMode = "conservative" | "balanced" | "aggressive";
export type PaperDailyBudgetMode = "manual" | "ai_recommended";

function envRiskMode(key: string, fallback: PaperRiskMode): PaperRiskMode {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (v === "conservative" || v === "balanced" || v === "aggressive") return v;
  return fallback;
}

function envBudgetMode(key: string, fallback: PaperDailyBudgetMode): PaperDailyBudgetMode {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (v === "manual" || v === "ai_recommended") return v;
  return fallback;
}

export const PAPER_RISK_CONFIG = {
  /** When false, uses fixed PAPER_MAX_OPEN_TRADES only. Default: true (risk-based). */
  dynamicTradeLimit: envBool("PAPER_DYNAMIC_TRADE_LIMIT", true),
  maxTotalExposurePercent: envFloat("PAPER_MAX_TOTAL_EXPOSURE_PERCENT", 5),
  maxDailyLossPercent: envFloat("PAPER_MAX_DAILY_LOSS_PERCENT", 2),
  maxCorrelatedTrades: envInt("PAPER_MAX_CORRELATED_TRADES", 2),
  dailyBudgetMode: envBudgetMode("PAPER_DAILY_BUDGET_MODE", "manual"),
  /** Manual daily trading budget in USD. 0 = use simulated account size. */
  manualDailyBudgetUsd: envFloat("PAPER_MANUAL_DAILY_BUDGET_USD", 0),
  maxCapitalPerTradePercent: envFloat("PAPER_MAX_CAPITAL_PER_TRADE_PERCENT", 2),
  maxLeverageAllowed: envFloat("PAPER_MAX_LEVERAGE_ALLOWED", 3),
  riskMode: envRiskMode("PAPER_RISK_MODE", "balanced"),
  /** Exit losing trades early when unrealized loss exceeds this (bps) and thesis weakens materially. */
  earlyLossCutBps: envFloat("PAPER_EARLY_LOSS_CUT_BPS", 65),
  /** Minimum thesis-invalidation score (0–100) to trigger early exit on a loser. */
  thesisInvalidationThreshold: envFloat("PAPER_THESIS_INVALIDATION_THRESHOLD", 65),
} as const;

export function riskModeMultiplier(mode: PaperRiskMode): number {
  switch (mode) {
    case "conservative":
      return 0.6;
    case "balanced":
      return 1;
    case "aggressive":
      return 1.3;
  }
}

export function serializePaperRiskConfig() {
  return {
    dynamicTradeLimit: PAPER_RISK_CONFIG.dynamicTradeLimit,
    maxTotalExposurePercent: PAPER_RISK_CONFIG.maxTotalExposurePercent,
    maxDailyLossPercent: PAPER_RISK_CONFIG.maxDailyLossPercent,
    maxCorrelatedTrades: PAPER_RISK_CONFIG.maxCorrelatedTrades,
    dailyBudgetMode: PAPER_RISK_CONFIG.dailyBudgetMode,
    manualDailyBudgetUsd: PAPER_RISK_CONFIG.manualDailyBudgetUsd,
    maxCapitalPerTradePercent: PAPER_RISK_CONFIG.maxCapitalPerTradePercent,
    maxLeverageAllowed: PAPER_RISK_CONFIG.maxLeverageAllowed,
    riskMode: PAPER_RISK_CONFIG.riskMode,
    simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
  };
}
