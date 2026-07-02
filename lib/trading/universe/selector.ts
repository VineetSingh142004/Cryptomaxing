import { prisma } from "@/lib/db/client";
import { evaluateMarketDataQuality } from "@/lib/trading/data";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { computeAllFeatures } from "@/lib/trading/features/compute";

export interface UniverseAssetScore {
  symbol: string;
  tier: "major" | "alt" | "meme";
  totalScore: number;
  liquidityScore: number;
  spreadScore: number;
  volumeScore: number;
  volatilityScore: number;
  feeEfficiencyScore: number;
  slippageScore: number;
  fillProbabilityScore: number;
  dataQualityScore: number;
  reasonCodes: string[];
  blocked: boolean;
}

export interface UniverseSelectionResult {
  approved_universe: string[];
  blocked_assets: { symbol: string; reasonCodes: string[] }[];
  watchlist_assets: { symbol: string; reasonCodes: string[] }[];
  reason_codes: string[];
  best_markets_today: string[];
  worst_markets_today: string[];
  scores: UniverseAssetScore[];
  updatedAt: string;
}

const DEFAULT_CANDIDATES = [
  { symbol: "BTC/USD", tier: "major" as const },
  { symbol: "ETH/USD", tier: "major" as const },
  { symbol: "SOL/USD", tier: "major" as const },
];

const MAJOR_PRIORITY_BONUS = 15;

function scoreSpread(spreadBps: number): number {
  if (spreadBps <= 5) return 100;
  if (spreadBps <= 10) return 85;
  if (spreadBps <= 20) return 60;
  if (spreadBps <= 25) return 40;
  return 0;
}

function scoreLiquidity(liquidityUsd: number | null): number {
  if (!liquidityUsd) return 0;
  if (liquidityUsd >= 50_000_000) return 100;
  if (liquidityUsd >= 10_000_000) return 90;
  if (liquidityUsd >= 1_000_000) return 70;
  if (liquidityUsd >= 500_000) return 50;
  return 20;
}

function scoreSlippage(bps: number): number {
  if (bps <= 3) return 100;
  if (bps <= 8) return 80;
  if (bps <= 15) return 50;
  return 20;
}

async function scoreAsset(
  symbol: string,
  tier: "major" | "alt" | "meme",
): Promise<UniverseAssetScore> {
  const reasonCodes: string[] = [];
  let blocked = false;

  try {
    const { snapshot, quality } = await evaluateMarketDataQuality(symbol, {
      requiresOrderBook: true,
    });

    if (!quality.liveRequirementsMet) {
      blocked = true;
      reasonCodes.push(...quality.reasonCodes);
    }

    if (snapshot.ticker.spreadBps > 25) {
      blocked = true;
      reasonCodes.push("SPREAD_TOO_WIDE");
    }

    if ((snapshot.liquidityUsd ?? 0) < 500_000) {
      blocked = true;
      reasonCodes.push("LIQUIDITY_TOO_LOW");
    }

    const spreadScore = scoreSpread(snapshot.ticker.spreadBps);
    const liquidityScore = scoreLiquidity(snapshot.liquidityUsd);
    const volumeScore = Math.min(100, (snapshot.relativeVolume ?? 1) * 50);
    const features = computeAllFeatures(snapshot);
    const volatilityScore = features.volatility.compression ? 80 : 60;
    const feeEfficiencyScore = snapshot.feeModel.known ? 100 - snapshot.feeModel.takerBps : 0;
    const slippageScore = scoreSlippage(snapshot.slippageEstimate.bps);
    const fillProbabilityScore = (features.execution.fillProbability ?? 0) * 100;
    const dataQualityScore = quality.tradable ? 100 : quality.liveRequirementsMet ? 60 : 0;

    let totalScore =
      liquidityScore * 0.2 +
      spreadScore * 0.15 +
      volumeScore * 0.1 +
      volatilityScore * 0.1 +
      feeEfficiencyScore * 0.1 +
      slippageScore * 0.15 +
      fillProbabilityScore * 0.1 +
      dataQualityScore * 0.1;

    if (tier === "major") totalScore += MAJOR_PRIORITY_BONUS;
    if (tier === "meme") {
      totalScore -= 30;
      reasonCodes.push("MEME_REQUIRES_SECURITY_CHECK");
      blocked = true;
    }

    totalScore = Math.max(0, Math.min(100, totalScore));

    return {
      symbol,
      tier,
      totalScore,
      liquidityScore,
      spreadScore,
      volumeScore,
      volatilityScore,
      feeEfficiencyScore,
      slippageScore,
      fillProbabilityScore,
      dataQualityScore,
      reasonCodes: [...new Set(reasonCodes)],
      blocked,
    };
  } catch (error) {
    return {
      symbol,
      tier,
      totalScore: 0,
      liquidityScore: 0,
      spreadScore: 0,
      volumeScore: 0,
      volatilityScore: 0,
      feeEfficiencyScore: 0,
      slippageScore: 0,
      fillProbabilityScore: 0,
      dataQualityScore: 0,
      reasonCodes: ["FETCH_FAILED", error instanceof Error ? error.message : "unknown"],
      blocked: true,
    };
  }
}

export async function selectLiquidityUniverse(
  candidates = DEFAULT_CANDIDATES,
): Promise<UniverseSelectionResult> {
  const scores = await Promise.all(
    candidates.map((c) => scoreAsset(c.symbol, c.tier)),
  );

  const sorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);

  const approved_universe = sorted
    .filter((s) => !s.blocked && s.totalScore >= 60)
    .map((s) => s.symbol);

  const blocked_assets = sorted
    .filter((s) => s.blocked)
    .map((s) => ({ symbol: s.symbol, reasonCodes: s.reasonCodes }));

  const watchlist_assets = sorted
    .filter((s) => !s.blocked && s.totalScore >= 45 && s.totalScore < 60)
    .map((s) => ({ symbol: s.symbol, reasonCodes: s.reasonCodes }));

  const best_markets_today = sorted.filter((s) => !s.blocked).slice(0, 3).map((s) => s.symbol);
  const worst_markets_today = sorted.filter((s) => s.blocked).slice(-3).map((s) => s.symbol);

  const reason_codes = [
    ...new Set(sorted.flatMap((s) => s.reasonCodes)),
  ];

  const result: UniverseSelectionResult = {
    approved_universe,
    blocked_assets,
    watchlist_assets,
    reason_codes,
    best_markets_today,
    worst_markets_today,
    scores: sorted,
    updatedAt: new Date().toISOString(),
  };

  await prisma.liquidityUniverseSnapshot.create({
    data: {
      universe: { approved: approved_universe, watchlist: watchlist_assets.map((w) => w.symbol) },
      filters: { minScore: 60, majorBonus: MAJOR_PRIORITY_BONUS },
      dataSource: "kraken+quality_gates",
      capturedAt: new Date(),
    },
  });

  return result;
}

export { DEFAULT_CANDIDATES };
