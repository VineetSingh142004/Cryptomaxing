import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { PaperTradeSide } from "@prisma/client";
import {
  evaluateThesisInvalidation,
  type ThesisHoldRecommendation,
  type ThesisValidationStatus,
} from "@/lib/trading/paper/thesis-invalidation";
import {
  evaluateProfitLockState,
  type ProfitLockState,
} from "@/lib/trading/paper/profit-lock-engine";

export type BlueprintExitReason =
  | "TRUE_INVALIDATION_EXIT"
  | "WEAK_THESIS_EXIT"
  | "STALE_TRADE_EXIT"
  | "NEAR_STOP_EXIT"
  | "STOP_DANGER_EXIT"
  | "MARKET_TURNED_EXIT"
  | "VOLUME_FADE_EXIT"
  | "SPREAD_WIDEN_EXIT"
  | "LIQUIDITY_DROP_EXIT"
  | "UNKNOWN_THESIS_EXIT"
  | "STALE_DATA_EXIT"
  | "TRADE_PROFIT_GIVEBACK_EXIT"
  | "OPPORTUNITY_COST_EXIT"
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "EXPIRY_EXIT";

export interface BlueprintExitInput {
  side: PaperTradeSide;
  entryPrice: number;
  markPrice: number;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  openedAt: Date;
  now: Date;
  runsHeld: number;
  snapshot: NormalizedMarketSnapshot | null;
  hasMarketData: boolean;
  thesisStatus: ThesisValidationStatus;
  thesisRecommendation: ThesisHoldRecommendation;
  unrealizedPnl: number;
  peakUnrealizedPnl: number;
  profitLock: ProfitLockState;
  staleRunsThreshold?: number;
  unknownThesisRunsThreshold?: number;
}

export interface BlueprintExitResult {
  shouldExit: boolean;
  exitReason: BlueprintExitReason | null;
  exitPrice: number | null;
  summary: string;
  distanceToSlPct: number | null;
  distanceToTpPct: number | null;
  tpProgressPct: number | null;
  staleTrade: boolean;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
}

function slDistancePct(
  side: PaperTradeSide,
  mark: number,
  stop: number | null,
  entry: number,
): number | null {
  if (stop === null || entry <= 0) return null;
  if (side === "LONG") return ((mark - stop) / entry) * 100;
  return ((stop - mark) / entry) * 100;
}

function tpProgressPct(
  side: PaperTradeSide,
  entry: number,
  mark: number,
  tp: number | null,
): number | null {
  if (tp === null || entry <= 0) return null;
  const total = side === "LONG" ? tp - entry : entry - tp;
  if (Math.abs(total) < 1e-9) return null;
  const progress = side === "LONG" ? mark - entry : entry - mark;
  return Math.max(0, Math.min(100, (progress / total) * 100));
}

function isLosing(side: PaperTradeSide, entry: number, mark: number): boolean {
  return side === "LONG" ? mark < entry : mark > entry;
}

export function evaluateBlueprintExit(input: BlueprintExitInput): BlueprintExitResult {
  const staleThreshold = input.staleRunsThreshold ?? 8;
  const unknownThreshold = input.unknownThesisRunsThreshold ?? 5;
  const distSl = slDistancePct(input.side, input.markPrice, input.plannedStopLoss, input.entryPrice);
  const tpProg = tpProgressPct(input.side, input.entryPrice, input.markPrice, input.plannedTakeProfit);
  const losing = isLosing(input.side, input.entryPrice, input.markPrice);
  const ageHours = (input.now.getTime() - input.openedAt.getTime()) / 3_600_000;
  const staleTrade =
    ageHours >= 4 &&
    (tpProg === null || tpProg < 25) &&
    input.runsHeld >= staleThreshold;

  const base = {
    shouldExit: false,
    exitReason: null as BlueprintExitReason | null,
    exitPrice: null as number | null,
    summary: "Hold — thesis and risk within blueprint limits",
    distanceToSlPct: distSl,
    distanceToTpPct: tpProg,
    staleTrade,
    simulatedLabel: "SIMULATED_PAPER_ONLY" as const,
  };

  if (input.profitLock.shouldExitGiveback) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "TRADE_PROFIT_GIVEBACK_EXIT",
      exitPrice: input.markPrice,
      summary: input.profitLock.summary,
    };
  }

  if (distSl !== null && distSl <= 0.1) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "NEAR_STOP_EXIT",
      exitPrice: input.markPrice,
      summary: `Within ${distSl.toFixed(3)}% of stop — exit before slippage cascade`,
    };
  }

  if (
    distSl !== null &&
    distSl <= 0.25 &&
    (input.thesisStatus === "WEAKENING" ||
      input.thesisStatus === "UNKNOWN_NEEDS_DATA" ||
      input.thesisRecommendation === "NEEDS_MORE_DATA")
  ) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "STOP_DANGER_EXIT",
      exitPrice: input.markPrice,
      summary: "Near stop with weak/unknown thesis — exit paper trade",
    };
  }

  if (!input.hasMarketData || !input.snapshot) {
    if (
      input.runsHeld >= unknownThreshold &&
      input.thesisStatus === "UNKNOWN_NEEDS_DATA"
    ) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "UNKNOWN_THESIS_EXIT",
        exitPrice: input.markPrice,
        summary: "Thesis unknown too long without market data — exit rather than hold",
      };
    }
    if (input.runsHeld >= unknownThreshold || (distSl !== null && distSl <= 0.5 && losing)) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "STALE_DATA_EXIT",
        exitPrice: input.markPrice,
        summary:
          "Market snapshot missing — cannot validate thesis safely; exiting to protect capital",
      };
    }
    if (input.thesisRecommendation === "NEEDS_MORE_DATA" && losing) {
      return {
        ...base,
        shouldExit: distSl !== null && distSl <= 0.25,
        exitReason: distSl !== null && distSl <= 0.25 ? "UNKNOWN_THESIS_EXIT" : null,
        exitPrice: distSl !== null && distSl <= 0.25 ? input.markPrice : null,
        summary:
          distSl !== null && distSl <= 0.25
            ? "Thesis unknown and price near stop — exit rather than default hold"
            : "Missing snapshot — WAIT/BLOCK new sizing; do not assume HOLD is safe",
      };
    }
  }

  if (
    distSl !== null &&
    distSl <= 0.5 &&
    losing &&
    input.runsHeld >= 3 &&
    (tpProg === null || tpProg < 10)
  ) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "STOP_DANGER_EXIT",
      exitPrice: input.markPrice,
      summary: "Losing trade near stop with no recovery progress — exit",
    };
  }

  if (input.thesisStatus === "INVALID" || input.thesisRecommendation === "EXIT") {
    return {
      ...base,
      shouldExit: true,
      exitReason: losing ? "TRUE_INVALIDATION_EXIT" : "WEAK_THESIS_EXIT",
      exitPrice: input.markPrice,
      summary: "Thesis invalidated — blueprint exit",
    };
  }

  if (input.thesisStatus === "WEAKENING" && losing) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "WEAK_THESIS_EXIT",
      exitPrice: input.markPrice,
      summary: "Weakening thesis while losing — exit to limit damage",
    };
  }

  if (input.runsHeld >= unknownThreshold && input.thesisStatus === "UNKNOWN_NEEDS_DATA") {
    return {
      ...base,
      shouldExit: true,
      exitReason: "UNKNOWN_THESIS_EXIT",
      exitPrice: input.markPrice,
      summary: "Thesis unknown too long — exit or tighten; not holding blindly",
    };
  }

  if (staleTrade && (tpProg === null || tpProg < 35)) {
    return {
      ...base,
      shouldExit: true,
      exitReason: "STALE_TRADE_EXIT",
      exitPrice: input.markPrice,
      summary: "Stale trade — capital locked without progress toward target",
    };
  }

  if (input.snapshot && input.hasMarketData) {
    const inv = evaluateThesisInvalidation({
      side: input.side,
      entryPrice: input.entryPrice,
      markPrice: input.markPrice,
      snapshot: input.snapshot,
    });

    if (inv.exitReason === "VOLUME_COLLAPSE" && inv.shouldExit) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "VOLUME_FADE_EXIT",
        exitPrice: input.markPrice,
        summary: inv.signals[0] ?? "Volume fade exit",
      };
    }
    if (inv.exitReason === "LIQUIDITY_WEAKENING" && inv.shouldExit) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "LIQUIDITY_DROP_EXIT",
        exitPrice: input.markPrice,
        summary: inv.signals[0] ?? "Liquidity drop exit",
      };
    }
    if (inv.exitReason === "MARKET_RISK_INCREASED" && inv.shouldExit) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "MARKET_TURNED_EXIT",
        exitPrice: input.markPrice,
        summary: inv.signals[0] ?? "Market risk increased",
      };
    }
    const spread = input.snapshot.ticker.spreadBps ?? 0;
    if (spread > 100 && losing) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "SPREAD_WIDEN_EXIT",
        exitPrice: input.markPrice,
        summary: `Spread ${spread.toFixed(0)} bps destroys edge — exit`,
      };
    }
    if (inv.shouldExit && inv.exitReason) {
      return {
        ...base,
        shouldExit: true,
        exitReason: "TRUE_INVALIDATION_EXIT",
        exitPrice: input.markPrice,
        summary: inv.signals.join("; ") || "True invalidation exit",
      };
    }
  }

  return base;
}
