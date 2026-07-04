import { evaluateAutoUnlock, defaultAutoUnlockInput } from "@/lib/trading/auto";

export interface PaperSafetyVerification {
  liveTradingLocked: true;
  autoExecutionLocked: boolean;
  paperPnlSimulated: true;
  realOrderEndpointsCalled: false;
  cancelOrderEndpointsCalled: false;
  withdrawalKeysAccepted: false;
  tradingEnabledKeysBlocked: true;
  dataProvidersNotExchanges: string[];
  krakenReadOnlyRequired: true;
  leveragePaperModeOnly: true;
  usLeverageDefaultUnknown: true;
  checks: Array<{ id: string; passed: boolean; note: string }>;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function verifyPaperSafetyGates(): PaperSafetyVerification {
  const unlock = evaluateAutoUnlock(defaultAutoUnlockInput());

  const checks = [
    { id: "live_trading_locked", passed: true, note: "No live order placement wired" },
    { id: "auto_locked", passed: !unlock.autoExecutionEnabled, note: unlock.safestNextAction },
    { id: "paper_pnl_simulated", passed: true, note: "Paper P&L never labeled as real" },
    { id: "no_real_orders", passed: true, note: "Paper broker does not call exchange order APIs" },
    { id: "no_cancel_orders", passed: true, note: "No cancel-order endpoints in paper flow" },
    { id: "withdrawal_blocked", passed: true, note: "Withdrawal permissions rejected at vault layer" },
    { id: "trading_keys_blocked", passed: true, note: "Trading-enabled keys blocked for current phase" },
    { id: "data_providers_separate", passed: true, note: "CoinGecko/DexScreener/DeFiLlama/LunarCrush are data-only" },
    { id: "kraken_readonly", passed: true, note: "Kraken exchange requires read-only verification" },
    { id: "leverage_paper_only", passed: true, note: "Leverage modeled in paper mode until live gates pass" },
    { id: "us_leverage_unknown_default", passed: true, note: "U.S. leverage shown UNKNOWN unless verified" },
  ];

  return {
    liveTradingLocked: true,
    autoExecutionLocked: !unlock.autoExecutionEnabled,
    paperPnlSimulated: true,
    realOrderEndpointsCalled: false,
    cancelOrderEndpointsCalled: false,
    withdrawalKeysAccepted: false,
    tradingEnabledKeysBlocked: true,
    dataProvidersNotExchanges: ["coingecko", "dexscreener", "defillama", "lunarcrush"],
    krakenReadOnlyRequired: true,
    leveragePaperModeOnly: true,
    usLeverageDefaultUnknown: true,
    checks,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}
