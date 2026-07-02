export const APP_NAME = "Alpha Autopilot" as const;
export const APP_VERSION = "0.8.0" as const;

export const TRADING_MODES = ["PAPER", "MANUAL", "AUTO"] as const;
export type TradingModeConstant = (typeof TRADING_MODES)[number];

export const AUTO_STATES = ["LOCKED", "READY", "PAUSED", "EMERGENCY_STOP"] as const;
export type AutoStateConstant = (typeof AUTO_STATES)[number];

/** Reason codes for Auto mode blocking — real gates evaluated in later prompts */
export const AUTO_BLOCK_REASONS = {
  PROOF_GATES_NOT_IMPLEMENTED: "PROOF_GATES_NOT_IMPLEMENTED",
  RISK_ENGINE_NOT_IMPLEMENTED: "RISK_ENGINE_NOT_IMPLEMENTED",
  DATA_QUALITY_NOT_VERIFIED: "DATA_QUALITY_NOT_VERIFIED",
  EXECUTION_QUALITY_NOT_VERIFIED: "EXECUTION_QUALITY_NOT_VERIFIED",
  SURVIVAL_GATES_NOT_PASSED: "SURVIVAL_GATES_NOT_PASSED",
  ALPHA_NOT_PROVEN: "ALPHA_NOT_PROVEN",
  SAME_DAY_EVIDENCE_MISSING: "SAME_DAY_EVIDENCE_MISSING",
  LIVE_EVIDENCE_MISSING: "LIVE_EVIDENCE_MISSING",
  EMERGENCY_PAUSED: "EMERGENCY_PAUSED",
  NO_TRADE_PERMISSION: "NO_TRADE_PERMISSION",
} as const;

export type AutoBlockReason = (typeof AUTO_BLOCK_REASONS)[keyof typeof AUTO_BLOCK_REASONS];

export const EVIDENCE_LEVELS = [
  "NONE",
  "BACKTEST_ONLY",
  "FORWARD_TEST",
  "SHADOW_LIVE",
  "PAPER_PROVEN",
  "CANARY_LIVE",
  "LIVE_PROVEN",
] as const;

export const TRADE_PERMISSION_DECISIONS = ["ALLOW", "BLOCK", "WAIT"] as const;

export const DEFAULT_SYSTEM_USER_EMAIL = "system@alpha-autopilot.local";
