import { evaluateMarketDataQuality } from "@/lib/trading/data";
import { computeAllFeatures } from "@/lib/trading/features";
import { scanExplosiveMove, analyzeMicrostructureEdge } from "@/lib/trading/scanning";
import type { ScanDirection } from "@/lib/trading/scanning";
import { computeTrueInvalidationStop } from "@/lib/trading/stops";
import { estimateExecutionQuality, routeVenue } from "@/lib/trading/execution";
import {
  computeLeverageIntelligence,
  computeKellySizing,
  evaluateDailyGuardrails,
} from "@/lib/trading/risk";
import type { DailyPnLState } from "@/lib/trading/risk";
import { buildProfitPlan, routeProfitOpportunity } from "@/lib/trading/profit";
import type { ProfitRouterResult } from "@/lib/trading/profit/router";
import type { BacktestMetrics, MonteCarloResult, SessionEdgeStats } from "@/lib/trading/research/types";

export interface AnalyzeOpportunityInput {
  symbol: string;
  strategyId: string;
  direction?: "long" | "short";
  correlationGroup?: string;
  accountEquity?: number;
  positionSizeUsd?: number;
  catalyst?: string | null;
  dailyState?: DailyPnLState;
  strategyMetrics?: BacktestMetrics | null;
  monteCarlo?: MonteCarloResult | null;
  adversarialPassed?: boolean;
  benchmarkAlphaPassed?: boolean;
  sessionEdge?: SessionEdgeStats | null;
  liveDriftDetected?: boolean;
  edgeDecayDetected?: boolean;
  proofGateApproved?: boolean;
  kellyStats?: { winRate: number; avgWin: number; avgLoss: number; sampleSize: number };
}

export interface FullOpportunityAnalysis {
  symbol: string;
  strategyId: string;
  explosive: ReturnType<typeof scanExplosiveMove>;
  microstructure: ReturnType<typeof analyzeMicrostructureEdge>;
  stop: ReturnType<typeof computeTrueInvalidationStop>;
  execution: ReturnType<typeof estimateExecutionQuality>;
  venue: ReturnType<typeof routeVenue>;
  leverage: ReturnType<typeof computeLeverageIntelligence>;
  kelly: ReturnType<typeof computeKellySizing>;
  daily: ReturnType<typeof evaluateDailyGuardrails>;
  profitPlan: ReturnType<typeof buildProfitPlan>;
  router: ProfitRouterResult;
  dataQuality: Awaited<ReturnType<typeof evaluateMarketDataQuality>>["quality"];
  analyzedAt: string;
}

export async function analyzeOpportunity(input: AnalyzeOpportunityInput): Promise<FullOpportunityAnalysis> {
  const { snapshot, quality } = await evaluateMarketDataQuality(input.symbol, {
    requiresOrderBook: true,
  });

  let btcCandles;
  let ethCandles;
  if (!input.symbol.startsWith("BTC")) {
    try {
      btcCandles = (await evaluateMarketDataQuality("BTC/USD")).snapshot.candles5m;
    } catch {
      /* optional */
    }
  }
  if (!input.symbol.startsWith("ETH")) {
    try {
      ethCandles = (await evaluateMarketDataQuality("ETH/USD")).snapshot.candles5m;
    } catch {
      /* optional */
    }
  }

  const features = computeAllFeatures(snapshot, { btcCandles, ethCandles });
  const direction: "long" | "short" =
    input.direction ??
    (scanExplosiveMove({ snapshot, features }).direction === "short" ? "short" : "long");

  const scanCtx = { snapshot, features, direction, catalyst: input.catalyst };
  const explosive = scanExplosiveMove(scanCtx);
  const microstructure = analyzeMicrostructureEdge(scanCtx, direction as ScanDirection);

  const stop = computeTrueInvalidationStop({
    snapshot,
    features,
    direction,
    leverage: 1,
  });

  const accountEquity = input.accountEquity ?? 10_000;
  const positionSizeUsd = input.positionSizeUsd ?? accountEquity * 0.05;

  const execution = estimateExecutionQuality({
    snapshot,
    features,
    positionSizeUsd,
    direction,
    providerHealthy: snapshot.providerHealth === "ok",
  });

  const venue = routeVenue({ snapshot, features, positionSizeUsd });

  const kellyDefaults = input.kellyStats ?? {
    winRate: input.strategyMetrics?.winRate ?? 0.5,
    avgWin: input.strategyMetrics?.avgWin ?? 1,
    avgLoss: input.strategyMetrics?.avgLoss ?? 1,
    sampleSize: input.strategyMetrics?.sampleSize ?? 0,
  };

  const kelly = computeKellySizing({
    ...kellyDefaults,
    accountEquity,
    correlatedExposure: 0,
  });

  const daily = evaluateDailyGuardrails(
    input.dailyState ?? { netDailyPct: 0, consecutiveLosses: 0, tradesToday: 0 },
  );

  const profitPlan = buildProfitPlan({
    entryPrice: snapshot.ticker.price,
    direction,
    stop,
    features,
    accountEquity,
    positionRiskPct: kelly.riskPerTradePct,
  });

  const expectedRewardPct = stop.rewardToRisk
    ? stop.stopDistancePct * stop.rewardToRisk
    : profitPlan.expectedProfitPerUnitRisk * stop.stopDistancePct;

  const leverage = computeLeverageIntelligence({
    entryPrice: snapshot.ticker.price,
    direction,
    stop: { ...stop, liquidationPrice: stop.liquidationPrice },
    execution,
    features,
    accountEquity,
    proofGateApproved: input.proofGateApproved ?? false,
    riskOfRuinApproved: kelly.decision === "ALLOW",
    expectedRewardPct,
  });

  const router = routeProfitOpportunity({
    symbol: input.symbol,
    strategyId: input.strategyId,
    direction,
    correlationGroup: input.correlationGroup ?? input.strategyId,
    explosive,
    microstructure,
    stop,
    execution,
    venue,
    leverage,
    kelly,
    daily,
    profitPlan,
    features,
    dataQuality: quality,
    strategyMetrics: input.strategyMetrics,
    monteCarlo: input.monteCarlo,
    adversarialPassed: input.adversarialPassed,
    benchmarkAlphaPassed: input.benchmarkAlphaPassed,
    sessionEdge: input.sessionEdge,
    liveDriftDetected: input.liveDriftDetected,
    edgeDecayDetected: input.edgeDecayDetected,
    accountEquity,
  });

  return {
    symbol: input.symbol,
    strategyId: input.strategyId,
    explosive,
    microstructure,
    stop,
    execution,
    venue,
    leverage,
    kelly,
    daily,
    profitPlan,
    router,
    dataQuality: quality,
    analyzedAt: new Date().toISOString(),
  };
}

export const OPPORTUNITY_ENGINE_STATUS = "ACTIVE" as const;
