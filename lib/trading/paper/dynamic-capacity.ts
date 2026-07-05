import { PAPER_RISK_CONFIG } from "@/lib/trading/paper/paper-risk-config";
import { SCANNER_CONFIG } from "@/lib/trading/paper/scanner-config";

export interface DynamicCapacityInput {
  fixedMaxOpenTrades?: number;
  openTradeCount: number;
  dailyLossPct?: number;
  currentDrawdownPct?: number;
  highQualityOpportunityCount?: number;
  correlatedOpenCount?: number;
  totalExposurePct?: number;
  averageConfidence?: number;
  marketRegime?: "risk_on" | "risk_off" | "neutral";
}

export interface DynamicCapacityResult {
  effectiveMaxOpenTrades: number;
  dynamicModeEnabled: boolean;
  slotsAvailable: number;
  blockedReason: string | null;
  factors: string[];
}

export function resolveEffectiveMaxOpenTrades(input: DynamicCapacityInput): DynamicCapacityResult {
  const fixed = input.fixedMaxOpenTrades ?? SCANNER_CONFIG.maxOpenTrades;
  const factors: string[] = [];

  if (!PAPER_RISK_CONFIG.dynamicTradeLimit) {
    return {
      effectiveMaxOpenTrades: fixed,
      dynamicModeEnabled: false,
      slotsAvailable: Math.max(0, fixed - input.openTradeCount),
      blockedReason: input.openTradeCount >= fixed ? "MAX_OPEN_TRADES_REACHED" : null,
      factors: ["Dynamic trade limit disabled — using fixed max"],
    };
  }

  let dynamicMax = fixed;
  factors.push(`Base max: ${fixed}`);

  const hq = input.highQualityOpportunityCount ?? 0;
  if (hq >= 2 && (input.averageConfidence ?? 0) >= 0.7) {
    dynamicMax += 1;
    factors.push("High-quality opportunities available — extra slot");
  }
  if (hq >= 4 && (input.averageConfidence ?? 0) >= 0.8) {
    dynamicMax += 1;
    factors.push("Multiple strong setups — risk-based capacity increased");
  }

  if ((input.dailyLossPct ?? 0) <= -PAPER_RISK_CONFIG.maxDailyLossPercent * 0.5) {
    dynamicMax = Math.max(1, dynamicMax - 2);
    factors.push("Daily loss approaching limit — reduced capacity");
  }

  if ((input.currentDrawdownPct ?? 0) >= 3) {
    dynamicMax = Math.max(1, dynamicMax - 1);
    factors.push("Drawdown elevated — reduced capacity");
  }

  if ((input.correlatedOpenCount ?? 0) >= PAPER_RISK_CONFIG.maxCorrelatedTrades) {
    dynamicMax = Math.max(1, dynamicMax - 1);
    factors.push("Correlated exposure limit reached");
  }

  if ((input.totalExposurePct ?? 0) >= PAPER_RISK_CONFIG.maxTotalExposurePercent) {
    dynamicMax = Math.max(0, input.openTradeCount);
    factors.push("Max total exposure reached");
  }

  if (input.marketRegime === "risk_off") {
    dynamicMax = Math.max(1, Math.floor(dynamicMax * 0.6));
    factors.push("Risk-off market regime");
  }

  const exposureCap = Math.floor(
    PAPER_RISK_CONFIG.maxTotalExposurePercent / PAPER_RISK_CONFIG.maxCapitalPerTradePercent,
  );
  dynamicMax = Math.min(dynamicMax, Math.max(fixed, exposureCap), fixed + 3);

  const slotsAvailable = Math.max(0, dynamicMax - input.openTradeCount);
  let blockedReason: string | null = null;
  if (slotsAvailable === 0) {
    blockedReason =
      (input.totalExposurePct ?? 0) >= PAPER_RISK_CONFIG.maxTotalExposurePercent
        ? "MAX_TOTAL_EXPOSURE_REACHED"
        : "DYNAMIC_CAPACITY_FULL";
  }

  return {
    effectiveMaxOpenTrades: dynamicMax,
    dynamicModeEnabled: true,
    slotsAvailable,
    blockedReason,
    factors,
  };
}

export function countCorrelatedTrades(
  openSymbols: string[],
  candidateBaseAsset: string,
): number {
  const majors = new Set(["BTC", "ETH", "SOL"]);
  const candidateIsMajor = majors.has(candidateBaseAsset);
  let count = 0;
  for (const sym of openSymbols) {
    const base = sym.split("/")[0] ?? sym;
    if (base === candidateBaseAsset) count++;
    else if (candidateIsMajor && majors.has(base)) count++;
    else if (!candidateIsMajor && !majors.has(base) && !majors.has(candidateBaseAsset)) count++;
  }
  return count;
}
