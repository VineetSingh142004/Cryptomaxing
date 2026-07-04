import type { PaperTrade as DbPaperTrade } from "@prisma/client";
import type { ScanCandidate } from "@/lib/trading/paper/opportunity-scanner";
import { PAPER_CONFIG } from "@/lib/trading/paper/paper-config";
import {
  PAPER_ROTATION_CONFIG,
  type PaperRotationConfig,
} from "@/lib/trading/paper/paper-rotation-config";
import { PAPER_TRADE_EXPIRY_HOURS } from "@/lib/trading/paper/controlled-active-strategy";
import type { RiskTier } from "@/lib/trading/paper/scanner-config";

export type CapacityAction =
  | "HOLD_CURRENT_POSITIONS"
  | "MARK_MISSED_OPPORTUNITY"
  | "PAPER_ROTATE_OUT_WEAKEST"
  | "PAPER_SKIP_DUE_TO_MAX_OPEN";

export type MissedOpportunityReason =
  | "MAX_OPEN_TRADES_REACHED"
  | "EXIT_NOT_PROFITABLE"
  | "SCORE_ADVANTAGE_TOO_SMALL"
  | "OPEN_TRADE_TOO_YOUNG"
  | "OPEN_TRADE_NEAR_TAKE_PROFIT"
  | "EXTREME_RISK_REPLACEMENT_BLOCKED"
  | "ROTATION_DISABLED";

export type RotationEligibility =
  | "eligible"
  | "not_profitable"
  | "near_take_profit"
  | "too_young"
  | "protected";

export interface OpenTradeCapacityView {
  tradeId: string;
  symbol: string;
  /** Composite quality score (higher = better). */
  score: number;
  /** Original opportunity score at entry. */
  originalOpportunityScore: number;
  /** Higher = more replaceable (weaker). */
  weaknessScore: number;
  unrealizedPnl: number | null;
  unrealizedPnlBps: number | null;
  ageMinutes: number;
  entryPrice: number | null;
  currentPrice: number | null;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  distanceToStop: number | null;
  distanceToTarget: number | null;
  distanceToTargetBps: number | null;
  nearTakeProfit: boolean;
  riskTier: string | null;
  confidenceDecay: number;
  rotationEligibility: RotationEligibility;
  rotationEligibilityReason: string;
}

export interface CapacityDecision {
  action: CapacityAction;
  candidate: ScanCandidate;
  weakestTrade?: OpenTradeCapacityView;
  blockedByOpenTradeIds: string[];
  reason: string;
  missedReasonCode?: MissedOpportunityReason;
  scoreAdvantage?: number;
  exitPnlBps?: number;
}

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function directionFromSide(side: string): "long" | "short" {
  return side === "SHORT" ? "short" : "long";
}

export function computeUnrealizedPnlBps(input: {
  side: string;
  entryPrice: number;
  currentPrice: number;
}): number {
  const dir = directionFromSide(input.side);
  const raw =
    dir === "long"
      ? (input.currentPrice - input.entryPrice) / input.entryPrice
      : (input.entryPrice - input.currentPrice) / input.entryPrice;
  return raw * 10_000;
}

export function computeDistanceToTargetBps(input: {
  side: string;
  currentPrice: number;
  takeProfit: number;
}): number {
  const dir = directionFromSide(input.side);
  const raw =
    dir === "long"
      ? (input.takeProfit - input.currentPrice) / input.currentPrice
      : (input.currentPrice - input.takeProfit) / input.currentPrice;
  return Math.max(0, raw * 10_000);
}

export function isNearTakeProfit(input: {
  side: string;
  currentPrice: number;
  takeProfit: number;
  thresholdBps: number;
}): boolean {
  const distBps = computeDistanceToTargetBps(input);
  return distBps <= input.thresholdBps;
}

export function computeWeaknessScore(view: {
  originalOpportunityScore: number;
  confidenceDecay: number;
  unrealizedPnlBps: number | null;
  nearTakeProfit: boolean;
  distanceToTargetBps: number | null;
  ageMinutes: number;
  riskTier: string | null;
}): number {
  let weakness = (100 - view.originalOpportunityScore) * 0.35;
  weakness += view.confidenceDecay * 0.2;
  weakness += Math.min(20, view.ageMinutes * 0.08);

  if (view.unrealizedPnlBps !== null && view.unrealizedPnlBps < 0) {
    weakness += Math.min(15, Math.abs(view.unrealizedPnlBps) / 8);
  }

  if (view.distanceToTargetBps !== null) {
    weakness += Math.min(12, view.distanceToTargetBps / 15);
  }

  if (view.riskTier === "EXTREME_RISK" || view.riskTier === "HIGH_VOLATILITY") {
    weakness += 5;
  }

  if (view.nearTakeProfit) {
    weakness -= 100;
  }

  return weakness;
}

export function assessRotationEligibility(
  view: Pick<
    OpenTradeCapacityView,
    | "ageMinutes"
    | "unrealizedPnlBps"
    | "nearTakeProfit"
    | "originalOpportunityScore"
  >,
  config: PaperRotationConfig = PAPER_ROTATION_CONFIG,
): { eligibility: RotationEligibility; reason: string } {
  if (view.ageMinutes < config.minTradeAgeMinutes) {
    return {
      eligibility: "too_young",
      reason: `Trade age ${view.ageMinutes.toFixed(0)}m < ${config.minTradeAgeMinutes}m minimum`,
    };
  }

  if (config.protectNearTakeProfit && view.nearTakeProfit) {
    return {
      eligibility: "near_take_profit",
      reason: "OPEN_TRADE_NEAR_TAKE_PROFIT",
    };
  }

  const pnlBps = view.unrealizedPnlBps ?? 0;

  if (config.requireProfit && pnlBps >= config.minExitPnlBps) {
    return { eligibility: "eligible", reason: "Profitable exit meets minimum threshold" };
  }

  if (
    config.allowBreakevenExit &&
    pnlBps >= -config.maxExitLossBps &&
    pnlBps < config.minExitPnlBps
  ) {
    return {
      eligibility: "eligible",
      reason: "Near-breakeven exit allowed with strong candidate advantage",
    };
  }

  if (config.requireProfit) {
    return {
      eligibility: "not_profitable",
      reason: `Exit P&L ${pnlBps.toFixed(1)} bps below required ${config.minExitPnlBps} bps`,
    };
  }

  return { eligibility: "protected", reason: "Exit not profitable or safe" };
}

export function computeOpenTradeCapacityView(input: {
  trade: DbPaperTrade;
  currentPrice: number | null;
  candidateScoreBySymbol?: Map<string, number>;
  riskTierBySymbol?: Map<string, string>;
  now?: Date;
  rotationConfig?: PaperRotationConfig;
}): OpenTradeCapacityView {
  const config = input.rotationConfig ?? PAPER_ROTATION_CONFIG;
  const { trade } = input;
  const now = input.now ?? new Date();
  const entry = toNumber(trade.entryPrice);
  const stop = toNumber(trade.plannedStopLoss);
  const tp = toNumber(trade.plannedTakeProfit);
  const size = toNumber(trade.simulatedSize);
  const confidence = toNumber(trade.confidence) ?? 0.5;
  const openedAt = trade.openedAt ?? trade.createdAt;
  const ageMinutes = (now.getTime() - openedAt.getTime()) / 60_000;
  const expiryMs = PAPER_TRADE_EXPIRY_HOURS * 3_600_000;
  const ageRatio = Math.min(1, (now.getTime() - openedAt.getTime()) / expiryMs);
  const confidenceDecay = ageRatio * 25;

  const currentPrice = input.currentPrice ?? entry;
  let unrealizedPnl: number | null = null;
  let unrealizedPnlBps: number | null = null;

  if (entry !== null && currentPrice !== null && size !== null && size > 0) {
    const dir = directionFromSide(trade.side);
    unrealizedPnl =
      dir === "long" ? (currentPrice - entry) * size : (entry - currentPrice) * size;
    unrealizedPnlBps = computeUnrealizedPnlBps({
      side: trade.side,
      entryPrice: entry,
      currentPrice,
    });
  }

  const originalOpportunityScore =
    input.candidateScoreBySymbol?.get(trade.symbol) ?? confidence * 100;

  let distanceToTargetBps: number | null = null;
  let nearTakeProfit = false;
  if (currentPrice !== null && tp !== null) {
    distanceToTargetBps = computeDistanceToTargetBps({
      side: trade.side,
      currentPrice,
      takeProfit: tp,
    });
    nearTakeProfit = isNearTakeProfit({
      side: trade.side,
      currentPrice,
      takeProfit: tp,
      thresholdBps: config.takeProfitDistanceBps,
    });
  }

  const riskTier =
    input.riskTierBySymbol?.get(trade.symbol) ?? null;

  const weaknessScore = computeWeaknessScore({
    originalOpportunityScore,
    confidenceDecay,
    unrealizedPnlBps,
    nearTakeProfit,
    distanceToTargetBps,
    ageMinutes,
    riskTier,
  });

  let composite = originalOpportunityScore - confidenceDecay;
  if (unrealizedPnl !== null && unrealizedPnl < 0) composite -= 5;
  if (unrealizedPnl !== null && unrealizedPnl > 0) composite += 2;

  if (currentPrice !== null && stop !== null && tp !== null) {
    const distStop = Math.abs(currentPrice - stop);
    const distTarget = Math.abs(tp - currentPrice);
    const range = Math.abs(tp - stop);
    if (range > 0) {
      if (distStop / range < 0.15) composite -= 8;
      if (distTarget / range < 0.15) composite += 5;
    }
  }

  const eligibility = assessRotationEligibility(
    {
      ageMinutes,
      unrealizedPnlBps,
      nearTakeProfit,
      originalOpportunityScore,
    },
    config,
  );

  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    score: composite,
    originalOpportunityScore,
    weaknessScore,
    unrealizedPnl,
    unrealizedPnlBps,
    ageMinutes,
    entryPrice: entry,
    currentPrice,
    plannedStopLoss: stop,
    plannedTakeProfit: tp,
    distanceToStop:
      currentPrice !== null && stop !== null ? Math.abs(currentPrice - stop) : null,
    distanceToTarget:
      currentPrice !== null && tp !== null ? Math.abs(tp - currentPrice) : null,
    distanceToTargetBps,
    nearTakeProfit,
    riskTier,
    confidenceDecay,
    rotationEligibility: eligibility.eligibility,
    rotationEligibilityReason: eligibility.reason,
  };
}

/** Pick the most replaceable open trade (highest weakness score). */
export function findWeakestOpenTrade(views: OpenTradeCapacityView[]): OpenTradeCapacityView | null {
  if (views.length === 0) return null;
  return [...views].sort((a, b) => b.weaknessScore - a.weaknessScore)[0] ?? null;
}

export function isStrongCandidate(candidate: ScanCandidate): boolean {
  return (
    candidate.action === "OPEN_TRADE" &&
    candidate.tradableOnConfiguredExchange &&
    candidate.opportunityScore >= PAPER_CONFIG.minOpportunityScore
  );
}

function exitMeetsProfitRules(input: {
  exitPnlBps: number;
  scoreAdvantage: number;
  config: PaperRotationConfig;
}): boolean {
  const { exitPnlBps, scoreAdvantage, config } = input;

  if (exitPnlBps >= config.minExitPnlBps) {
    return true;
  }

  if (
    config.allowBreakevenExit &&
    exitPnlBps >= -config.maxExitLossBps &&
    scoreAdvantage >= config.breakevenScoreAdvantage
  ) {
    return true;
  }

  return false;
}

export function decideCapacityForCandidate(input: {
  candidate: ScanCandidate;
  openViews: OpenTradeCapacityView[];
  maxOpenTrades: number;
  currentOpenCount: number;
  rotationConfig?: PaperRotationConfig;
}): CapacityDecision {
  const config = input.rotationConfig ?? PAPER_ROTATION_CONFIG;
  const { candidate, openViews, currentOpenCount, maxOpenTrades } = input;
  const blockedByOpenTradeIds = openViews.map((v) => v.tradeId);

  if (currentOpenCount < maxOpenTrades) {
    return {
      action: "HOLD_CURRENT_POSITIONS",
      candidate,
      blockedByOpenTradeIds: [],
      reason: "Capacity available",
    };
  }

  if (!isStrongCandidate(candidate)) {
    return {
      action: "PAPER_SKIP_DUE_TO_MAX_OPEN",
      candidate,
      blockedByOpenTradeIds,
      reason: "Candidate not strong enough to displace open trades",
    };
  }

  if (!config.enabled) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      blockedByOpenTradeIds,
      reason: config.manualReview ? "ROTATION_MANUAL_REVIEW" : "ROTATION_DISABLED",
      missedReasonCode: config.manualReview ? "ROTATION_MANUAL_REVIEW" : "ROTATION_DISABLED",
    };
  }

  const weakest = findWeakestOpenTrade(openViews);
  if (!weakest) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      blockedByOpenTradeIds,
      reason: "MAX_OPEN_TRADES_REACHED",
      missedReasonCode: "MAX_OPEN_TRADES_REACHED",
    };
  }

  const scoreAdvantage = candidate.opportunityScore - weakest.originalOpportunityScore;
  const exitPnlBps = weakest.unrealizedPnlBps ?? 0;

  if (scoreAdvantage < config.minScoreAdvantage) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      weakestTrade: weakest,
      blockedByOpenTradeIds,
      reason: "SCORE_ADVANTAGE_TOO_SMALL",
      missedReasonCode: "SCORE_ADVANTAGE_TOO_SMALL",
      scoreAdvantage,
      exitPnlBps,
    };
  }

  if (
    config.blockExtremeRiskReplacement &&
    (candidate.riskTier as RiskTier) === "EXTREME_RISK"
  ) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      weakestTrade: weakest,
      blockedByOpenTradeIds,
      reason: "EXTREME_RISK_REPLACEMENT_BLOCKED",
      missedReasonCode: "EXTREME_RISK_REPLACEMENT_BLOCKED",
      scoreAdvantage,
      exitPnlBps,
    };
  }

  if (weakest.ageMinutes < config.minTradeAgeMinutes) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      weakestTrade: weakest,
      blockedByOpenTradeIds,
      reason: "OPEN_TRADE_TOO_YOUNG",
      missedReasonCode: "OPEN_TRADE_TOO_YOUNG",
      scoreAdvantage,
      exitPnlBps,
    };
  }

  if (config.protectNearTakeProfit && weakest.nearTakeProfit) {
    return {
      action: "MARK_MISSED_OPPORTUNITY",
      candidate,
      weakestTrade: weakest,
      blockedByOpenTradeIds,
      reason: "OPEN_TRADE_NEAR_TAKE_PROFIT",
      missedReasonCode: "OPEN_TRADE_NEAR_TAKE_PROFIT",
      scoreAdvantage,
      exitPnlBps,
    };
  }

  if (config.requireProfit || config.allowBreakevenExit) {
    if (!exitMeetsProfitRules({ exitPnlBps, scoreAdvantage, config })) {
      return {
        action: "MARK_MISSED_OPPORTUNITY",
        candidate,
        weakestTrade: weakest,
        blockedByOpenTradeIds,
        reason: "EXIT_NOT_PROFITABLE",
        missedReasonCode: "EXIT_NOT_PROFITABLE",
        scoreAdvantage,
        exitPnlBps,
      };
    }
  }

  return {
    action: "PAPER_ROTATE_OUT_WEAKEST",
    candidate,
    weakestTrade: weakest,
    blockedByOpenTradeIds,
    reason: `Profit-protected rotation: score +${scoreAdvantage.toFixed(1)}, exit ${exitPnlBps.toFixed(1)} bps`,
    scoreAdvantage,
    exitPnlBps,
  };
}
