import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import { PAPER_ROTATION_CONFIG } from "@/lib/trading/paper/paper-rotation-config";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";

export interface TradingRuleGroup {
  title: string;
  rules: string[];
  simulatedOnly: boolean;
}

export interface ActiveTradingRulesPanel {
  groups: TradingRuleGroup[];
  safetyCaps: string[];
  liveTradingLocked: true;
  autoExecutionLocked: true;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function buildActiveTradingRules(): ActiveTradingRulesPanel {
  return {
    groups: [
      {
        title: "Entry rules",
        simulatedOnly: true,
        rules: [
          `Minimum opportunity score: ${PAPER_CONFIG.minOpportunityScore}`,
          `Minimum liquidity score: ${PAPER_CONFIG.minLiquidityScore}`,
          `Minimum 24h volume: $${SCANNER_CONFIG.min24hVolumeUsd.toLocaleString()}`,
          "Must be confirmed tradable on configured exchange for paper OPEN (otherwise watchlist only)",
          "Momentum or 24h change must meet scanner tier thresholds",
        ],
      },
      {
        title: "Exit rules",
        simulatedOnly: true,
        rules: [
          "Exit on thesis invalidation (momentum reversal, volume collapse, liquidity weakening)",
          "Exit on planned stop-loss or take-profit hit",
          "Exit on trade expiry (tier-based hours)",
          "No panic exit on tiny moves — thesis must weaken materially",
        ],
      },
      {
        title: "Stop-loss rules",
        simulatedOnly: true,
        rules: [
          `Base stop: ${PAPER_CONFIG.stopLossBps} bps (tier-adjusted wider for high-vol/extreme)`,
          `Early loss cut only after ${PAPER_RISK_CONFIG.earlyLossCutBps} bps loss AND thesis invalidation score ≥ ${PAPER_RISK_CONFIG.thesisInvalidationThreshold}`,
          "Stop distance scales with volatility tier",
        ],
      },
      {
        title: "Take-profit rules",
        simulatedOnly: true,
        rules: [
          `Base take-profit: ${PAPER_CONFIG.takeProfitBps} bps (tier-adjusted)`,
          "Risk/reward must be ≥ 1.05 before opening",
        ],
      },
      {
        title: "Allocation rules",
        simulatedOnly: true,
        rules: [
          `Max capital per trade: ${PAPER_RISK_CONFIG.maxCapitalPerTradePercent}% of simulated account`,
          `Max total exposure: ${PAPER_RISK_CONFIG.maxTotalExposurePercent}%`,
          `Max daily loss budget: ${PAPER_RISK_CONFIG.maxDailyLossPercent}%`,
          "Stronger score + confidence + liquidity → larger allocation; weak/high-vol → smaller or skip",
          `Risk mode: ${PAPER_RISK_CONFIG.riskMode}`,
        ],
      },
      {
        title: "Leverage rules (paper-only)",
        simulatedOnly: true,
        rules: [
          `Max simulated leverage: ${PAPER_RISK_CONFIG.maxLeverageAllowed}x`,
          "U.S. leverage UNKNOWN → no leverage recommendation (LEVERAGE_ELIGIBLE_UNVERIFIED)",
          "Leverage only when margin confirmed YES, confidence ≥ 75%, liquidity strong",
          "Never applied to live orders",
        ],
      },
      {
        title: "Fake-pump filters",
        simulatedOnly: true,
        rules: [
          "Pump risk penalty for extreme 24h move + low volume or wide spread",
          "EXTREME_RISK tier paper-only with reduced allocation",
          "Wrapped/stablecoin exclusions when configured",
        ],
      },
      {
        title: "No-trade conditions",
        simulatedOnly: true,
        rules: [
          "Spread too wide for tier",
          "Volume below minimum",
          "Data stale or OHLC missing",
          "Not tradable on exchange (watchlist only)",
          "Max total exposure or daily loss limit reached",
          "Correlated exposure limit reached",
          PAPER_ROTATION_CONFIG.enabled
            ? "Rotation may free slot — still paper-only"
            : "Rotation disabled — quality selection only",
        ],
      },
    ],
    safetyCaps: [
      `Safety cap: ${SCANNER_CONFIG.maxOpenTrades} open trades (dynamic risk-based limit may apply)`,
      `Max ${SCANNER_CONFIG.maxNewTradesPerRun} new trades per run`,
      "Live trading: LOCKED",
      "Auto execution: LOCKED",
    ],
    liveTradingLocked: true,
    autoExecutionLocked: true,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
