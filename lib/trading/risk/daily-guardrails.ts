import type { DailyGuardrailResult, DailyPnLState } from "@/lib/trading/risk/types";

export function evaluateDailyGuardrails(state: DailyPnLState): DailyGuardrailResult {
  const { netDailyPct, consecutiveLosses } = state;
  const reasonCodes: string[] = [];
  const recommendations: string[] = [];
  let riskMultiplier = 1;
  let liveTradingAllowed = true;
  let setupFilter: DailyGuardrailResult["setupFilter"] = "ALL";

  if (netDailyPct >= 6) {
    riskMultiplier = 0;
    liveTradingAllowed = false;
    setupFilter = "NONE";
    reasonCodes.push("DAILY_TARGET_EXCEEDED_STOP");
    recommendations.push("Recommend stopping live trading after +6% net");
  } else if (netDailyPct >= 4) {
    riskMultiplier = 0.5;
    setupFilter = "A_PLUS_ONLY";
    reasonCodes.push("NEAR_DAILY_TARGET_A_PLUS_ONLY");
    recommendations.push("A+ setups only after +4% net");
  } else if (netDailyPct >= 2) {
    riskMultiplier = 0.7;
    reasonCodes.push("PROFIT_REDUCE_RISK");
    recommendations.push("Reduce risk after +2% net");
  }

  if (netDailyPct <= -2) {
    riskMultiplier = 0;
    liveTradingAllowed = false;
    setupFilter = "NONE";
    reasonCodes.push("DAILY_LOSS_PAUSE");
    recommendations.push("Pause live trading at -2% net");
  } else if (netDailyPct <= -1) {
    riskMultiplier = Math.min(riskMultiplier, 0.6);
    reasonCodes.push("DAILY_LOSS_REDUCE_RISK");
    recommendations.push("Reduce risk at -1% net");
  }

  if (consecutiveLosses >= 3) {
    riskMultiplier = 0;
    liveTradingAllowed = false;
    setupFilter = "NONE";
    reasonCodes.push("THREE_LOSSES_PAUSE");
    recommendations.push("Pause after 3 consecutive losses");
  } else if (consecutiveLosses >= 2) {
    riskMultiplier = Math.min(riskMultiplier, 0.6);
    reasonCodes.push("TWO_LOSSES_REDUCE");
    recommendations.push("Reduce risk after 2 losses");
  }

  recommendations.push("Daily target is informational only — never force trades");
  recommendations.push("Being down is not a reason to increase leverage");

  return {
    netDailyPct,
    riskMultiplier,
    liveTradingAllowed,
    setupFilter,
    recommendations,
    reasonCodes,
    evaluatedAt: new Date().toISOString(),
  };
}
