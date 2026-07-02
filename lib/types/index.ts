import type { TradingMode, AutoState } from "@prisma/client";
import type { AutoBlockReason } from "@/lib/config/constants";

export interface ModeResponse {
  current_mode: Lowercase<TradingMode>;
  paper_enabled: boolean;
  manual_enabled: boolean;
  auto_visible: boolean;
  auto_selected: boolean;
  auto_execution_enabled: boolean;
  auto_blocked_reason: AutoBlockReason | null;
  auto_state: Lowercase<AutoState>;
  last_changed_at: string;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  app: string;
  version: string;
  timestamp: string;
  checks: {
    database: {
      status: "ok" | "error";
      latencyMs?: number;
      message?: string;
    };
    redis: {
      status: "NOT_IMPLEMENTED";
      message: string;
    };
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
}

export type SetModeRequest = {
  mode: "paper" | "manual" | "auto";
  emergency_pause?: boolean;
};
