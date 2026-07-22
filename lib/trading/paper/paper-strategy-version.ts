export const CURRENT_PAPER_STRATEGY_VERSION = "v0.10-feature-calibration" as const;
export { V8_STRATEGY_VERSION } from "@/lib/trading/paper/v8-readiness";
export const LEGACY_PAPER_STRATEGY_VERSION = "legacy" as const;

export type PaperStrategyVersion = typeof CURRENT_PAPER_STRATEGY_VERSION | typeof LEGACY_PAPER_STRATEGY_VERSION | string;

export function isCurrentStrategyVersion(version: string | null | undefined): boolean {
  return version === CURRENT_PAPER_STRATEGY_VERSION;
}
