function envInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (!v) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export type PaperRotationMode = "disabled" | "manual_review" | "auto_paper_only";

function resolveRotationMode(): PaperRotationMode {
  const mode = process.env.PAPER_ROTATION_MODE?.trim().toLowerCase();
  if (mode === "auto_paper_only" || mode === "manual_review" || mode === "disabled") {
    return mode;
  }
  if (envBool("PAPER_ENABLE_ROTATION", false)) return "auto_paper_only";
  return "disabled";
}

/** Paper-only rotation — never places real orders. Secondary to quality trade selection. */
export const PAPER_ROTATION_CONFIG = {
  mode: resolveRotationMode(),
  /** Auto-rotate only when mode is auto_paper_only */
  enabled: resolveRotationMode() === "auto_paper_only",
  manualReview: resolveRotationMode() === "manual_review",
  requireProfit: envBool("PAPER_ROTATION_REQUIRE_PROFIT", true),
  minScoreAdvantage: envFloat("PAPER_ROTATION_MIN_SCORE_ADVANTAGE", 15),
  minExitPnlBps: envFloat("PAPER_ROTATION_MIN_EXIT_PNL_BPS", 10),
  allowBreakevenExit: envBool("PAPER_ROTATION_ALLOW_BREAKEVEN_EXIT", true),
  maxExitLossBps: envFloat("PAPER_ROTATION_MAX_EXIT_LOSS_BPS", 5),
  minTradeAgeMinutes: envInt("PAPER_ROTATION_MIN_TRADE_AGE_MINUTES", 30),
  protectNearTakeProfit: envBool("PAPER_ROTATION_PROTECT_NEAR_TAKE_PROFIT", true),
  takeProfitDistanceBps: envFloat("PAPER_ROTATION_TAKE_PROFIT_DISTANCE_BPS", 25),
  blockExtremeRiskReplacement: envBool("PAPER_ROTATION_BLOCK_EXTREME_RISK_REPLACEMENT", true),
  breakevenScoreAdvantage: envFloat("PAPER_ROTATION_BREAKEVEN_SCORE_ADVANTAGE", 25),
} as const;

export type PaperRotationConfig = typeof PAPER_ROTATION_CONFIG;

export function rotationWarning(config: PaperRotationConfig = PAPER_ROTATION_CONFIG): string | null {
  if (config.mode === "auto_paper_only") {
    return "Rotation is enabled. This is experimental paper-only behavior.";
  }
  return null;
}

export function serializeRotationConfig(config: PaperRotationConfig = PAPER_ROTATION_CONFIG) {
  return {
    mode: config.mode,
    enabled: config.enabled,
    manualReview: config.manualReview,
    warning: rotationWarning(config),
    requireProfit: config.requireProfit,
    minScoreAdvantage: config.minScoreAdvantage,
    minExitPnlBps: config.minExitPnlBps,
    allowBreakevenExit: config.allowBreakevenExit,
    maxExitLossBps: config.maxExitLossBps,
    minTradeAgeMinutes: config.minTradeAgeMinutes,
    protectNearTakeProfit: config.protectNearTakeProfit,
    takeProfitDistanceBps: config.takeProfitDistanceBps,
    blockExtremeRiskReplacement: config.blockExtremeRiskReplacement,
    breakevenScoreAdvantage: config.breakevenScoreAdvantage,
  };
}
