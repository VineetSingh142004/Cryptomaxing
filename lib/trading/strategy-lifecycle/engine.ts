export const STRATEGY_LIFECYCLE_STAGES = [
  "RESEARCH_ONLY",
  "BACKTESTING",
  "PAPER_ONLY",
  "SHADOW_LIVE",
  "TINY_LIVE_CANARY",
  "MANUAL_APPROVED",
  "AUTO_TINY",
  "AUTO_NORMAL",
  "COOLDOWN",
  "DISABLED",
] as const;

export type StrategyLifecycleStage = (typeof STRATEGY_LIFECYCLE_STAGES)[number];

export interface LifecycleState {
  strategyId: string;
  stage: StrategyLifecycleStage;
  consecutiveLosses: number;
  drawdownPct: number;
  fakeoutRate: number;
  slippageVsModel: number;
  liveExpectancy: number | null;
  profitFactor: number | null;
  vsRandomBaseline: number | null;
  parameterVersion: string;
  priorParameterVersion: string | null;
  cooldownUntil: string | null;
  reasonCodes: string[];
  updatedAt: string;
}

export interface LifecycleTransitionResult {
  strategyId: string;
  fromStage: StrategyLifecycleStage;
  toStage: StrategyLifecycleStage;
  action: "PROMOTE" | "DEMOTE" | "COOLDOWN" | "DISABLE" | "ROLLBACK" | "HOLD";
  killSwitchTriggered: boolean;
  reasonCodes: string[];
  decidedAt: string;
}

export interface LifecycleInput {
  strategyId: string;
  current: LifecycleState;
  promotionProof?: {
    evidenceLevel: number;
    backtestPassed?: boolean;
    paperPassed?: boolean;
    shadowPassed?: boolean;
    tinyLivePassed?: boolean;
    userApproved?: boolean;
  };
  degradation?: {
    lossesInRow?: number;
    drawdownExceeded?: boolean;
    fakeoutSpike?: boolean;
    slippageExceedsModel?: boolean;
    negativeExpectancy?: boolean;
    profitFactorBelow?: number;
    worseThanRandom?: boolean;
    edgeDecayConfirmed?: boolean;
    parameterChangeFailed?: boolean;
  };
}

const STAGE_ORDER: StrategyLifecycleStage[] = [
  "DISABLED",
  "RESEARCH_ONLY",
  "BACKTESTING",
  "PAPER_ONLY",
  "SHADOW_LIVE",
  "TINY_LIVE_CANARY",
  "MANUAL_APPROVED",
  "AUTO_TINY",
  "AUTO_NORMAL",
];

function stageIdx(s: StrategyLifecycleStage): number {
  if (s === "COOLDOWN") return STAGE_ORDER.indexOf("MANUAL_APPROVED");
  return STAGE_ORDER.indexOf(s);
}

export function evaluateLifecycleTransition(input: LifecycleInput): LifecycleTransitionResult {
  const { current, degradation: d } = input;
  const reasonCodes: string[] = [];
  let action: LifecycleTransitionResult["action"] = "HOLD";
  let toStage = current.stage;
  let killSwitch = false;

  if (d?.negativeExpectancy || (d?.profitFactorBelow !== undefined && (current.profitFactor ?? 0) < d.profitFactorBelow)) {
    toStage = "DISABLED";
    action = "DISABLE";
    killSwitch = true;
    reasonCodes.push("NEGATIVE_LIVE_EXPECTANCY");
  }

  if (d?.worseThanRandom) {
    toStage = "DISABLED";
    action = "DISABLE";
    reasonCodes.push("WORSE_THAN_RANDOM");
  }

  if (d?.parameterChangeFailed) {
    toStage = current.priorParameterVersion ? current.stage : "PAPER_ONLY";
    action = "ROLLBACK";
    reasonCodes.push("PARAMETER_ROLLBACK");
  }

  if (d?.edgeDecayConfirmed) {
    toStage = demoteOne(current.stage);
    action = "DEMOTE";
    reasonCodes.push("EDGE_DECAY");
  }

  if ((d?.lossesInRow ?? 0) >= 3 || d?.drawdownExceeded || d?.fakeoutSpike || d?.slippageExceedsModel) {
    toStage = "COOLDOWN";
    action = "COOLDOWN";
    if ((d?.lossesInRow ?? 0) >= 3) reasonCodes.push("THREE_LOSSES");
    if (d?.drawdownExceeded) reasonCodes.push("DRAWDOWN");
    if (d?.fakeoutSpike) reasonCodes.push("FAKEOUT_SPIKE");
    if (d?.slippageExceedsModel) reasonCodes.push("SLIPPAGE_EXCEEDS_MODEL");
  } else if ((d?.lossesInRow ?? 0) >= 2) {
    reasonCodes.push("TWO_LOSSES_REDUCE_RISK");
  }

  const proof = input.promotionProof;
  if (action === "HOLD" && proof?.userApproved) {
    const proposed = proposePromotion(current.stage, proof);
    if (proposed && stageIdx(proposed) === stageIdx(current.stage) + 1) {
      toStage = proposed;
      action = "PROMOTE";
      reasonCodes.push("PROOF_PROMOTION");
    }
  }

  return {
    strategyId: input.strategyId,
    fromStage: current.stage,
    toStage,
    action,
    killSwitchTriggered: killSwitch,
    reasonCodes,
    decidedAt: new Date().toISOString(),
  };
}

function demoteOne(stage: StrategyLifecycleStage): StrategyLifecycleStage {
  const order: StrategyLifecycleStage[] = [
    "AUTO_NORMAL",
    "AUTO_TINY",
    "MANUAL_APPROVED",
    "TINY_LIVE_CANARY",
    "SHADOW_LIVE",
    "PAPER_ONLY",
    "BACKTESTING",
    "RESEARCH_ONLY",
    "DISABLED",
  ];
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : "RESEARCH_ONLY";
}

function proposePromotion(
  stage: StrategyLifecycleStage,
  proof: NonNullable<LifecycleInput["promotionProof"]>,
): StrategyLifecycleStage | null {
  const map: Partial<Record<StrategyLifecycleStage, { need: boolean; next: StrategyLifecycleStage }>> = {
    RESEARCH_ONLY: { need: proof.backtestPassed === true, next: "BACKTESTING" },
    BACKTESTING: { need: proof.evidenceLevel >= 2, next: "PAPER_ONLY" },
    PAPER_ONLY: { need: proof.paperPassed === true, next: "SHADOW_LIVE" },
    SHADOW_LIVE: { need: proof.shadowPassed === true, next: "TINY_LIVE_CANARY" },
    TINY_LIVE_CANARY: { need: proof.tinyLivePassed === true, next: "MANUAL_APPROVED" },
    MANUAL_APPROVED: { need: proof.evidenceLevel >= 10, next: "AUTO_TINY" },
    AUTO_TINY: { need: proof.evidenceLevel >= 12, next: "AUTO_NORMAL" },
  };
  const rule = map[stage];
  return rule?.need ? rule.next : null;
}

export const LIFECYCLE_ENGINE_STATUS = "ACTIVE" as const;
