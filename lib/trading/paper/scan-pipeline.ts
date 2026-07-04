export interface ScanPipelineStats {
  coinsDiscovered: number;
  coinsScanned: number;
  coinsFilteredOut: number;
  removedByLiquidity: number;
  removedByVolume: number;
  removedByMarketCapRisk: number;
  removedByExchangeAvailability: number;
  removedByUsAvailability: number;
  passedBasicFilters: number;
  /** Coins sent to deep evaluation (snapshot + scoring). */
  deepEvaluated: number;
  deepEvaluationLimit: number;
  deepEvaluationLimitReason: string;
  finalCandidates: number;
  finalPaperTradeCandidates: number;
  watchOnlyCandidates: number;
  selectionExplanation: string;
  providerStatus: Record<string, string>;
}

export const EMPTY_PIPELINE: ScanPipelineStats = {
  coinsDiscovered: 0,
  coinsScanned: 0,
  coinsFilteredOut: 0,
  removedByLiquidity: 0,
  removedByVolume: 0,
  removedByMarketCapRisk: 0,
  removedByExchangeAvailability: 0,
  removedByUsAvailability: 0,
  passedBasicFilters: 0,
  deepEvaluated: 0,
  deepEvaluationLimit: 0,
  deepEvaluationLimitReason: "",
  finalCandidates: 0,
  finalPaperTradeCandidates: 0,
  watchOnlyCandidates: 0,
  selectionExplanation: "",
  providerStatus: {},
};

export function computeCoinsFilteredOut(stats: Pick<
  ScanPipelineStats,
  | "removedByLiquidity"
  | "removedByVolume"
  | "removedByMarketCapRisk"
  | "removedByExchangeAvailability"
  | "removedByUsAvailability"
  | "coinsDiscovered"
  | "passedBasicFilters"
>): number {
  return Math.max(0, stats.coinsDiscovered - stats.passedBasicFilters);
}

export function finalizePipelineStats(
  partial: Partial<ScanPipelineStats> & Pick<ScanPipelineStats, "coinsDiscovered">,
): ScanPipelineStats {
  return { ...EMPTY_PIPELINE, ...partial };
}

export function pipelineStageLabels(): string[] {
  return [
    "1. Provider discovery",
    "2. Basic filtering",
    "3. Availability check",
    "4. Risk/liquidity filtering",
    "5. Deep evaluation",
    "6. Final candidate selection",
  ];
}
