import type { NormalizedOrderBook } from "@/lib/trading/data/types";
import type { MicrostructureEdgeResult, ScanContext, ScanDirection } from "@/lib/trading/scanning/types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function bookDepthUsd(book: NormalizedOrderBook): number {
  const bid = book.bids.reduce((s, l) => s + l.price * l.size, 0);
  const ask = book.asks.reduce((s, l) => s + l.price * l.size, 0);
  return bid + ask;
}

function imbalance(book: NormalizedOrderBook): number {
  const bid = book.bids.reduce((s, l) => s + l.price * l.size, 0);
  const ask = book.asks.reduce((s, l) => s + l.price * l.size, 0);
  const total = bid + ask;
  return total > 0 ? (bid - ask) / total : 0;
}

function wallConcentration(book: NormalizedOrderBook, side: "bid" | "ask"): number {
  const levels = side === "bid" ? book.bids : book.asks;
  const total = levels.reduce((s, l) => s + l.price * l.size, 0);
  if (total === 0) return 0;
  const max = Math.max(...levels.map((l) => l.price * l.size));
  return max / total;
}

export function analyzeMicrostructureEdge(
  ctx: ScanContext,
  strategyDirection: ScanDirection,
): MicrostructureEdgeResult {
  const book = ctx.snapshot.orderBook;
  const prior = ctx.priorOrderBook;
  const ob = ctx.features.orderBook;
  const reasonCodes: string[] = [];

  if (!book || !ob) {
    return {
      symbol: ctx.snapshot.symbol,
      direction: strategyDirection,
      scores: {
        bid_ask_imbalance_persistence: 50,
        depth_change_score: 50,
        liquidity_wall_movement: 50,
        book_thinning_before_breakout: 50,
        spoofing_suspicion: 0,
        aggressive_pressure_score: 50,
        spread_compression_score: 50,
        absorption_score: 50,
        stop_run_likelihood: 30,
        exit_depth_quality: 40,
        microstructure_edge_score: 45,
      },
      tradeScoreModifier: -10,
      decision: "NEUTRAL",
      reasonCodes: ["ORDER_BOOK_MISSING"],
      canTradeAlone: false,
      analyzedAt: new Date().toISOString(),
    };
  }

  const currentImb = imbalance(book);
  const priorImb = prior ? imbalance(prior) : currentImb;
  const imbSign = strategyDirection === "long" ? 1 : strategyDirection === "short" ? -1 : 0;

  const bid_ask_imbalance_persistence = clamp(
    50 + (currentImb * imbSign > 0 ? Math.abs(currentImb) * 50 : -Math.abs(currentImb) * 30) +
      (Math.sign(currentImb) === Math.sign(priorImb) ? 10 : -10),
  );

  const depthNow = bookDepthUsd(book);
  const depthPrior = prior ? bookDepthUsd(prior) : depthNow;
  const depthDelta = depthPrior > 0 ? (depthNow - depthPrior) / depthPrior : 0;
  const depth_change_score = clamp(50 + depthDelta * 100);

  const bidWallNow = wallConcentration(book, "bid");
  const askWallNow = wallConcentration(book, "ask");
  const bidWallPrior = prior ? wallConcentration(prior, "bid") : bidWallNow;
  const askWallPrior = prior ? wallConcentration(prior, "ask") : askWallNow;
  const wallMove =
    strategyDirection === "long"
      ? bidWallNow - bidWallPrior - (askWallNow - askWallPrior)
      : askWallNow - askWallPrior - (bidWallNow - bidWallPrior);
  const liquidity_wall_movement = clamp(50 + wallMove * 80);

  const book_thinning_before_breakout =
    ob.bookThinning && ctx.features.volatility.expansion ? 35 : ob.bookThinning ? 45 : 70;

  const spoofing_suspicion = clamp(ob.spoofingSuspicion * 100 + (ob.liquidityWalls ? 15 : 0));
  if (spoofing_suspicion > 60) reasonCodes.push("SPOOFING_SUSPECTED");

  const spread_compression_score = clamp(
    70 - (ctx.snapshot.ticker.spreadBps / 25) * 40,
  );
  if (ctx.snapshot.ticker.spreadBps > 18) reasonCodes.push("SPREAD_EXPANSION");

  const aggressive_pressure_score = clamp(
    50 + currentImb * imbSign * 60,
  );

  const absorption_score = clamp(
    50 +
      (ctx.features.volume.relativeVolume ?? 1) * 10 -
      (ctx.features.price.wickRejection > 0.5 ? 15 : 0),
  );

  const stop_run_likelihood = clamp(
    ctx.features.price.wickRejection * 60 +
      (ob.liquidityWalls ? 20 : 0) +
      (Math.abs(currentImb) < 0.05 ? 10 : 0),
  );

  const exit_depth_quality = clamp(
    Math.min(ob.depth25Bps / 50_000, 1) * 80 + (ob.bookThinning ? -20 : 10),
  );

  const microstructure_edge_score = clamp(
    bid_ask_imbalance_persistence * 0.15 +
      depth_change_score * 0.1 +
      liquidity_wall_movement * 0.1 +
      spread_compression_score * 0.1 +
      aggressive_pressure_score * 0.15 +
      absorption_score * 0.1 +
      exit_depth_quality * 0.15 +
      (100 - spoofing_suspicion) * 0.1 +
      (100 - stop_run_likelihood) * 0.05,
  );

  let tradeScoreModifier = 0;
  if (microstructure_edge_score >= 65) tradeScoreModifier += 8;
  else if (microstructure_edge_score >= 55) tradeScoreModifier += 4;
  else if (microstructure_edge_score < 45) tradeScoreModifier -= 8;

  if (spoofing_suspicion > 65) tradeScoreModifier -= 20;
  if (spread_compression_score < 40) tradeScoreModifier -= 10;
  if (book_thinning_before_breakout < 40) tradeScoreModifier -= 8;

  const contradicts =
    (strategyDirection === "long" && currentImb < -0.12) ||
    (strategyDirection === "short" && currentImb > 0.12);

  let decision: MicrostructureEdgeResult["decision"] = "NEUTRAL";
  if (spoofing_suspicion > 70) {
    decision = "BLOCK";
    reasonCodes.push("AVOID_SPOOFING");
  } else if (contradicts) {
    decision = "CONTRADICT";
    reasonCodes.push("BOOK_CONTRADICTS_STRATEGY");
    tradeScoreModifier -= 15;
  } else if (microstructure_edge_score >= 60 && imbSign !== 0 && currentImb * imbSign > 0) {
    decision = "SUPPORT";
  }

  return {
    symbol: ctx.snapshot.symbol,
    direction: strategyDirection,
    scores: {
      bid_ask_imbalance_persistence,
      depth_change_score,
      liquidity_wall_movement,
      book_thinning_before_breakout,
      spoofing_suspicion,
      aggressive_pressure_score,
      spread_compression_score,
      absorption_score,
      stop_run_likelihood,
      exit_depth_quality,
      microstructure_edge_score,
    },
    tradeScoreModifier,
    decision,
    reasonCodes,
    canTradeAlone: false,
    analyzedAt: new Date().toISOString(),
  };
}
