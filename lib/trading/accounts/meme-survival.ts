import type { TokenSecurity } from "@/lib/trading/data/types";
import type { TradePermissionOutcome } from "@/lib/trading/permission/types";

export type MemeGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface MemeSurvivalInput {
  symbol: string;
  security: TokenSecurity | null;
  exitLiquidityUsd: number;
  spreadBps: number;
  relativeVolume: number | null;
  holderConcentrationPct?: number | null;
  lpRiskScore?: number | null;
  fakeVolumeDetected?: boolean;
  mode: "MANUAL" | "AUTO" | "PAPER";
}

export interface MemeSurvivalResult {
  grade: MemeGrade;
  manualEligible: boolean;
  autoEligible: boolean;
  leverageAllowed: boolean;
  maxSizeBand: "MICRO" | "BLOCKED";
  exitSlippageMultiplier: number;
  blockReason: TradePermissionOutcome | null;
  reasonCodes: string[];
  evaluatedAt: string;
}

export function evaluateMemeSurvival(input: MemeSurvivalInput): MemeSurvivalResult {
  const reasonCodes: string[] = [];
  let grade: MemeGrade = "B";
  let blockReason: TradePermissionOutcome | null = null;

  if (!input.security) {
    grade = "C";
    reasonCodes.push("MISSING_SECURITY_DATA");
    if (input.mode === "AUTO") blockReason = "PROOF_REQUIRED";
  }

  if (input.security?.isHoneypot) {
    grade = "F";
    blockReason = "BLOCK" as TradePermissionOutcome;
    reasonCodes.push("HONEYPOT");
  }

  if (input.exitLiquidityUsd < 250_000) {
    grade = downgrade(grade);
    reasonCodes.push("WEAK_EXIT_LIQUIDITY");
    blockReason = "LIQUIDITY_TOO_LOW";
  }

  if (input.fakeVolumeDetected || (input.relativeVolume !== null && input.relativeVolume > 10)) {
    grade = downgrade(grade);
    reasonCodes.push("FAKE_VOLUME");
  }

  if ((input.holderConcentrationPct ?? 0) > 40) {
    grade = downgrade(grade);
    reasonCodes.push("HOLDER_CONCENTRATION");
  }

  if ((input.lpRiskScore ?? 0) > 70) {
    grade = downgrade(grade);
    reasonCodes.push("LP_RISK");
  }

  if (input.spreadBps > 30) {
    grade = downgrade(grade);
    blockReason = "SPREAD_TOO_WIDE";
  }

  const manualEligible = grade === "A+" || grade === "A" || grade === "B";
  const autoEligible = (grade === "A+" || grade === "A") && input.security !== null && !input.security.isHoneypot;

  if (grade === "C") {
    blockReason = blockReason ?? ("MANUAL_ONLY" as TradePermissionOutcome);
  }
  if (grade === "D" || grade === "F") {
    blockReason = blockReason ?? ("BLOCK" as TradePermissionOutcome);
  }

  return {
    grade,
    manualEligible,
    autoEligible,
    leverageAllowed: false,
    maxSizeBand: grade === "F" || grade === "D" ? "BLOCKED" : "MICRO",
    exitSlippageMultiplier: 2.5,
    blockReason: grade === "C" || grade === "D" || grade === "F" ? (blockReason ?? "BLOCK" as TradePermissionOutcome) : null,
    reasonCodes,
    evaluatedAt: new Date().toISOString(),
  };
}

function downgrade(g: MemeGrade): MemeGrade {
  const order: MemeGrade[] = ["A+", "A", "B", "C", "D", "F"];
  const i = order.indexOf(g);
  return order[Math.min(i + 1, order.length - 1)]!;
}
