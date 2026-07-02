import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import type { ComputedFeatures } from "@/lib/trading/features/compute";

export interface SlippageEstimates {
  entrySlippageBps: number;
  exitSlippageBps: number;
  stopSlippageBps: number;
  emergencyExitSlippageBps: number;
  partialFillProbability: number;
  marketImpactBps: number;
  depthAtPositionUsd: number;
  liquidityDecayScore: number;
  queuePriorityScore: number;
  makerFillProbability: number;
  takerCostBps: number;
  cancelReplaceRisk: number;
  spreadExpansionRisk: number;
}

export interface ExecutionQualityResult {
  symbol: string;
  estimates: SlippageEstimates;
  executionQualityScore: number;
  decision: "ALLOW" | "BLOCK" | "WAIT";
  blockReasons: string[];
  urgencyJustifiedForMarket: boolean;
  computedAt: string;
}

export interface VenueQuote {
  venue: string;
  available: boolean;
  bestBid: number | null;
  bestAsk: number | null;
  spreadBps: number | null;
  depthUsd: number | null;
  makerFeeBps: number | null;
  takerFeeBps: number | null;
  latencyMs: number | null;
  fillProbability: number | null;
  permissionSafe: boolean;
  reliabilityScore: number | null;
  fundingCostBps: number | null;
  historicalSlippageBps: number | null;
  orderTypeSupport: string[];
  blockReasons: string[];
}

export interface VenueRoutingResult {
  symbol: string;
  quotes: VenueQuote[];
  recommendedVenue: string | null;
  edgeAfterExecutionScore: number | null;
  decision: "ROUTE" | "BLOCK" | "WAIT";
  blockReasons: string[];
  routedAt: string;
}

export interface ExecutionInput {
  snapshot: NormalizedMarketSnapshot;
  features: ComputedFeatures;
  positionSizeUsd: number;
  direction: "long" | "short";
  isMeme?: boolean;
  providerHealthy?: boolean;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function estimateExecutionQuality(input: ExecutionInput): ExecutionQualityResult {
  const { snapshot, features, positionSizeUsd, isMeme = false, providerHealthy = true } = input;
  const blockReasons: string[] = [];
  const depth = features.execution.exitLiquidity;
  const depthRatio = depth > 0 ? positionSizeUsd / depth : 1;

  const baseSlip = features.execution.expectedSlippageBps;
  const memeMult = isMeme ? 2.5 : 1;
  const sizeImpact = clamp(depthRatio * 40, 0, 30);

  const entrySlippageBps = (baseSlip + sizeImpact) * memeMult;
  const exitSlippageBps = (baseSlip * 1.1 + sizeImpact) * memeMult;
  const stopSlippageBps = (baseSlip * 1.8 + sizeImpact * 1.5) * memeMult;
  const emergencyExitSlippageBps = (baseSlip * 2.5 + sizeImpact * 2) * memeMult;

  const partialFillProbability = clamp(
    depthRatio > 0.15 ? 0.4 : depthRatio > 0.05 ? 0.15 : 0.05,
    0,
    0.9,
  );

  const marketImpactBps = clamp(sizeImpact + depthRatio * 20, 0, 50);
  const depthAtPositionUsd = Math.min(depth, positionSizeUsd * 5);
  const liquidityDecayScore = clamp(100 - depthRatio * 200);
  const queuePriorityScore = clamp(100 - features.execution.queueRisk * 100);
  const makerFillProbability = clamp(features.execution.fillProbability * 0.85);
  const takerCostBps = features.execution.takerFeeImpactBps + entrySlippageBps;
  const cancelReplaceRisk = features.execution.latencySensitivity;
  const spreadExpansionRisk = clamp(snapshot.ticker.spreadBps / 20);

  if (depthRatio > 0.2) blockReasons.push("SIZE_TOO_LARGE_FOR_DEPTH");
  if (exitSlippageBps > 25) blockReasons.push("EXIT_SLIPPAGE_KILLS_EDGE");
  if (!providerHealthy) blockReasons.push("API_DEGRADATION");
  if (snapshot.ticker.spreadBps > 22) blockReasons.push("SPREAD_WIDE");

  const executionQualityScore = clamp(
    liquidityDecayScore * 0.25 +
      queuePriorityScore * 0.15 +
      makerFillProbability * 100 * 0.2 +
      (100 - marketImpactBps * 2) * 0.2 +
      (100 - spreadExpansionRisk * 40) * 0.2,
  );

  let decision: ExecutionQualityResult["decision"] = "ALLOW";
  if (blockReasons.length > 0) decision = "BLOCK";
  else if (executionQualityScore < 50) decision = "WAIT";

  return {
    symbol: snapshot.symbol,
    estimates: {
      entrySlippageBps,
      exitSlippageBps,
      stopSlippageBps,
      emergencyExitSlippageBps,
      partialFillProbability,
      marketImpactBps,
      depthAtPositionUsd,
      liquidityDecayScore,
      queuePriorityScore,
      makerFillProbability,
      takerCostBps,
      cancelReplaceRisk,
      spreadExpansionRisk,
    },
    executionQualityScore,
    decision,
    blockReasons,
    urgencyJustifiedForMarket: emergencyExitSlippageBps > entrySlippageBps * 2,
    computedAt: new Date().toISOString(),
  };
}

export function routeVenue(input: {
  snapshot: NormalizedMarketSnapshot;
  features: ComputedFeatures;
  positionSizeUsd: number;
}): VenueRoutingResult {
  const { snapshot, features, positionSizeUsd } = input;
  const blockReasons: string[] = [];
  const depth =
    (snapshot.orderBook?.bids.reduce((s, l) => s + l.price * l.size, 0) ?? 0) +
    (snapshot.orderBook?.asks.reduce((s, l) => s + l.price * l.size, 0) ?? 0);

  const krakenQuote: VenueQuote = {
    venue: "kraken",
    available: snapshot.providerHealth !== "error",
    bestBid: snapshot.ticker.bid,
    bestAsk: snapshot.ticker.ask,
    spreadBps: snapshot.ticker.spreadBps,
    depthUsd: depth,
    makerFeeBps: snapshot.feeModel.makerBps,
    takerFeeBps: snapshot.feeModel.takerBps,
    latencyMs: snapshot.ticker.latencyMs,
    fillProbability: features.execution.fillProbability,
    permissionSafe: true,
    reliabilityScore: snapshot.providerHealth === "ok" ? 90 : 60,
    fundingCostBps: snapshot.metadata.fundingRate
      ? snapshot.metadata.fundingRate * 10_000
      : null,
    historicalSlippageBps: features.execution.expectedSlippageBps,
    orderTypeSupport: ["limit", "market", "stop-loss"],
    blockReasons: [],
  };

  if (!krakenQuote.available) krakenQuote.blockReasons.push("VENUE_UNAVAILABLE");
  if ((krakenQuote.depthUsd ?? 0) < positionSizeUsd * 3) {
    krakenQuote.blockReasons.push("INSUFFICIENT_DEPTH");
  }

  const placeholderVenues = ["coinbase", "binance", "bybit"].map((v) => ({
    venue: v,
    available: false,
    bestBid: null,
    bestAsk: null,
    spreadBps: null,
    depthUsd: null,
    makerFeeBps: null,
    takerFeeBps: null,
    latencyMs: null,
    fillProbability: null,
    permissionSafe: false,
    reliabilityScore: null,
    fundingCostBps: null,
    historicalSlippageBps: null,
    orderTypeSupport: [] as string[],
    blockReasons: ["NOT_IMPLEMENTED"],
  }));

  const quotes = [krakenQuote, ...placeholderVenues];

  function edgeScore(q: VenueQuote): number | null {
    if (!q.available || q.spreadBps === null || q.takerFeeBps === null) return null;
    const slip = q.historicalSlippageBps ?? 10;
    const totalCost = q.spreadBps + q.takerFeeBps + slip;
    const depthScore = q.depthUsd ? Math.min(q.depthUsd / 1_000_000, 1) * 30 : 0;
    const fillScore = (q.fillProbability ?? 0.5) * 25;
    const relScore = (q.reliabilityScore ?? 50) * 0.25;
    return clamp(100 - totalCost * 2 + depthScore + fillScore + relScore);
  }

  const scored = quotes
    .map((q) => ({ q, score: edgeScore(q) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const recommended = scored[0]?.q.venue ?? null;
  const edgeAfterExecutionScore = scored[0]?.score ?? null;

  if (!recommended) blockReasons.push("NO_VIABLE_VENUE");
  if (krakenQuote.blockReasons.length > 0 && recommended === "kraken") {
    blockReasons.push(...krakenQuote.blockReasons);
  }

  return {
    symbol: snapshot.symbol,
    quotes,
    recommendedVenue: recommended,
    edgeAfterExecutionScore,
    decision: blockReasons.length > 0 ? "BLOCK" : recommended ? "ROUTE" : "WAIT",
    blockReasons,
    routedAt: new Date().toISOString(),
  };
}
