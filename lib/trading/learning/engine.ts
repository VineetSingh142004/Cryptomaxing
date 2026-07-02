export type LearningCategory =
  | "strategy_by_regime"
  | "coin_by_hour"
  | "slippage_by_exchange"
  | "funding_impact"
  | "fakeout_patterns"
  | "exit_quality"
  | "stop_quality"
  | "api_degradation"
  | "microstructure_patterns"
  | "user_behavior"
  | "explanation_clarity";

export type LearningForbiddenAction =
  | "CREATE_LIVE_STRATEGY"
  | "INCREASE_RISK"
  | "IGNORE_STOP"
  | "AVERAGE_DOWN"
  | "MARTINGALE"
  | "BYPASS_PERMISSION"
  | "BYPASS_RISK"
  | "INCREASE_LEVERAGE"
  | "APPROVE_AUTO"
  | "HIDE_DRIFT"
  | "REACTIVATE_DISABLED"
  | "FAKE_EVIDENCE";

export interface LearningObservation {
  category: LearningCategory;
  key: string;
  value: number | string | Record<string, unknown>;
  sampleSize: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  recordedAt: string;
}

export interface LearningActionRequest {
  action: LearningForbiddenAction | "RECORD_OBSERVATION" | "SUGGEST_PARAMETER_TWEAK";
  payload?: Record<string, unknown>;
}

export interface LearningActionResult {
  allowed: boolean;
  reasonCodes: string[];
  requiresUserApproval: boolean;
  observation?: LearningObservation;
}

const FORBIDDEN: LearningForbiddenAction[] = [
  "CREATE_LIVE_STRATEGY",
  "INCREASE_RISK",
  "IGNORE_STOP",
  "AVERAGE_DOWN",
  "MARTINGALE",
  "BYPASS_PERMISSION",
  "BYPASS_RISK",
  "INCREASE_LEVERAGE",
  "APPROVE_AUTO",
  "HIDE_DRIFT",
  "REACTIVATE_DISABLED",
  "FAKE_EVIDENCE",
];

export function evaluateLearningAction(request: LearningActionRequest): LearningActionResult {
  if (FORBIDDEN.includes(request.action as LearningForbiddenAction)) {
    return {
      allowed: false,
      reasonCodes: [`FORBIDDEN_${request.action}`],
      requiresUserApproval: true,
    };
  }

  if (request.action === "SUGGEST_PARAMETER_TWEAK") {
    return {
      allowed: true,
      reasonCodes: ["SUGGESTION_ONLY"],
      requiresUserApproval: true,
    };
  }

  if (request.action === "RECORD_OBSERVATION") {
    const obs = request.payload as Partial<LearningObservation> | undefined;
    if (!obs?.category || obs.sampleSize === undefined) {
      return {
        allowed: false,
        reasonCodes: ["INVALID_OBSERVATION"],
        requiresUserApproval: false,
      };
    }
    return {
      allowed: true,
      reasonCodes: [],
      requiresUserApproval: false,
      observation: {
        category: obs.category,
        key: obs.key ?? "unknown",
        value: obs.value ?? 0,
        sampleSize: obs.sampleSize,
        confidence: obs.confidence ?? (obs.sampleSize >= 30 ? "HIGH" : obs.sampleSize >= 10 ? "MEDIUM" : "LOW"),
        recordedAt: new Date().toISOString(),
      },
    };
  }

  return { allowed: false, reasonCodes: ["UNKNOWN_ACTION"], requiresUserApproval: false };
}

export function recordRegimePerformance(input: {
  strategyId: string;
  regime: string;
  netPnl: number;
  tradeCount: number;
}): LearningObservation {
  return {
    category: "strategy_by_regime",
    key: `${input.strategyId}:${input.regime}`,
    value: { netPnl: input.netPnl, tradeCount: input.tradeCount },
    sampleSize: input.tradeCount,
    confidence: input.tradeCount >= 20 ? "HIGH" : input.tradeCount >= 5 ? "MEDIUM" : "LOW",
    recordedAt: new Date().toISOString(),
  };
}

export function recordSlippageByExchange(input: {
  exchange: string;
  avgSlippageBps: number;
  sampleSize: number;
}): LearningObservation {
  return {
    category: "slippage_by_exchange",
    key: input.exchange,
    value: input.avgSlippageBps,
    sampleSize: input.sampleSize,
    confidence: input.sampleSize >= 15 ? "MEDIUM" : "LOW",
    recordedAt: new Date().toISOString(),
  };
}
