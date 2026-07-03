import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";
import { assessDataQuality } from "@/lib/trading/data/quality-gates";

export const PAPER_STRATEGY_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"] as const;
export const CONSERVATIVE_PAPER_STRATEGY = "conservative-paper-v1" as const;

const MAX_SPREAD_BPS = 25;
const MAX_VOLATILITY_PCT = 2.5;
const MIN_CONFIDENCE = 0.55;
const SIMULATED_RISK_PCT = 0.5;
const STOP_PCT = 1.0;
const TAKE_PROFIT_PCT = 2.0;
const SIMULATED_ACCOUNT_USD = 10_000;

export type StrategyDecision = "LONG" | "SHORT" | "NO_TRADE";

export interface ConservativeStrategyResult {
  decision: StrategyDecision;
  confidence: number;
  reason: string;
  entryPrice: number | null;
  plannedStopLoss: number | null;
  plannedTakeProfit: number | null;
  simulatedSize: number | null;
  riskAmount: number | null;
  riskPercent: number;
  blockReasons: string[];
}

function candleVolatilityPct(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 5) return 0;
  const recent = candles.slice(-5);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const mid = (maxHigh + minLow) / 2;
  if (mid <= 0) return 0;
  return ((maxHigh - minLow) / mid) * 100;
}

function momentumScore(candles: NormalizedMarketSnapshot["candles5m"]): number {
  if (candles.length < 6) return 0;
  const recent = candles.slice(-6);
  const firstHalf = recent.slice(0, 3).reduce((s, c) => s + c.close, 0) / 3;
  const secondHalf = recent.slice(3).reduce((s, c) => s + c.close, 0) / 3;
  if (firstHalf <= 0) return 0;
  return ((secondHalf - firstHalf) / firstHalf) * 100;
}

export function evaluateConservativePaperStrategy(
  snapshot: NormalizedMarketSnapshot,
): ConservativeStrategyResult {
  const blockReasons: string[] = [];
  const quality = assessDataQuality({ snapshot, requiresOrderBook: false });

  if (!snapshot.ticker.bid || !snapshot.ticker.ask || snapshot.ticker.bid <= 0 || snapshot.ticker.ask <= 0) {
    blockReasons.push("MISSING_BID_ASK");
  }

  if (quality.reasonCodes.includes("DATA_STALE")) {
    blockReasons.push("DATA_STALE");
  }

  if (snapshot.ticker.spreadBps > MAX_SPREAD_BPS) {
    blockReasons.push("SPREAD_TOO_WIDE");
  }

  const volPct = candleVolatilityPct(snapshot.candles5m);
  if (volPct > MAX_VOLATILITY_PCT) {
    blockReasons.push("EXTREME_VOLATILITY");
  }

  if (!quality.tradable) {
    blockReasons.push(...quality.reasonCodes.slice(0, 3));
  }

  if (blockReasons.length > 0) {
    return {
      decision: "NO_TRADE",
      confidence: 0,
      reason: blockReasons.join(", "),
      entryPrice: null,
      plannedStopLoss: null,
      plannedTakeProfit: null,
      simulatedSize: null,
      riskAmount: null,
      riskPercent: SIMULATED_RISK_PCT,
      blockReasons,
    };
  }

  const mid = (snapshot.ticker.bid + snapshot.ticker.ask) / 2;
  const momentum = momentumScore(snapshot.candles5m);
  const absMomentum = Math.abs(momentum);

  let decision: StrategyDecision = "NO_TRADE";
  if (momentum > 0.15) decision = "LONG";
  else if (momentum < -0.15) decision = "SHORT";

  const confidence = Math.min(0.95, 0.45 + absMomentum * 0.08);

  if (decision === "NO_TRADE" || confidence < MIN_CONFIDENCE) {
    return {
      decision: "NO_TRADE",
      confidence,
      reason: decision === "NO_TRADE" ? "LOW_MOMENTUM" : "LOW_CONFIDENCE",
      entryPrice: null,
      plannedStopLoss: null,
      plannedTakeProfit: null,
      simulatedSize: null,
      riskAmount: null,
      riskPercent: SIMULATED_RISK_PCT,
      blockReasons: decision === "NO_TRADE" ? ["LOW_MOMENTUM"] : ["LOW_CONFIDENCE"],
    };
  }

  const riskAmount = SIMULATED_ACCOUNT_USD * (SIMULATED_RISK_PCT / 100);
  const stopDistance = mid * (STOP_PCT / 100);
  const simulatedSize = stopDistance > 0 ? riskAmount / stopDistance : null;

  const plannedStopLoss =
    decision === "LONG" ? mid * (1 - STOP_PCT / 100) : mid * (1 + STOP_PCT / 100);
  const plannedTakeProfit =
    decision === "LONG" ? mid * (1 + TAKE_PROFIT_PCT / 100) : mid * (1 - TAKE_PROFIT_PCT / 100);

  return {
    decision,
    confidence,
    reason: `Conservative ${decision.toLowerCase()} — momentum ${momentum.toFixed(3)}%`,
    entryPrice: mid,
    plannedStopLoss,
    plannedTakeProfit,
    simulatedSize,
    riskAmount,
    riskPercent: SIMULATED_RISK_PCT,
    blockReasons: [],
  };
}

export const PAPER_TRADE_EXPIRY_HOURS = 48;
