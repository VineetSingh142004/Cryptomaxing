import type { ComputedFeatures } from "@/lib/trading/features/compute";
import type { NormalizedMarketSnapshot } from "@/lib/trading/data/types";

export type ScanDirection = "long" | "short" | "neutral";

export interface ExplosiveMoveScores {
  explosive_move_score: number;
  momentum_acceleration_score: number;
  volume_acceleration_score: number;
  volatility_expansion_score: number;
  breakout_score: number;
  order_book_pressure_score: number;
  fakeout_risk_score: number;
  late_entry_risk_score: number;
  time_to_target_estimate_minutes: number | null;
  upside_air_pocket_score: number;
  downside_wick_risk_score: number;
}

export interface ExplosiveMoveScanResult {
  symbol: string;
  direction: ScanDirection;
  scores: ExplosiveMoveScores;
  compositeScore: number;
  decision: "FAVOR" | "NEUTRAL" | "REJECT";
  rejectReasons: string[];
  signalFlags: string[];
  scannedAt: string;
}

export interface MicrostructureScores {
  bid_ask_imbalance_persistence: number;
  depth_change_score: number;
  liquidity_wall_movement: number;
  book_thinning_before_breakout: number;
  spoofing_suspicion: number;
  aggressive_pressure_score: number;
  spread_compression_score: number;
  absorption_score: number;
  stop_run_likelihood: number;
  exit_depth_quality: number;
  microstructure_edge_score: number;
}

export interface MicrostructureEdgeResult {
  symbol: string;
  direction: ScanDirection;
  scores: MicrostructureScores;
  tradeScoreModifier: number;
  decision: "SUPPORT" | "NEUTRAL" | "CONTRADICT" | "BLOCK";
  reasonCodes: string[];
  canTradeAlone: false;
  analyzedAt: string;
}

export interface ScanContext {
  snapshot: NormalizedMarketSnapshot;
  features: ComputedFeatures;
  direction?: ScanDirection;
  catalyst?: string | null;
  priorOrderBook?: NormalizedMarketSnapshot["orderBook"];
}
