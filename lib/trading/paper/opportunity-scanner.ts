import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { assessDataQuality } from "@/lib/trading/data/quality-gates";
import { PAPER_CONFIG, type PaperReasonCode } from "@/lib/trading/paper/paper-config";
import {
  SCANNER_CONFIG,
  maxSpreadForTier,
  type CandidateActionType,
  type RiskTier,
} from "@/lib/trading/paper/scanner-config";
import type { UniverseTickerRow } from "@/lib/trading/paper/kraken-universe";
import type { TieredCandidate } from "@/lib/trading/paper/wide-universe";

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
  riskTier: RiskTier;
  shortTermReturnPct: number;
  breakoutScore: number;
  source: string;
  tradableOnConfiguredExchange: boolean;
  action: CandidateAction;
  actionType: CandidateActionType;
  reasonCode: PaperReasonCode | string;
  reasonText: string;
  rank?: number;
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

  if (!snapshot) {
    const changeScore = clamp(Math.abs(tiered.change24hPct) * 2.5);
    const volScore = clamp(Math.log10(Math.max(tiered.volume24hUsd, 1)) * 11);
    const liquidityScore = volScore;
    const pumpRisk = computePumpRiskPenalty(tiered.change24hPct, tiered.volume24hUsd, tiered.spreadBps ?? 999);
    const riskPenalty = computeRiskPenalty(tiered.riskTier, tiered.spreadBps ?? 999, tiered.volume24hUsd);
    const opportunityScore = clamp(changeScore * 0.35 + volScore * 0.35 + liquidityScore * 0.2 - pumpRisk * 0.1 - riskPenalty * 0.1);

    if (!tiered.tradableOnConfiguredExchange) {
      return {
        symbol: tiered.symbol,
        price: tiered.price,
        spreadBps: tiered.spreadBps ?? 0,
        volume24hUsd: tiered.volume24hUsd,
        change24hPct: tiered.change24hPct,
        change1hPct: tiered.change1hPct,
        marketCapUsd: tiered.marketCapUsd,
        momentumScore: changeScore,
        volumeSpikeScore: 50,
        volatilityScore: changeScore,
        liquidityScore,
        spreadScore: 50,
        trendScore: changeScore,
        dataQualityScore: 60,
        riskPenalty,
        pumpRiskPenalty: pumpRisk,
        opportunityScore,
        riskTier: tiered.riskTier,
        shortTermReturnPct: tiered.change1hPct ?? 0,
        breakoutScore: 0,
        source: tiered.source,
        tradableOnConfiguredExchange: false,
        action: "WATCHLIST_ONLY",
        actionType: "WATCHLIST_ONLY",
        reasonCode: "NOT_TRADABLE_ON_EXCHANGE",
        reasonText: "High-momentum coin found, but not tradable on configured exchange.",
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
      momentumScore: changeScore,
      volumeSpikeScore: 50,
      volatilityScore: changeScore,
      liquidityScore,
      spreadScore: 50,
      trendScore: changeScore,
      dataQualityScore: 60,
      riskPenalty,
      pumpRiskPenalty: pumpRisk,
      opportunityScore,
      riskTier: tiered.riskTier,
      shortTermReturnPct: tiered.change1hPct ?? 0,
      breakoutScore: 0,
      source: tiered.source,
      tradableOnConfiguredExchange: true,
      action: "SKIPPED",
      actionType: "SKIPPED",
      reasonCode: "MARKET_DATA_FAILED",
      reasonText: "Awaiting Kraken snapshot for full evaluation",
    };
  }

  return buildScanCandidate({ snapshot, tickerRow: tiered.tickerRow, tiered });
}

export function buildScanCandidate(input: {
  snapshot: NormalizedMarketSnapshot;
  tickerRow?: UniverseTickerRow;
  tiered?: TieredCandidate;
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
  const source = tiered?.source ?? "kraken";
  const maxSpread = maxSpreadForTier(riskTier);

  const quality = assessDataQuality({ snapshot, requiresOrderBook: false });
  const dataQualityScore = quality.tradable
    ? clamp(100 - quality.reasonCodes.length * 15)
    : clamp(40 - quality.reasonCodes.length * 10);

  const mom = momentumFromCandles(snapshot.candles5m);
  const volPct = volatilityPct(snapshot.candles5m);
  const ret = shortTermReturn(snapshot.candles5m);
  const breakout = breakoutScore(snapshot.candles5m);
  const volSpike = volumeSpikeFromSnapshot(snapshot);

  const momentumScore = clamp(Math.abs(mom) * 20 + Math.abs(change24hPct) * 1.5);
  const volatilityScore =
    riskTier === "EXTREME_RISK" || riskTier === "HIGH_VOLATILITY"
      ? clamp(Math.abs(change24hPct) * 2 + volPct * 8)
      : volPct >= 0.3 && volPct <= 8
        ? clamp(100 - Math.abs(volPct - 2) * 15)
        : clamp(volPct * 10);
  const liquidityScore = clamp(Math.log10(Math.max(volume24hUsd, 1)) * 11);
  const spreadScore = clamp(100 - spreadBps * (riskTier === "MAJOR" ? 2.5 : 1.5));
  const trendScore = clamp(Math.abs(ret) * 20 + Math.abs(change1hPct ?? 0) * 3);
  const pumpRiskPenalty = computePumpRiskPenalty(change24hPct, volume24hUsd, spreadBps);
  const riskPenalty = computeRiskPenalty(riskTier, spreadBps, volume24hUsd);

  const opportunityScore = clamp(
    momentumScore * 0.2 +
      volumeSpikeScore(volSpike) * 0.15 +
      liquidityScore * 0.2 +
      spreadScore * 0.15 +
      volatilityScore * 0.1 +
      trendScore * 0.1 +
      dataQualityScore * 0.05 +
      breakout * 0.05 -
      riskPenalty * 0.15 -
      pumpRiskPenalty * 0.1,
  );

  let reasonCode: PaperReasonCode | string = "SCORE_TOO_LOW";
  let reasonText = "Awaiting evaluation";
  let action: CandidateAction = "SKIPPED";
  let actionType: CandidateActionType = "SKIPPED";

  if (!tradable) {
    action = "WATCHLIST_ONLY";
    actionType = "WATCHLIST_ONLY";
    reasonCode = "NOT_TRADABLE_ON_EXCHANGE";
    reasonText = "High-momentum coin found, but not tradable on configured exchange.";
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
  } else if (volume24hUsd < SCANNER_CONFIG.min24hVolumeUsd) {
    reasonCode = "VOLUME_TOO_LOW";
    reasonText = `24h volume $${volume24hUsd.toFixed(0)} below minimum`;
    actionType = "REJECTED";
  } else if (spreadBps > maxSpread) {
    reasonCode = "SPREAD_TOO_WIDE";
    reasonText = `Spread ${spreadBps.toFixed(1)} bps exceeds tier max ${maxSpread}`;
    actionType = "REJECTED";
  } else if (liquidityScore < PAPER_CONFIG.minLiquidityScore && riskTier === "MAJOR") {
    reasonCode = "LIQUIDITY_TOO_LOW";
    reasonText = `Liquidity score ${liquidityScore.toFixed(0)} below ${PAPER_CONFIG.minLiquidityScore}`;
    actionType = "REJECTED";
  } else if (
    riskTier === "MAJOR" &&
    volPct > 6 &&
    Math.abs(change24hPct) < SCANNER_CONFIG.min24hChangePct
  ) {
    reasonCode = "VOLATILITY_TOO_LOW";
    reasonText = `Volatility ${volPct.toFixed(2)}% too low — no movement`;
    actionType = "REJECTED";
  } else if (pumpRiskPenalty >= 40) {
    reasonCode = "PUMP_RISK_TOO_HIGH";
    reasonText = `Suspicious pump behavior — penalty ${pumpRiskPenalty.toFixed(0)}`;
    actionType = "REJECTED";
  } else if (opportunityScore < PAPER_CONFIG.minOpportunityScore && riskTier === "MAJOR") {
    reasonCode = "SCORE_TOO_LOW";
    reasonText = `Opportunity score ${opportunityScore.toFixed(0)} below ${PAPER_CONFIG.minOpportunityScore}`;
    actionType = "REJECTED";
  } else if (Math.abs(change24hPct) < SCANNER_CONFIG.min24hChangePct && riskTier !== "MAJOR" && mom < 0.05) {
    reasonCode = "VOLATILITY_TOO_LOW";
    reasonText = `24h change ${change24hPct.toFixed(1)}% below min ${SCANNER_CONFIG.min24hChangePct}%`;
    actionType = "REJECTED";
  } else {
    action = "OPEN_TRADE";
    actionType = "OPEN_PAPER_TRADE";
    reasonCode = "TRADE_OPENED";
    reasonText =
      riskTier === "EXTREME_RISK"
        ? `EXTREME_RISK_PAPER_ONLY — score ${opportunityScore.toFixed(0)}, 24h ${change24hPct.toFixed(1)}%`
        : `Opportunity score ${opportunityScore.toFixed(0)} — ${riskTier}, 24h ${change24hPct.toFixed(1)}%`;
  }

  if (action !== "OPEN_TRADE" && action !== "WATCHLIST_ONLY") {
    action = "NO_TRADE";
  }

  return {
    symbol: snapshot.symbol,
    price,
    spreadBps,
    volume24hUsd,
    change24hPct,
    change1hPct,
    marketCapUsd,
    momentumScore,
    volumeSpikeScore: volSpike,
    volatilityScore,
    liquidityScore,
    spreadScore,
    trendScore,
    dataQualityScore,
    riskPenalty,
    pumpRiskPenalty,
    opportunityScore,
    riskTier,
    shortTermReturnPct: ret,
    breakoutScore: breakout,
    source,
    tradableOnConfiguredExchange: tradable,
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
