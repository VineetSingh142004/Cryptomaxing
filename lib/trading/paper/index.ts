export const PAPER_ENGINE_STATUS = "ACTIVE" as const;

export * from "@/lib/trading/paper/types";
export {
  openPaperTrade,
  closePaperTrade,
  summarizePaperDay,
  PAPER_FORWARD_STATUS,
} from "@/lib/trading/paper/forward-tracker";
export { runPaperBrokerSession, PAPER_BROKER_STATUS } from "@/lib/trading/paper/broker";
export type { OpenPaperTradeInput, ClosePaperTradeInput } from "@/lib/trading/paper/forward-tracker";
export type { PaperBrokerInput, PaperBrokerSession } from "@/lib/trading/paper/broker";
