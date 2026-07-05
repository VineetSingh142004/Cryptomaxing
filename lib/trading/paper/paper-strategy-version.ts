export const CURRENT_PAPER_STRATEGY_VERSION = "v0.9-loss-shield" as const;
export const LEGACY_PAPER_STRATEGY_VERSION = "legacy" as const;

export type PaperStrategyVersion = typeof CURRENT_PAPER_STRATEGY_VERSION | typeof LEGACY_PAPER_STRATEGY_VERSION | string;

export function isCurrentStrategyVersion(version: string | null | undefined): boolean {
  return version === CURRENT_PAPER_STRATEGY_VERSION;
}
