import { DEFAULT_FEE_MODEL } from "@/lib/trading/research/cost-model";

export interface PaperBrokerRealismStatus {
  makerTakerFees: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  spread: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  entrySlippage: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  exitSlippage: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  stopSlippage: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  missedFills: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  partialFills: "NOT_IMPLEMENTED";
  staleDataPenalty: "PARTIAL";
  minOrderSize: "NOT_IMPLEMENTED";
  failedOrder: "NOT_IMPLEMENTED";
  emergencyExitSlippage: "PARTIAL";
  exchangeRejection: "NOT_IMPLEMENTED";
  latency: "NOT_IMPLEMENTED";
  liquidityDecay: "NOT_IMPLEMENTED";
  badFills: "PARTIAL";
  funding: "PARTIAL";
  feeModelSource: string;
  simulatedLabel: "SIMULATED_PAPER_ONLY";
  summary: string;
}

export function buildPaperBrokerRealismStatus(): PaperBrokerRealismStatus {
  const status: PaperBrokerRealismStatus = {
    makerTakerFees: "IMPLEMENTED",
    spread: "IMPLEMENTED",
    entrySlippage: "IMPLEMENTED",
    exitSlippage: "IMPLEMENTED",
    stopSlippage: DEFAULT_FEE_MODEL.stopSlippageBps ? "IMPLEMENTED" : "NOT_IMPLEMENTED",
    missedFills: DEFAULT_FEE_MODEL.missedFillRate ? "IMPLEMENTED" : "NOT_IMPLEMENTED",
    partialFills: "NOT_IMPLEMENTED",
    staleDataPenalty: "PARTIAL",
    minOrderSize: "NOT_IMPLEMENTED",
    failedOrder: "NOT_IMPLEMENTED",
    emergencyExitSlippage: "PARTIAL",
    exchangeRejection: "NOT_IMPLEMENTED",
    latency: "NOT_IMPLEMENTED",
    liquidityDecay: "NOT_IMPLEMENTED",
    badFills: "PARTIAL",
    funding: DEFAULT_FEE_MODEL.fundingBpsPer8h ? "PARTIAL" : "NOT_IMPLEMENTED",
    feeModelSource: DEFAULT_FEE_MODEL.source ?? "unknown",
    simulatedLabel: "SIMULATED_PAPER_ONLY",
    summary:
      "Paper uses cost-model fees/spread/slippage/stop slippage. Partial fills, latency, exchange rejection marked NOT_IMPLEMENTED — not faked.",
  };
  return status;
}
