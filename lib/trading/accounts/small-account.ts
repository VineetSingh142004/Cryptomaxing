import type { TradePermissionOutcome } from "@/lib/trading/permission/types";

export interface SmallAccountInput {
  accountEquityUsd: number;
  spreadBps: number;
  feeBps: number;
  minOrderSizeUsd: number;
  intendedTradesPerDay?: number;
  usesLeverage?: boolean;
  isDex?: boolean;
  gasCostUsd?: number;
  isGrid?: boolean;
  isDca?: boolean;
  isScalping?: boolean;
}

export interface SmallAccountResult {
  paperModeDefault: boolean;
  leverageAllowed: boolean;
  maxTradesPerDay: number;
  blockReason: TradePermissionOutcome | null;
  reasonCodes: string[];
  evaluatedAt: string;
}

export function evaluateSmallAccountMode(input: SmallAccountInput): SmallAccountResult {
  const reasonCodes: string[] = [];
  let blockReason: TradePermissionOutcome | null = null;

  const small = input.accountEquityUsd >= 1 && input.accountEquityUsd <= 25;

  if (!small) {
    return {
      paperModeDefault: false,
      leverageAllowed: true,
      maxTradesPerDay: 20,
      blockReason: null,
      reasonCodes: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  reasonCodes.push("SMALL_ACCOUNT_MODE");

  if (input.usesLeverage) {
    blockReason = "LEVERAGE_TOO_DANGEROUS";
    reasonCodes.push("NO_LEVERAGE_SMALL_ACCOUNT");
  }

  if (input.isScalping && input.feeBps > 5) {
    blockReason = "FEES_TOO_HIGH";
    reasonCodes.push("NO_SCALPING_FEES_TOO_HIGH");
  }

  if (input.isDex && (input.gasCostUsd ?? 0) > input.accountEquityUsd * 0.1) {
    blockReason = "FEES_TOO_HIGH";
    reasonCodes.push("GAS_DOMINATES");
  }

  if (input.isGrid && input.spreadBps + input.feeBps > 20) {
    blockReason = "FEES_TOO_HIGH";
    reasonCodes.push("GRID_SPREAD_FEES_KILL_EDGE");
  }

  if (input.isDca && input.minOrderSizeUsd > input.accountEquityUsd * 0.2) {
    blockReason = "ACCOUNT_TOO_SMALL";
    reasonCodes.push("DCA_MIN_ORDER_BREAKS_SIZING");
  }

  if (input.minOrderSizeUsd > input.accountEquityUsd * 0.5) {
    blockReason = "ACCOUNT_TOO_SMALL";
  }

  return {
    paperModeDefault: true,
    leverageAllowed: false,
    maxTradesPerDay: 2,
    blockReason,
    reasonCodes,
    evaluatedAt: new Date().toISOString(),
  };
}
