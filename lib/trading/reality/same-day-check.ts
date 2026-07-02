import type { EvidenceLevelNumber } from "@/lib/trading/proof/types";
import type { DecaySeverity } from "@/lib/trading/live/types";

export type SameDayProofStatus =
  | "NOT_ENOUGH_DATA"
  | "BACKTEST_ONLY"
  | "PAPER_ONLY"
  | "SHADOW_LIVE_ONLY"
  | "TINY_LIVE"
  | "RECONCILED_LIVE_EDGE"
  | "NOT_PROVEN"
  | "DECAYING"
  | "DO_NOT_TRADE_LIVE"
  | "TINY_CANARY_ELIGIBLE";

export interface SameDayRealityInput {
  evidenceLevel: EvidenceLevelNumber;
  todayProofAvailable: boolean;
  todayGoNoGoAllows: boolean;
  paperProfitToday: number | null;
  shadowProfitToday: number | null;
  liveNetToday: number | null;
  liveReconciled: boolean;
  liveTradeCount: number;
  edgeDecaySeverity: DecaySeverity;
  liveDriftDetected: boolean;
  strategyDegraded: boolean;
  statisticallyMeaningful: boolean;
}

export interface SameDayRealityCheck {
  status: SameDayProofStatus;
  headline: string;
  evidencePresent: string[];
  evidenceMissing: string[];
  warnings: string[];
  mayTradeLiveToday: boolean;
  mayTinyCanary: boolean;
  paperProfitIsReal: false;
  shadowProfitIsReal: false;
  tinyCanaryIsScalable: false;
  checkedAt: string;
}

export function runSameDayRealityCheck(input: SameDayRealityInput): SameDayRealityCheck {
  const evidencePresent: string[] = [];
  const evidenceMissing: string[] = [];
  const warnings: string[] = [];

  if (input.evidenceLevel >= 2) evidencePresent.push("Backtest evidence");
  else evidenceMissing.push("Backtest evidence");

  if (input.evidenceLevel >= 8) evidencePresent.push("Paper-forward evidence");
  else evidenceMissing.push("Paper-forward evidence");

  if (input.evidenceLevel >= 9) evidencePresent.push("Shadow-live evidence");
  else evidenceMissing.push("Shadow-live evidence");

  if (input.evidenceLevel >= 10) evidencePresent.push("Tiny-live canary evidence");
  else evidenceMissing.push("Tiny-live canary evidence");

  if (input.liveReconciled && input.liveTradeCount >= 20) {
    evidencePresent.push("Reconciled live sample");
  } else {
    evidenceMissing.push("Reconciled live sample (≥20 trades)");
  }

  if (!input.todayProofAvailable) {
    evidenceMissing.push("Today's market proof report");
  } else {
    evidencePresent.push("Today's market proof");
  }

  if (input.paperProfitToday !== null && input.paperProfitToday > 0) {
    warnings.push("Today's paper profit is simulated — not real profit");
  }
  if (input.shadowProfitToday !== null && input.shadowProfitToday > 0) {
    warnings.push("Today's shadow profit is hypothetical — not real profit");
  }

  let status: SameDayProofStatus = "NOT_ENOUGH_DATA";
  let headline = "Not enough data yet.";
  let mayTradeLiveToday = false;
  let mayTinyCanary = false;

  if (input.edgeDecaySeverity === "SEVERE" || input.edgeDecaySeverity === "MODERATE") {
    status = "DECAYING";
    headline = "Strategy is decaying.";
    warnings.push("Forward performance decay detected — do not scale");
  } else if (input.liveDriftDetected) {
    status = "DECAYING";
    headline = "Live drift detected — edge may be decaying.";
  } else if (input.evidenceLevel <= 1) {
    status = "NOT_ENOUGH_DATA";
    headline = "Not enough data yet.";
  } else if (input.evidenceLevel <= 7) {
    status = "BACKTEST_ONLY";
    headline = "Strategy has backtest evidence only.";
    evidenceMissing.push("Forward/paper/shadow/live proof");
  } else if (input.evidenceLevel === 8) {
    status = "PAPER_ONLY";
    headline = "Strategy has paper evidence only.";
    evidenceMissing.push("Shadow-live and live reconciliation");
  } else if (input.evidenceLevel === 9) {
    status = "SHADOW_LIVE_ONLY";
    headline = "Strategy has shadow-live evidence only.";
    evidenceMissing.push("Reconciled tiny-live trades");
  } else if (input.evidenceLevel === 10) {
    status = "TINY_LIVE";
    headline = "Strategy has tiny-live evidence.";
    mayTinyCanary = input.todayGoNoGoAllows && !input.strategyDegraded;
    evidenceMissing.push("Statistically meaningful live sample");
  } else if (input.evidenceLevel >= 11 && input.liveReconciled && input.statisticallyMeaningful) {
    status = "RECONCILED_LIVE_EDGE";
    headline = "Strategy has reconciled live edge.";
    mayTinyCanary = input.todayGoNoGoAllows;
    mayTradeLiveToday = input.todayGoNoGoAllows && input.evidenceLevel >= 12;
  } else {
    status = "NOT_PROVEN";
    headline = "Strategy is not proven.";
  }

  if (!input.todayGoNoGoAllows || input.strategyDegraded) {
    const priorStatus = status;
    const priorHeadline = headline;
    status = "DO_NOT_TRADE_LIVE";
    headline = "Strategy should not trade live today.";
    mayTradeLiveToday = false;
    mayTinyCanary = false;
    if (priorStatus === "NOT_ENOUGH_DATA") {
      warnings.push(`Underlying: ${priorHeadline}`);
    }
  } else if (mayTinyCanary && !mayTradeLiveToday && status !== "DECAYING") {
    status = "TINY_CANARY_ELIGIBLE";
    headline = "Strategy may be eligible for tiny canary only.";
  }

  if (input.liveTradeCount < 5) {
    evidenceMissing.push("Minimum live trade count");
  }

  return {
    status,
    headline,
    evidencePresent,
    evidenceMissing,
    warnings,
    mayTradeLiveToday,
    mayTinyCanary,
    paperProfitIsReal: false,
    shadowProfitIsReal: false,
    tinyCanaryIsScalable: false,
    checkedAt: new Date().toISOString(),
  };
}
