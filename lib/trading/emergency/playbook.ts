export const EMERGENCY_FAILURE_TYPES = [
  "API_OUTAGE",
  "ORDER_PLACEMENT_FAILURE",
  "CANCEL_FAILURE",
  "DELAYED_ORDER_STATUS",
  "STALE_BALANCE",
  "STALE_POSITION",
  "WEBSOCKET_DISCONNECT",
  "REST_FALLBACK_FAILURE",
  "PRICE_FEED_DISAGREEMENT",
  "STOP_FAILURE",
  "DUPLICATE_ORDER_RISK",
  "STUCK_ORDER",
  "PARTIAL_FILL_UNCERTAINTY",
  "RECONCILIATION_MISMATCH",
] as const;

export type EmergencyFailureType = (typeof EMERGENCY_FAILURE_TYPES)[number];

export interface ExchangeHealthInput {
  failures: EmergencyFailureType[];
  hasOpenPosition: boolean;
  stopStatusKnown: boolean;
  cancelConfirmed: boolean;
  positionCertain: boolean;
  duplicateOrderRisk: boolean;
  allProvidersFailed: boolean;
  emergencyExitFailed: boolean;
  reconciliationMismatch: boolean;
}

export interface EmergencyPlaybookResult {
  freezeEntries: boolean;
  blockNewTrades: boolean;
  prioritizeRiskReduction: boolean;
  alertStopUnknown: boolean;
  treatOrderAsLive: boolean;
  reconcileBeforeNewOrders: boolean;
  blockExecution: boolean;
  manualInstructions: string[];
  reasonCodes: string[];
  evaluatedAt: string;
}

export function evaluateEmergencyPlaybook(input: ExchangeHealthInput): EmergencyPlaybookResult {
  const reasonCodes: string[] = [];
  const manualInstructions: string[] = [];

  const freezeEntries = input.allProvidersFailed || input.failures.includes("API_OUTAGE");
  let blockNewTrades = freezeEntries || input.reconciliationMismatch;
  let prioritizeRiskReduction = false;
  let alertStopUnknown = !input.stopStatusKnown;
  let treatOrderAsLive = !input.cancelConfirmed;
  let reconcileBeforeNewOrders = !input.positionCertain || input.reconciliationMismatch;
  let blockExecution = input.duplicateOrderRisk || input.failures.includes("DUPLICATE_ORDER_RISK");

  if (!input.hasOpenPosition && input.failures.length > 0) {
    blockNewTrades = true;
    reasonCodes.push("NO_POSITION_EXCHANGE_FAILURE_BLOCK");
  }

  if (input.hasOpenPosition && input.failures.length > 0) {
    prioritizeRiskReduction = true;
    reasonCodes.push("OPEN_POSITION_PRIORITIZE_RISK_REDUCTION");
    manualInstructions.push("Reduce exposure before new entries");
  }

  if (input.failures.includes("STOP_FAILURE") || !input.stopStatusKnown) {
    alertStopUnknown = true;
    manualInstructions.push("Verify stop status manually immediately");
  }

  if (!input.cancelConfirmed) {
    treatOrderAsLive = true;
    reasonCodes.push("UNCONFIRMED_CANCEL_TREAT_AS_LIVE");
  }

  if (!input.positionCertain) {
    reconcileBeforeNewOrders = true;
    reasonCodes.push("UNCERTAIN_POSITION_RECONCILE_FIRST");
  }

  if (input.duplicateOrderRisk) {
    blockExecution = true;
    reasonCodes.push("DUPLICATE_RISK_BLOCK");
  }

  if (input.emergencyExitFailed) {
    manualInstructions.push("Emergency exit failed — manual flatten required");
    reasonCodes.push("EMERGENCY_EXIT_FAILED");
  }

  if (input.failures.includes("PRICE_FEED_DISAGREEMENT")) {
    blockNewTrades = true;
    reasonCodes.push("PRICE_DISAGREEMENT");
  }

  manualInstructions.push("Never assume safety when exchange state is unknown");

  return {
    freezeEntries,
    blockNewTrades,
    prioritizeRiskReduction,
    alertStopUnknown,
    treatOrderAsLive,
    reconcileBeforeNewOrders,
    blockExecution,
    manualInstructions,
    reasonCodes,
    evaluatedAt: new Date().toISOString(),
  };
}

export const EMERGENCY_ENGINE_STATUS = "ACTIVE" as const;
