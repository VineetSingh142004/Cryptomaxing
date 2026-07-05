import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";

export type CandidateRecommendationLabel =
  | "TRADE_READY"
  | "QUALIFIED_BUT_NOT_OPENED"
  | "PAPER_TRADE_OPENED"
  | "WATCH"
  | "AVOID"
  | "SPOT_ONLY"
  | "LEVERAGE_ELIGIBLE_UNVERIFIED"
  | "REJECTED"
  | "TRADE_READY_BUT_NOT_OPENED";

export type ExecutionLabel =
  | "PAPER_TRADE_OPENED"
  | "PAPER_TRADE_UPDATED"
  | "PAPER_TRADE_CLOSED"
  | "PAPER_TRADE_SKIPPED_MAX_OPEN"
  | "PAPER_TRADE_SKIPPED_NO_SLOT"
  | "PAPER_TRADE_SKIPPED_RISK";

export function mapCandidateRunDisplayLabel(input: {
  action?: string;
  actionType?: string;
  reasonCode?: string;
  openedThisRun?: boolean;
  tradesOpenedThisRun?: number;
}): string {
  if (input.openedThisRun) return "PAPER_TRADE_OPENED";
  const code = (input.reasonCode ?? "").toUpperCase();
  if (code === "REJECTED_BAD_RISK_REWARD" || code === "RISK_REWARD_TOO_WEAK") {
    return "REJECTED_BAD_RISK_REWARD";
  }
  if (code === "WATCH_ONLY_FAKE_PUMP_RISK" || code === "REJECTED_FAKE_PUMP_RISK") {
    return "WATCH_ONLY_FAKE_PUMP_RISK";
  }
  if (code === "SCORE_TOO_LOW") return "SCORE_TOO_LOW";
  const action = (input.action ?? input.actionType ?? "").toUpperCase();
  if (
    (action === "OPEN_PAPER_TRADE" ||
      action === "OPEN_TRADE" ||
      code === "TRADE_READY") &&
    (input.tradesOpenedThisRun ?? 0) === 0
  ) {
    return "QUALIFIED_BUT_NOT_OPENED";
  }
  if (action === "OPEN_PAPER_TRADE" || action === "OPEN_TRADE" || code === "TRADE_READY") {
    return "TRADE_READY";
  }
  return code || action || "UNKNOWN";
}

export function mapCandidateRecommendationLabel(input: {
  action?: string;
  actionType?: string;
  reasonCode?: string;
  tradableOnConfiguredExchange?: boolean;
  tradeReadyButNotOpened?: boolean;
}): CandidateRecommendationLabel {
  if (input.tradeReadyButNotOpened) return "TRADE_READY_BUT_NOT_OPENED";

  const code = (input.reasonCode ?? "").toUpperCase();
  const action = (input.action ?? "").toUpperCase();

  if (code === "NOT_TRADABLE_ON_EXCHANGE" || code === "AVOID" || action === "REJECTED") {
    return "REJECTED";
  }
  if (code === "EXCHANGE_AVAILABILITY_UNKNOWN" || action === "WATCHLIST_ONLY") {
    return "WATCH";
  }
  if (code === "LEVERAGE_ELIGIBLE_UNVERIFIED" || code.includes("LEVERAGE") && code.includes("UNVERIFIED")) {
    return "LEVERAGE_ELIGIBLE_UNVERIFIED";
  }
  if (
    action === "OPEN_TRADE" ||
    action === "OPEN_PAPER_TRADE" ||
    code === "TRADE_READY" ||
    code === "TRADE_OPENED"
  ) {
    if (input.tradableOnConfiguredExchange === false) return "WATCH";
    return "TRADE_READY";
  }
  if (action === "WATCHLIST_ONLY" || code === "WATCHLIST_ONLY" || code === "WATCH") {
    return "WATCH";
  }
  if (
    input.tradableOnConfiguredExchange &&
    (code === "SPOT_ONLY" || action.includes("SPOT"))
  ) {
    return "SPOT_ONLY";
  }
  if (
    action === "REJECTED" ||
    action === "SKIPPED" ||
    code === "SCORE_TOO_LOW" ||
    code === "SPREAD_TOO_WIDE" ||
    code === "VOLUME_TOO_LOW" ||
    code === "PUMP_RISK_TOO_HIGH"
  ) {
    return "REJECTED";
  }
  if (code.includes("WATCH") || code === "LOW_MOMENTUM") return "WATCH";
  return "REJECTED";
}

export function mapExecutionLabel(input: {
  action: string;
  reasonCode?: string;
  tradeActuallyOpened?: boolean;
}): ExecutionLabel | null {
  const action = input.action.toUpperCase();
  const code = (input.reasonCode ?? "").toUpperCase();

  if (action === "TRADE_OPENED" || action === "PAPER_TRADE_OPENED") {
    return input.tradeActuallyOpened ? "PAPER_TRADE_OPENED" : null;
  }
  if (action === "TRADE_UPDATED" || action === "TRADE_UPDATED_MAX_OPEN_REACHED") {
    return "PAPER_TRADE_UPDATED";
  }
  if (action === "TRADE_CLOSED" || action === "PAPER_ROTATION_EXIT") {
    return "PAPER_TRADE_CLOSED";
  }
  if (action === "MISSED_OPPORTUNITY" || code === "MAX_OPEN_TRADES_REACHED") {
    return "PAPER_TRADE_SKIPPED_MAX_OPEN";
  }
  if (code === "DYNAMIC_CAPACITY_FULL" || code === "MAX_TOTAL_EXPOSURE_REACHED") {
    return "PAPER_TRADE_SKIPPED_NO_SLOT";
  }
  if (
    code === "CORRELATED_EXPOSURE_LIMIT" ||
    code.includes("RISK") ||
    action === "NO_TRADE"
  ) {
    return "PAPER_TRADE_SKIPPED_RISK";
  }
  return null;
}

export function mapPaperRunActionToExecution(action: string, tradeActuallyOpened = false): string {
  if (action === "TRADE_OPENED") {
    return tradeActuallyOpened ? "PAPER_TRADE_OPENED" : action;
  }
  if (action === "TRADE_UPDATED" || action === "TRADE_UPDATED_MAX_OPEN_REACHED") {
    return "PAPER_TRADE_UPDATED";
  }
  if (action === "TRADE_CLOSED" || action === "PAPER_ROTATION_EXIT") {
    return "PAPER_TRADE_CLOSED";
  }
  return action;
}

/** Aggregate legacy and current rejection reason codes for dashboard/export display. */
export function summarizeRejectionCategories(
  summary: Record<string, number> | null | undefined,
): Record<string, number> {
  const s = summary ?? {};
  return {
    SCORE_TOO_LOW: s.SCORE_TOO_LOW ?? 0,
    VOLUME_TOO_LOW: s.VOLUME_TOO_LOW ?? 0,
    SPREAD_TOO_WIDE: s.SPREAD_TOO_WIDE ?? 0,
    NOT_TRADABLE_ON_EXCHANGE: s.NOT_TRADABLE_ON_EXCHANGE ?? 0,
    BAD_RISK_REWARD:
      (s.BAD_RISK_REWARD ?? 0) +
      (s.REJECTED_BAD_RISK_REWARD ?? 0) +
      (s.RISK_REWARD_TOO_WEAK ?? 0),
    FAKE_PUMP:
      (s.FAKE_PUMP ?? 0) +
      (s.WATCH_ONLY_FAKE_PUMP_RISK ?? 0) +
      (s.REJECTED_FAKE_PUMP_RISK ?? 0),
  };
}

export function enrichCandidateLabels(
  c: ScanCandidate,
  tradeReadyNotOpened = false,
): ScanCandidate & {
  recommendationLabel: CandidateRecommendationLabel;
} {
  return {
    ...c,
    recommendationLabel: mapCandidateRecommendationLabel({
      action: c.action,
      actionType: c.actionType,
      reasonCode: c.reasonCode,
      tradableOnConfiguredExchange: c.tradableOnConfiguredExchange,
      tradeReadyButNotOpened: tradeReadyNotOpened,
    }),
  };
}
