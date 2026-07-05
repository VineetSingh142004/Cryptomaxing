import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";

export interface OpenExposureMetrics {
  capitalExposureUsd: number;
  capitalExposurePct: number;
  riskAtStopUsd: number;
  riskAtStopPct: number;
  dailyRiskUsedUsd: number;
  dailyRiskUsedPct: number;
  maxAllowedRiskAtStopPct: number;
  maxAllowedDailyRiskPct: number;
  /** Capital notional can exceed 100% when leverage is used — not capped by risk-at-stop limit. */
  capitalCanExceed100Pct: true;
  auditNote: string;
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

export function computeOpenExposureMetrics(input: {
  openTrades: Array<{
    entryPrice: { toNumber?: () => number } | number | null;
    simulatedSize: { toNumber?: () => number } | number | null;
    riskAmount: { toNumber?: () => number } | number | null;
  }>;
  accountUsd: number;
  riskUsedTodayUsd: number;
  dailyBudgetUsd: number;
}): OpenExposureMetrics {
  let capitalExposureUsd = 0;
  let riskAtStopUsd = 0;
  for (const trade of input.openTrades) {
    const entry = toNumber(trade.entryPrice);
    const size = toNumber(trade.simulatedSize);
    if (entry > 0 && size > 0) capitalExposureUsd += entry * size;
    riskAtStopUsd += toNumber(trade.riskAmount);
  }

  const account = input.accountUsd;
  const capitalExposurePct = account > 0 ? (capitalExposureUsd / account) * 100 : 0;
  const riskAtStopPct = account > 0 ? (riskAtStopUsd / account) * 100 : 0;
  const dailyRiskUsedPct =
    input.dailyBudgetUsd > 0 ? (input.riskUsedTodayUsd / input.dailyBudgetUsd) * 100 : 0;

  const parts: string[] = [
    `Capital exposure (${capitalExposurePct.toFixed(2)}%) is total open notional vs account — can exceed 100% with leverage.`,
    `Risk-at-stop (${riskAtStopPct.toFixed(2)}%) is max loss if all stops hit — enforced against ${PAPER_RISK_CONFIG.maxTotalExposurePercent}% limit.`,
    `Daily risk used (${dailyRiskUsedPct.toFixed(2)}%) is realized losses today vs ${PAPER_RISK_CONFIG.maxDailyLossPercent}% daily budget.`,
  ];
  if (capitalExposurePct > PAPER_RISK_CONFIG.maxTotalExposurePercent * 2 && riskAtStopPct <= PAPER_RISK_CONFIG.maxTotalExposurePercent) {
    parts.push(
      "High capital exposure with moderate risk-at-stop is expected when position size is set from stop distance, not full notional.",
    );
  }

  return {
    capitalExposureUsd,
    capitalExposurePct,
    riskAtStopUsd,
    riskAtStopPct,
    dailyRiskUsedUsd: input.riskUsedTodayUsd,
    dailyRiskUsedPct,
    maxAllowedRiskAtStopPct: PAPER_RISK_CONFIG.maxTotalExposurePercent,
    maxAllowedDailyRiskPct: PAPER_RISK_CONFIG.maxDailyLossPercent,
    capitalCanExceed100Pct: true,
    auditNote: parts.join(" "),
  };
}
