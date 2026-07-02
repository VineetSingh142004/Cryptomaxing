export const SHADOW_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/shadow/types";
export { createShadowTrade, closeShadowTrade, validateRealtimeSignal } from "@/lib/trading/shadow/engine";
