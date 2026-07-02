import type { ScanContext, ExplosiveMoveScanResult, ScanDirection } from "@/lib/trading/scanning/types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function inferDirection(ctx: ScanContext): ScanDirection {
  if (ctx.direction && ctx.direction !== "neutral") return ctx.direction;
  const { price, volume, orderBook } = ctx.features;
  let bias = 0;
  if ((price.vwapDistance ?? 0) > 0) bias += 1;
  if ((price.ema9Distance ?? 0) > (price.ema20Distance ?? 0)) bias += 1;
  if ((volume.relativeVolume ?? 1) > 1.2 && (price.return1m ?? 0) > 0) bias += 1;
  if (orderBook && orderBook.bidAskImbalance > 0.05) bias += 1;
  if ((price.return1m ?? 0) < -0.05) bias -= 2;
  if (orderBook && orderBook.bidAskImbalance < -0.05) bias -= 1;
  if (bias >= 2) return "long";
  if (bias <= -2) return "short";
  return "neutral";
}

function emaAlignmentScore(direction: ScanDirection, ctx: ScanContext): number {
  const p = ctx.features.price;
  const dists = [p.ema9Distance, p.ema20Distance, p.ema50Distance].filter((d) => d !== null) as number[];
  if (dists.length < 2) return 50;
  if (direction === "long") {
    const aligned = dists.every((d, i) => i === 0 || dists[i - 1]! >= d);
    return aligned ? 85 : dists[0]! > dists[1]! ? 65 : 35;
  }
  if (direction === "short") {
    const aligned = dists.every((d, i) => i === 0 || dists[i - 1]! <= d);
    return aligned ? 85 : dists[0]! < dists[1]! ? 65 : 35;
  }
  return 50;
}

function tightRangeBreakoutScore(ctx: ScanContext): number {
  const vol = ctx.features.volatility;
  const price = ctx.features.price;
  if (!vol.compression) return vol.expansion ? 70 : 45;
  const body = price.candleBodyStrength;
  const move = Math.abs(price.return5m ?? 0);
  return clamp(40 + body * 30 + move * 5);
}

function liquiditySweepScore(direction: ScanDirection, ctx: ScanContext): number {
  const price = ctx.features.price;
  const wick = price.wickRejection;
  const closeLoc = price.candleCloseLocation;
  if (direction === "long" && wick > 0.4 && closeLoc > 0.65) return clamp(60 + wick * 40);
  if (direction === "short" && wick > 0.4 && closeLoc < 0.35) return clamp(60 + wick * 40);
  return 30;
}

function benchmarkAlignmentScore(direction: ScanDirection, ctx: ScanContext): number {
  const r = ctx.features.regime;
  const trends = [r.btcTrend, r.ethTrend, r.solTrend].filter((t) => t !== "NOT_IMPLEMENTED");
  if (trends.length === 0) return 50;
  let aligned = 0;
  for (const t of trends) {
    if (direction === "long" && t === "up") aligned++;
    if (direction === "short" && t === "down") aligned++;
    if (t === "flat") aligned += 0.5;
  }
  return clamp((aligned / trends.length) * 100);
}

function fundingPressureScore(direction: ScanDirection, ctx: ScanContext): number {
  const rate = ctx.snapshot.metadata.fundingRate;
  if (rate === null) return 50;
  if (direction === "long" && rate < 0) return clamp(50 + Math.abs(rate) * 5000);
  if (direction === "short" && rate > 0) return clamp(50 + rate * 5000);
  if (Math.abs(rate) > 0.0005) return 35;
  return 55;
}

export function scanExplosiveMove(ctx: ScanContext): ExplosiveMoveScanResult {
  const direction = inferDirection(ctx);
  const { price, volume, volatility, orderBook, regime } = ctx.features;
  const rejectReasons: string[] = [];
  const signalFlags: string[] = [];

  const momentum_acceleration_score = clamp(
    50 +
      (price.return1m ?? 0) * 8 +
      ((price.return3m ?? 0) - (price.return1m ?? 0)) * 4 +
      (direction === "long" ? (price.return5m ?? 0) : -(price.return5m ?? 0)) * 2,
  );

  const volume_acceleration_score = clamp(
    40 +
      ((volume.relativeVolume ?? 1) - 1) * 35 +
      ((volume.volumeAcceleration ?? 1) - 1) * 25,
  );

  const volatility_expansion_score = clamp(
    volatility.compression && volatility.expansion
      ? 85
      : volatility.expansion
        ? 75
        : volatility.compression
          ? 60
          : 40,
  );

  const breakout_score = clamp(
    (tightRangeBreakoutScore(ctx) + liquiditySweepScore(direction, ctx)) / 2,
  );

  let order_book_pressure_score = 50;
  if (orderBook) {
    const imb = orderBook.bidAskImbalance;
    const wallBias =
      direction === "long"
        ? orderBook.bidWallStrength - orderBook.sellWallStrength
        : orderBook.sellWallStrength - orderBook.bidWallStrength;
    order_book_pressure_score = clamp(
      50 + imb * (direction === "long" ? 40 : -40) + wallBias * 30,
    );
    if (direction === "long" && orderBook.sellWallStrength < 0.25) signalFlags.push("SELL_WALL_REDUCED");
    if (orderBook.bidAskImbalance > 0.1) signalFlags.push("BID_PRESSURE");
  }

  const vwapReclaim =
    direction === "long"
      ? (price.vwapDistance ?? 0) > 0 && (price.return1m ?? 0) > 0
      : (price.vwapDistance ?? 0) < 0 && (price.return1m ?? 0) < 0;
  if (vwapReclaim) signalFlags.push("VWAP_RECLAIM_ACCELERATION");

  if (volatility.compression) signalFlags.push("VOL_COMPRESSION");
  if (volatility.expansion) signalFlags.push("VOL_EXPANSION");
  if ((volume.relativeVolume ?? 0) > 1.5) signalFlags.push("REL_VOLUME_SPIKE");
  if (price.candleBodyStrength > 0.65) signalFlags.push("STRONG_CANDLE");
  if (emaAlignmentScore(direction, ctx) > 70) signalFlags.push("EMA_ALIGNED");
  if (benchmarkAlignmentScore(direction, ctx) > 65) signalFlags.push("BENCHMARK_ALIGNED");
  if (ctx.catalyst) signalFlags.push("CATALYST_PRESENT");

  let fakeout_risk_score = 30;
  if (Math.abs(price.vwapDistance ?? 0) > 1.2) fakeout_risk_score += 25;
  if (volume.volumeFade) fakeout_risk_score += 20;
  if (price.wickRejection > 0.55) fakeout_risk_score += 15;
  if (orderBook?.liquidityWalls) fakeout_risk_score += 10;
  fakeout_risk_score = clamp(fakeout_risk_score);

  let late_entry_risk_score = 20;
  const extension = Math.abs(price.vwapDistance ?? 0);
  if (extension > 0.8) late_entry_risk_score += 30;
  if (extension > 1.5) late_entry_risk_score += 25;
  if ((price.return15m ?? 0) !== null && Math.abs(price.return15m!) > 1.5) late_entry_risk_score += 20;
  if (price.candleBodyStrength > 0.85 && extension > 0.5) late_entry_risk_score += 15;
  late_entry_risk_score = clamp(late_entry_risk_score);

  const upside_air_pocket_score = orderBook
    ? clamp(50 + (1 - orderBook.sellWallStrength) * 40 + orderBook.depth25Bps / 100_000)
    : 45;

  const downside_wick_risk_score = clamp(volatility.wickRisk * 500 + price.wickRejection * 40);

  const explosive_move_score = clamp(
    momentum_acceleration_score * 0.2 +
      volume_acceleration_score * 0.15 +
      volatility_expansion_score * 0.12 +
      breakout_score * 0.15 +
      order_book_pressure_score * 0.12 +
      emaAlignmentScore(direction, ctx) * 0.08 +
      benchmarkAlignmentScore(direction, ctx) * 0.08 +
      fundingPressureScore(direction, ctx) * 0.05 +
      upside_air_pocket_score * 0.05 -
      fakeout_risk_score * 0.15 -
      late_entry_risk_score * 0.1,
  );

  const atrPct =
    ctx.snapshot.ticker.price > 0
      ? (volatility.atr / ctx.snapshot.ticker.price) * 100
      : 0.5;
  const time_to_target_estimate_minutes =
    atrPct > 0 ? clamp((1 / atrPct) * 30, 5, 240) : null;

  if (late_entry_risk_score > 65) rejectReasons.push("LATE_ENTRY");
  if (fakeout_risk_score > 70) rejectReasons.push("FAKEOUT_RISK_HIGH");
  if (volume.volumeFade) rejectReasons.push("FADING_VOLUME");
  if ((ctx.snapshot.ticker.spreadBps ?? 0) > 20) rejectReasons.push("SPREAD_WIDENING");
  if (orderBook?.bookThinning) rejectReasons.push("POOR_EXIT_LIQUIDITY");
  if (upside_air_pocket_score < 35 && downside_wick_risk_score > 60) {
    rejectReasons.push("REWARD_LT_DOWNSIDE_RISK");
  }
  if (price.candleBodyStrength > 0.9 && extension > 1) rejectReasons.push("OVEREXTENDED_CANDLE");
  if (direction === "long" && orderBook && orderBook.sellWallStrength > 0.45) {
    rejectReasons.push("HEAVY_RESISTANCE");
  }
  if (momentum_acceleration_score < 35 && volume_acceleration_score < 40) {
    rejectReasons.push("EXHAUSTED_MOVE");
  }
  if (regime.crashRisk > 70 && direction === "long") rejectReasons.push("MARKET_RISK_OFF");

  let decision: ExplosiveMoveScanResult["decision"] = "NEUTRAL";
  if (rejectReasons.length > 0) decision = "REJECT";
  else if (explosive_move_score >= 65 && direction !== "neutral") decision = "FAVOR";

  return {
    symbol: ctx.snapshot.symbol,
    direction,
    scores: {
      explosive_move_score,
      momentum_acceleration_score,
      volume_acceleration_score,
      volatility_expansion_score,
      breakout_score,
      order_book_pressure_score,
      fakeout_risk_score,
      late_entry_risk_score,
      time_to_target_estimate_minutes,
      upside_air_pocket_score,
      downside_wick_risk_score,
    },
    compositeScore: explosive_move_score,
    decision,
    rejectReasons,
    signalFlags,
    scannedAt: new Date().toISOString(),
  };
}
