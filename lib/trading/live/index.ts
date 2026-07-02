export const LIVE_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/live/types";
export { auditLiveProfitability } from "@/lib/trading/live/profitability-audit";
export { analyzeSampleConfidence, STAGE_ORDER } from "@/lib/trading/live/sample-confidence";
export { evaluateCanaryScaling, autoScaleDownTriggers, RISK_BANDS } from "@/lib/trading/live/canary-scaling";
export { reconcileLiveAccounts } from "@/lib/trading/live/reconciliation";
export { analyzeForwardDecay } from "@/lib/trading/live/decay";
export {
  persistLiveProfitabilityAudit,
  persistLiveSampleSizeAudit,
  persistCanaryScalingEvent,
  persistReconciliationEvent,
  persistEdgeDecayEvent,
  persistProfitAttributionReport,
} from "@/lib/trading/live/store";
