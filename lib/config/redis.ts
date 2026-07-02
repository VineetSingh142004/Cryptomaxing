import { env } from "@/lib/config/env";

export const REDIS_CONFIG = {
  url: env.REDIS_URL ?? "redis://localhost:6379",
  /** Connection status — NOT_IMPLEMENTED until Redis client is wired in Prompt 2+ */
  status: "NOT_IMPLEMENTED" as const,
} as const;

export function getRedisConnectionInfo(): {
  url: string;
  status: "NOT_IMPLEMENTED";
  message: string;
} {
  return {
    url: REDIS_CONFIG.url.replace(/\/\/.*@/, "//***@"),
    status: "NOT_IMPLEMENTED",
    message: "Redis client not connected. Queue and cache features are disabled.",
  };
}
