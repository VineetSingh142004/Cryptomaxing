import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { assessDataQuality } from "@/lib/trading/data/quality-gates";
import type { ExchangeAvailabilityResult } from "@/lib/trading/exchange/availability-types";
import { isConfirmedTradable, isUnconfirmedTradable } from "@/lib/trading/exchange/availability-types";
import { PAPER_CONFIG, type PaperReasonCode } from "@/lib/trading/paper/paper-config";
import {
  SCANNER_CONFIG,
  maxSpreadForTier,
  type CandidateActionType,
  type RiskTier,
} from "@/lib/trading/paper/scanner-config";
import type { UniverseTickerRow } from "@/lib/trading/paper/kraken-universe";
import type { TieredCandidate } from "@/lib/trading/paper/wide-universe";
import { sanitizeChange24hPct, shouldExcludeFromScoring } from "@/lib/trading/paper/field-sanitization";
import {
  computeStrategyFeatureScores,
  type StrategyScoreStatus,
} from "@/lib/trading/paper/strategy-score-state";
import { computeWeightedScore, type ScoreBreakdown } from "@/lib/trading/paper/scoring";
import { evaluateTradeSelection } from "@/lib/trading/paper/trade-selection";

export type CandidateAction = "OPEN_TRADE" | "NO_TRADE" | "SKIPPED" | "WATCHLIST_ONLY";

export interface ScanCandidate {
  symbol: string;
  price: number;
  spreadBps: number;
  volume24hUsd: number;
  change24hPct: number;
  change1hPct: number | null;
  marketCapUsd: number | null;
  momentumScore: number;
  volumeSpikeScore: number;
  volatilityScore: number;
  liquidityScore: number;
  spreadScore: number;
  trendScore: number;
  dataQualityScore: number;
  riskPenalty: number;
  pumpRiskPenalty: number;
  opportunityScore: number;
  scoreBreakdown: ScoreBreakdown;
  riskTier: RiskTier;
  shortTermReturnPct: number;
  breakoutScore: number;
  breakoutScoreStatus?: StrategyScoreStatus;
  trendScoreStatus?: StrategyScoreStatus;
  discoveryOnly?: boolean;
  providerAnomalyFlags?: string[];
  change24hRaw?: number;
  change24hDrivesScore?: boolean;
  profitQualityScore?: number | null;
  source: string;
  tradableOnConfiguredExchange: boolean;
  availability: ExchangeAvailabilityResult;
  change7dPct?: number | null;
  coinName?: string;
  action: CandidateAction;
  actionType: CandidateActionType;
  reasonCode: PaperReasonCode | string;
  reasonText: string;
  rank?: number;
  candleCount?: number;
  candlesLoaded?: boolean;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function momentumFromCandles(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 6) return 0;
  const recent = candles.slice(-6);
  const first = recent.slice(0, 3).reduce((s, c) => s + c.close, 0) / 3;
  const second = recent.slice(3).reduce((s, c) => s + c.close, 0) / 3;
  if (first <= 0) return 0;
  return ((second - first) / first) * 100;
}

function volatilityPct(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 5) return 0;
  const recent = candles.slice(-5);
  const maxHigh = Math.max(...recent.map((c) => c.high));
  const minLow = Math.min(...recent.map((c) => c.low));
  const mid = (maxHigh + minLow) / 2;
  if (mid <= 0) return 0;
  return ((maxHigh - minLow) / mid) * 100;
}

function shortTermReturn(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 3) return 0;
  const last = candles.at(-1)?.close ?? 0;
  const prev = candles.at(-4)?.close ?? last;
  if (prev <= 0) return 0;
  return ((last - prev) / prev) * 100;
}

function breakoutScore(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 10) return 0;
  const recent = candles.slice(-10);
  const highs = recent.map((c) => c.high);
  const lastClose = recent.at(-1)?.close ?? 0;
  const priorHigh = Math.max(...highs.slice(0, -1));
  if (priorHigh <= 0) return 0;
  return clamp(((lastClose - priorHigh) / priorHigh) * 1000);
}

function volumeSpikeFromSnapshot(snapshot: NormalizedMarketSnapshot): number {
  const rel = snapshot.relativeVolume;
  if (rel === null || rel === undefined) return 50;
  if (rel >= 3) return 95;
  if (rel >= 2) return 80;
  if (rel >= 1.5) return 65;
  if (rel >= 1) return 50;
  return clamp(rel * 40);
}

function computePumpRiskPenalty(change24hPct: number, volume24hUsd: number, spreadBps: number): number {
  let penalty = 0;
  const absChange = Math.abs(change24hPct);
  if (absChange >= 50 && volume24hUsd < 2_000_000) penalty += 30;
  if (absChange >= 30 && spreadBps > 100) penalty += 25;
  if (absChange >= 20 && volume24hUsd < 500_000) penalty += 20;
  return clamp(penalty);
}

function computeRiskPenalty(tier: RiskTier, spreadBps: number, volume24hUsd: number): number {
  let penalty = 0;
  if (tier === "EXTREME_RISK") penalty += 25;
  if (tier === "HIGH_VOLATILITY") penalty += 10;
  if (spreadBps > maxSpreadForTier(tier)) penalty += 20;
  if (volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) penalty += 30;
  return clamp(penalty);
}

export function quickScoreFromTicker(row: UniverseTickerRow): number {
  const spreadScore = clamp(100 - row.spreadBps * 2);
  const volScore = clamp(Math.log10(Math.max(row.volume24hUsd, 1)) * 12);
  return spreadScore * 0.35 + volScore * 0.65;
}

export function quickScoreFromTiered(row: TieredCandidate): number {
  const changeScore = clamp(Math.abs(row.change24hPct) * 3);
  const volScore = clamp(Math.log10(Math.max(row.volume24hUsd, 1)) * 12);
  const spreadBonus = row.spreadBps !== null ? clamp(100 - row.spreadBps) : 50;
  return changeScore * 0.4 + volScore * 0.35 + spreadBonus * 0.25;
}

export function buildScanCandidateFromTiered(input: {
  tiered: TieredCandidate;
  snapshot?: NormalizedMarketSnapshot | null;
}): ScanCandidate {
  const { tiered } = input;
  const snapshot = input.snapshot;
  const availability = tiered.availability;
  const unconfirmed = isUnconfirmedTradable(availability);
  const confirmed = isConfirmedTradable(availability);

  if (!snapshot) {
    const changeSan = sanitizeChange24hPct(tiered.change24hPct);
    const pumpRisk = computePumpRiskPenalty(changeSan.value, tiered.volume24hUsd, tiered.spreadBps ?? 999);
    const riskPenalty = computeRiskPenalty(tiered.riskTier, tiered.spreadBps ?? 999, tiered.volume24hUsd);
    const discoveryOnly = tiered.source === "coingecko" && !confirmed;
    const anomalyFlags = changeSan.outlier ? ["DATA_OUTLIER_SANITIZED"] : [];
    const scoreBreakdown = computeWeightedScore({
      volume24hUsd: tiered.volume24hUsd,
      change24hPct: changeSan.outlier ? 0 : changeSan.value,
      change1hPct: tiered.change1hPct,
      marketCapUsd: tiered.marketCapUsd,
      spreadBps: tiered.spreadBps ?? 50,
      momentumPct: (tiered.change1hPct ?? 0) || changeSan.value * 0.05,
      volatilityPct: Math.abs(changeSan.value),
      shortTermReturnPct: tiered.change1hPct ?? 0,
      breakoutScore: 0,
      volumeSpikeScore: 50,
      dataQualityScore: changeSan.outlier ? 30 : 60,
      riskTier: tiered.riskTier,
      availability,
      pumpRiskPenalty: pumpRisk,
      riskTierPenalty: riskPenalty,
    });
    const opportunityScore = changeSan.outlier || shouldExcludeFromScoring(changeSan)
      ? Math.min(scoreBreakdown.finalScore, 40)
      : scoreBreakdown.finalScore;

    if (!confirmed || discoveryOnly) {
      return {
        symbol: tiered.symbol,
        price: tiered.price,
        spreadBps: tiered.spreadBps ?? 0,
        volume24hUsd: tiered.volume24hUsd,
        change24hPct: changeSan.value,
        change24hRaw: changeSan.rawValue,
        change1hPct: tiered.change1hPct,
        change7dPct: tiered.change7dPct ?? null,
        marketCapUsd: tiered.marketCapUsd,
        momentumScore: scoreBreakdown.momentumScore,
        volumeSpikeScore: 50,
        volatilityScore: scoreBreakdown.volatilityScore,
        liquidityScore: scoreBreakdown.liquidityScore,
        spreadScore: scoreBreakdown.spreadScore,
        trendScore: scoreBreakdown.trendStrengthScore,
        trendScoreStatus: "NOT_COMPUTED",
        dataQualityScore: scoreBreakdown.dataQualityScore,
        riskPenalty,
        pumpRiskPenalty: pumpRisk,
        opportunityScore,
        scoreBreakdown,
        riskTier: tiered.riskTier,
        shortTermReturnPct: tiered.change1hPct ?? 0,
        breakoutScore: 0,
        breakoutScoreStatus: "NOT_COMPUTED",
        discoveryOnly: true,
        providerAnomalyFlags: anomalyFlags,
        change24hDrivesScore: changeSan.outlier,
        source: tiered.source,
        tradableOnConfiguredExchange: false,
        availability,
        coinName: tiered.name,
        action: "WATCHLIST_ONLY",
        actionType: "WATCHLIST_ONLY",
        reasonCode: unconfirmed
          ? "EXCHANGE_AVAILABILITY_UNKNOWN"
          : changeSan.outlier
            ? "DATA_OUTLIER_SANITIZED"
            : tiered.source === "coingecko"
              ? "COINGECKO_DISCOVERY_ONLY_NOT_TRADEABLE"
              : "NOT_TRADABLE_ON_EXCHANGE",
        reasonText:
          changeSan.outlier
            ? `Provider 24h change outlier (${changeSan.rawValue.toFixed(0)}%) — watchlist only`
            : availability.availabilityNote ??
              (unconfirmed
                ? "Detected by CoinGecko — Kraken tradability not confirmed. Discovery/watchlist only."
                : "High-momentum coin found, but not tradable on configured exchange."),
        candleCount: 0,
        candlesLoaded: false,
      };
    }

    return {
      symbol: tiered.symbol,
      price: tiered.price,
      spreadBps: tiered.spreadBps ?? 0,
      volume24hUsd: tiered.volume24hUsd,
      change24hPct: tiered.change24hPct,
      change1hPct: tiered.change1hPct,
      marketCapUsd: tiered.marketCapUsd,
      momentumScore: scoreBreakdown.momentumScore,
      volumeSpikeScore: 50,
      volatilityScore: scoreBreakdown.volatilityScore,
      liquidityScore: scoreBreakdown.liquidityScore,
      spreadScore: scoreBreakdown.spreadScore,
      trendScore: scoreBreakdown.trendStrengthScore,
      dataQualityScore: scoreBreakdown.dataQualityScore,
      riskPenalty,
      pumpRiskPenalty: pumpRisk,
      opportunityScore,
      scoreBreakdown,
      riskTier: tiered.riskTier,
      shortTermReturnPct: tiered.change1hPct ?? 0,
      breakoutScore: 0,
      source: tiered.source,
      tradableOnConfiguredExchange: true,
      availability,
      coinName: tiered.name,
      action: "SKIPPED",
      actionType: "SKIPPED",
      reasonCode: "MARKET_DATA_FAILED",
      reasonText: "Awaiting Kraken snapshot for full evaluation",
      candleCount: 0,
      candlesLoaded: false,
    };
  }

  return buildScanCandidate({ snapshot, tickerRow: tiered.tickerRow, tiered });
}

export function buildScanCandidate(input: {
  snapshot: NormalizedMarketSnapshot;
  tickerRow?: UniverseTickerRow;
  tiered?: TieredCandidate;
  recordCaution?: {
    active: boolean;
    minScoreBoost: number;
    blockHighVolAlts: boolean;
  };
}): ScanCandidate {
  const { snapshot } = input;
  const tiered = input.tiered;
  const ticker = snapshot.ticker;
  const price = (ticker.bid + ticker.ask) / 2;
  const spreadBps = ticker.spreadBps;
  const volume24hUsd = input.tickerRow?.volume24hUsd ?? ticker.volume24h * price;
  const change24hPct = tiered?.change24hPct ?? 0;
  const change1hPct = tiered?.change1hPct ?? null;
  const marketCapUsd = tiered?.marketCapUsd ?? null;
  const riskTier = tiered?.riskTier ?? "ALT_LIQUID";
  const tradable = tiered?.tradableOnConfiguredExchange ?? true;
  const availability =
    tiered?.availability ??
    ({
      listedOnKraken: tradable ? "YES" : "UNKNOWN",
      krakenSpotAvailable: tradable ? "YES" : "UNKNOWN",
      krakenMarginAvailable: "UNKNOWN",
      krakenFuturesAvailable: "UNKNOWN",
      usLeverageAvailable: "UNKNOWN",
      availablePairs: [],
      bestExchange: tradable ? "kraken" : "unknown",
      recommendedAction: tradable ? "SPOT_ONLY" : "UNKNOWN",
      evidenceSource: "snapshot_fallback",
      checkedAt: new Date().toISOString(),
      confidence: "low",
      availabilityNote: null,
    } satisfies ExchangeAvailabilityResult);
  const source = tiered?.source ?? "kraken";
  const maxSpread = maxSpreadForTier(riskTier);

  const changeSan = sanitizeChange24hPct(change24hPct);
  const anomalyFlags = changeSan.outlier ? ["DATA_OUTLIER_SANITIZED"] : [];

  const quality = assessDataQuality({ snapshot, requiresOrderBook: false });
  const dataQualityScore = quality.tradable
    ? clamp(100 - quality.reasonCodes.length * 15)
    : clamp(40 - quality.reasonCodes.length * 10);

  const strategyFeatures = computeStrategyFeatureScores({
    candles: snapshot.candles5m,
    change1hPct,
    trendStrengthFromFormula: undefined,
  });

  const mom = momentumFromCandles(snapshot.candles5m);
  const volPct = volatilityPct(snapshot.candles5m);
  const ret = strategyFeatures.shortTermReturnPct ?? shortTermReturn(snapshot.candles5m);
  const breakout = strategyFeatures.breakoutScore ?? 0;
  const trendVal = strategyFeatures.trendScore ?? 0;
  const volSpike = volumeSpikeFromSnapshot(snapshot);
  const pumpRiskPenalty = computePumpRiskPenalty(changeSan.value, volume24hUsd, spreadBps);
  const riskPenalty = computeRiskPenalty(riskTier, spreadBps, volume24hUsd);

  const scoreBreakdown = computeWeightedScore({
    volume24hUsd,
    change24hPct: changeSan.outlier ? 0 : changeSan.value,
    change1hPct,
    marketCapUsd,
    spreadBps,
    momentumPct: mom,
    volatilityPct: volPct,
    shortTermReturnPct: ret,
    breakoutScore: strategyFeatures.breakoutScoreStatus === "NOT_COMPUTED" ? 0 : breakout,
    volumeSpikeScore: volSpike,
    dataQualityScore,
    riskTier,
    availability,
    pumpRiskPenalty,
    riskTierPenalty: riskPenalty,
  });

  const opportunityScore = changeSan.outlier
    ? Math.min(scoreBreakdown.finalScore, 45)
    : scoreBreakdown.finalScore;

  let reasonCode: PaperReasonCode | string = "SCORE_TOO_LOW";
  let reasonText = "Awaiting evaluation";
  let action: CandidateAction = "SKIPPED";
  let actionType: CandidateActionType = "SKIPPED";

  if (!isConfirmedTradable(availability)) {
    action = "WATCHLIST_ONLY";
    actionType = "WATCHLIST_ONLY";
    reasonCode = isUnconfirmedTradable(availability)
      ? "EXCHANGE_AVAILABILITY_UNKNOWN"
      : "NOT_TRADABLE_ON_EXCHANGE";
    reasonText =
      availability.availabilityNote ??
      (isUnconfirmedTradable(availability)
        ? "Detected by CoinGecko/DexScreener, but not confirmed tradable on connected exchange."
        : "High-momentum coin found, but not tradable on configured exchange.");
  } else if (!ticker.bid || !ticker.ask) {
    reasonCode = "MARKET_DATA_FAILED";
    reasonText = "Missing bid/ask";
    actionType = "REJECTED";
  } else if (quality.reasonCodes.includes("DATA_STALE")) {
    reasonCode = "DATA_STALE";
    reasonText = "Market data stale";
    actionType = "REJECTED";
  } else if (snapshot.candles5m.length < 5) {
    reasonCode = "OHLC_MISSING";
    reasonText = "Insufficient OHLC candles";
    actionType = "REJECTED";
  } else if (strategyFeatures.blockReason === "STRATEGY_SCORING_BLOCKED_NO_CANDLES") {
    reasonCode = "STRATEGY_SCORING_BLOCKED_NO_CANDLES";
    reasonText = "Fewer than 10 candles — breakout/trend NOT_COMPUTED";
    actionType = "REJECTED";
  } else if (changeSan.outlier) {
    reasonCode = "DATA_OUTLIER_SANITIZED";
    reasonText = `Provider 24h change outlier (${changeSan.rawValue.toFixed(0)}%) — excluded from scoring`;
    actionType = "WATCHLIST_ONLY";
    action = "WATCHLIST_ONLY";
  } else if (volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) {
    reasonCode = "VOLUME_TOO_LOW";
    reasonText = `24h volume $${volume24hUsd.toFixed(0)} below minimum`;
    actionType = "REJECTED";
  } else if (spreadBps > maxSpread) {
    reasonCode = "SPREAD_TOO_WIDE";
    reasonText = `Spread ${spreadBps.toFixed(1)} bps exceeds tier max ${maxSpread}`;
    actionType = "REJECTED";
  } else {
    const stopPct = PAPER_CONFIG.stopLossBps / 10_000;
    const tpPct = PAPER_CONFIG.takeProfitBps / 10_000;
    const hasExitPlan = tpPct / stopPct >= 1.05;
    const selection = evaluateTradeSelection({
      breakdown: scoreBreakdown,
      availability,
      riskTier,
      spreadBps,
      volume24hUsd,
      change24hPct,
      change1hPct,
      momentumPct: mom,
      hasExitPlan,
      entryPrice: price,
      pumpRiskPenalty,
      momentumScore: scoreBreakdown.momentumScore,
      volumeSpikeScore: volSpike,
      shortTermReturnPct: ret,
      tradableOnConfiguredExchange: tradable,
      recordCaution: input.recordCaution,
    });
    if (selection.shouldOpen) {
      action = "OPEN_TRADE";
      actionType = "OPEN_PAPER_TRADE";
      reasonCode = selection.reasonCode;
      reasonText = selection.reasonText;
    } else if (selection.recommendation === "AVOID") {
      action = "NO_TRADE";
      actionType = "REJECTED";
      reasonCode = selection.reasonCode;
      reasonText = selection.reasonText;
    } else if (!isConfirmedTradable(availability)) {
      action = "WATCHLIST_ONLY";
      actionType = "WATCHLIST_ONLY";
      reasonCode = selection.reasonCode;
      reasonText = selection.reasonText;
    } else {
      action = "NO_TRADE";
      actionType = "REJECTED";
      reasonCode = selection.reasonCode;
      reasonText = selection.reasonText;
    }
  }

  if (action !== "OPEN_TRADE" && action !== "WATCHLIST_ONLY") {
    action = "NO_TRADE";
  }

  const momentumScore = scoreBreakdown.momentumScore;
  const volatilityScore = scoreBreakdown.volatilityScore;
  const liquidityScore = scoreBreakdown.liquidityScore;
  const spreadScore = scoreBreakdown.spreadScore;
  const trendScore = strategyFeatures.trendScoreStatus === "NOT_COMPUTED" ? 0 : trendVal;

  return {
    symbol: snapshot.symbol,
    price,
    spreadBps,
    volume24hUsd,
    change24hPct: changeSan.value,
    change24hRaw: changeSan.rawValue,
    change1hPct,
    marketCapUsd,
    momentumScore,
    volumeSpikeScore: volSpike,
    volatilityScore,
    liquidityScore,
    spreadScore,
    trendScore,
    trendScoreStatus: strategyFeatures.trendScoreStatus,
    dataQualityScore,
    riskPenalty,
    pumpRiskPenalty,
    opportunityScore,
    scoreBreakdown,
    riskTier,
    shortTermReturnPct: ret,
    breakoutScore: breakout,
    breakoutScoreStatus: strategyFeatures.breakoutScoreStatus,
    discoveryOnly: source === "coingecko" && !isConfirmedTradable(availability),
    providerAnomalyFlags: anomalyFlags,
    change24hDrivesScore: changeSan.outlier,
    source,
    tradableOnConfiguredExchange: isConfirmedTradable(availability),
    availability,
    candleCount: snapshot.candles5m.length,
    candlesLoaded: snapshot.candles5m.length >= 10,
    change7dPct: tiered?.change7dPct ?? null,
    coinName: tiered?.name,
    action,
    actionType,
    reasonCode,
    reasonText,
  };
}

function volumeSpikeScore(volSpike: number): number {
  return clamp(volSpike);
}

export function rankCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  return [...candidates]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export function summarizeRejections(candidates: ScanCandidate[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const c of candidates) {
    if (c.action === "NO_TRADE" || c.action === "SKIPPED" || c.action === "WATCHLIST_ONLY") {
      summary[c.reasonCode] = (summary[c.reasonCode] ?? 0) + 1;
    }
  }
  return summary;
}

export function splitCandidates(candidates: ScanCandidate[]): {
  tradablePaperCandidates: ScanCandidate[];
  watchlistOnlyCandidates: ScanCandidate[];
  rejectedCandidates: ScanCandidate[];
  highVolatilityCandidates: ScanCandidate[];
} {
  return {
    tradablePaperCandidates: candidates.filter((c) => c.action === "OPEN_TRADE"),
    watchlistOnlyCandidates: candidates.filter((c) => c.action === "WATCHLIST_ONLY"),
    rejectedCandidates: candidates.filter((c) => c.action === "NO_TRADE" || c.action === "SKIPPED"),
    highVolatilityCandidates: candidates.filter(
      (c) => c.riskTier === "HIGH_VOLATILITY" || c.riskTier === "EXTREME_RISK",
    ),
  };
}

/** Merge duplicate symbols — keep best score and combined sources. */
export function dedupeScanCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  const bySymbol = new Map<string, ScanCandidate>();
  for (const c of candidates) {
    const existing = bySymbol.get(c.symbol);
    if (!existing) {
      bySymbol.set(c.symbol, c);
      continue;
    }
    const winner = c.opportunityScore >= existing.opportunityScore ? c : existing;
    const loser = winner === c ? existing : c;
    bySymbol.set(c.symbol, {
      ...winner,
      source: existing.source !== c.source ? `${existing.source},${c.source}` : winner.source,
      tradableOnConfiguredExchange:
        winner.tradableOnConfiguredExchange || loser.tradableOnConfiguredExchange,
    });
  }
  return Array.from(bySymbol.values());
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
