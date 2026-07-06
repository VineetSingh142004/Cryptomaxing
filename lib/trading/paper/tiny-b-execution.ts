import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import type { PaperDecisionResult, PaperTradeDecision } from "@/lib/trading/paper/paper-decision-pipeline";
import { passedHardSafetyFilters } from "@/lib/trading/paper/paper-decision-pipeline";
import type { RecordCautionModeState } from "@/lib/trading/paper/profit-protection";
import { SCANNER_CONFIG, maxSpreadForTier } from "@/lib/trading/paper/scanner-config";

export type TinyBExecutionBlockReason =
  | "TINY_B_OPENED_PAPER_ONLY"
  | "TINY_B_BLOCKED_CAUTION_CRITICAL"
  | "TINY_B_BLOCKED_HARD_SAFETY"
  | "TINY_B_BLOCKED_CAPACITY"
  | "TINY_B_BLOCKED_DUPLICATE_SYMBOL"
  | "TINY_B_BLOCKED_DATA_QUALITY"
  | "TINY_B_BLOCKED_RISK_REWARD"
  | "TINY_B_BLOCKED_LOW_MOMENTUM"
  | "TINY_B_BLOCKED_STRATEGY_LAYER";

export interface TinyBExecutionBlocker {
  symbol: string;
  reasonCode: TinyBExecutionBlockReason;
  reasonText: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface NoTradeDiagnosticRow {
  symbol: string;
  decision: string;
  reason: string;
  closestStrategy: string | null;
  tinyBEligible: boolean;
  blocker: string;
  timestamp: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export interface TinyBExecutionSummary {
  tinyBEligibleCount: number;
  tinyBOpenedCount: number;
  blockers: TinyBExecutionBlocker[];
  noTradeDiagnostics: NoTradeDiagnosticRow[];
  executionNote: string | null;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

export function mapStrategyLayerBlockToTinyBReason(
  reasonCode: string,
  paperDecision: PaperTradeDecision,
): TinyBExecutionBlockReason {
  if (paperDecision !== "TINY_B_SETUP_PAPER_ONLY") {
    return "TINY_B_BLOCKED_STRATEGY_LAYER";
  }
  const code = reasonCode.toUpperCase();
  if (code.includes("RISK") || code.includes("REWARD")) return "TINY_B_BLOCKED_RISK_REWARD";
  if (code.includes("MOMENTUM") || code === "LOW_MOMENTUM") return "TINY_B_BLOCKED_LOW_MOMENTUM";
  if (code.includes("DATA") || code.includes("STALE")) return "TINY_B_BLOCKED_DATA_QUALITY";
  return "TINY_B_BLOCKED_STRATEGY_LAYER";
}

export function resolveTinyBExecutionBlocker(input: {
  candidate: ScanCandidate;
  paperDecision: PaperDecisionResult;
  recordCaution: RecordCautionModeState;
  openSlotsAvailable: boolean;
  maxOpenTradesReached: boolean;
  symbolAlreadyOpen: boolean;
}): TinyBExecutionBlocker | null {
  if (input.paperDecision.decision !== "TINY_B_SETUP_PAPER_ONLY") return null;

  if (input.recordCaution.pauseNewEntries) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_CAUTION_CRITICAL",
      reasonText: `Tiny B eligible but blocked — caution pauseNewEntries active: ${input.recordCaution.dashboardMessage}`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (!passedHardSafetyFilters(input.candidate)) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_HARD_SAFETY",
      reasonText: `Tiny B blocked by hard safety — ${input.candidate.reasonText || input.candidate.reasonCode}`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (
    input.recordCaution.blockHighVolAlts &&
    (input.candidate.riskTier === "HIGH_VOLATILITY" || input.candidate.riskTier === "EXTREME_RISK")
  ) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_CAUTION_CRITICAL",
      reasonText: "Tiny B blocked — high-vol/extreme alt blocked under caution mode",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if ((input.candidate.dataQualityScore ?? 0) < 40) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_DATA_QUALITY",
      reasonText: "Tiny B blocked — data quality below minimum",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (
    input.candidate.reasonCode === "REJECTED_BAD_RISK_REWARD" ||
    input.candidate.reasonCode === "RISK_REWARD_TOO_WEAK"
  ) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_RISK_REWARD",
      reasonText: "Tiny B blocked — reward/risk too weak",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (input.symbolAlreadyOpen) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_DUPLICATE_SYMBOL",
      reasonText: `Tiny B blocked — ${input.candidate.symbol} already has an open paper trade`,
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  if (!input.openSlotsAvailable || input.maxOpenTradesReached) {
    return {
      symbol: input.candidate.symbol,
      reasonCode: "TINY_B_BLOCKED_CAPACITY",
      reasonText: "Tiny B blocked — no open trade capacity",
      simulatedLabel: "SIMULATED_PAPER_ONLY",
    };
  }

  return null;
}

export function buildNoTradeDiagnosticRow(input: {
  candidate: ScanCandidate;
  paperDecision: PaperDecisionResult;
  blocker: string;
  timestamp: string;
}): NoTradeDiagnosticRow {
  return {
    symbol: input.candidate.symbol,
    decision: input.paperDecision.decision,
    reason: input.paperDecision.blockedReason ?? input.candidate.reasonText,
    closestStrategy: input.paperDecision.closestStrategy,
    tinyBEligible: input.paperDecision.decision === "TINY_B_SETUP_PAPER_ONLY",
    blocker: input.blocker,
    timestamp: input.timestamp,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function emptyTinyBExecutionSummary(): TinyBExecutionSummary {
  return {
    tinyBEligibleCount: 0,
    tinyBOpenedCount: 0,
    blockers: [],
    noTradeDiagnostics: [],
    executionNote: null,
    simulatedLabel: "SIMULATED_PAPER_ONLY",
  };
}

export function finalizeTinyBExecutionNote(summary: TinyBExecutionSummary): string | null {
  if (summary.tinyBOpenedCount > 0) {
    return `Tiny B paper-only setup opened with reduced size (${summary.tinyBOpenedCount} trade(s)).`;
  }
  if (summary.tinyBEligibleCount > 0 && summary.blockers.length > 0) {
    return summary.blockers[0]?.reasonText ?? "Tiny B was eligible diagnostically but blocked at execution.";
  }
  if (summary.tinyBEligibleCount > 0) {
    return "Tiny B eligible but no trade opened — see strategy-layer blockers in no-trade diagnostics.";
  }
  return null;
}
