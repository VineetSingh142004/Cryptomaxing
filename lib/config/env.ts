import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("Alpha Autopilot"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ENCRYPTION_KEY: z.string().optional(),
  APP_MODE: z.enum(["local", "production"]).optional(),
  LOCAL_OWNER_MODE: z.enum(["true", "false"]).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  MARKET_DATA_PROVIDER: z.enum(["kraken", "coingecko", "none"]).optional(),
  COINGECKO_API_KEY: z.string().optional(),
  DEXSCREENER_ENABLED: z.enum(["true", "false"]).optional(),
  DEFILLAMA_ENABLED: z.enum(["true", "false"]).optional(),
  LUNARCRUSH_API_KEY: z.string().optional(),
  LUNARCRUSH_ENABLED: z.enum(["true", "false"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    const message = Object.entries(formatted)
      .map(([key, errors]) => `${key}: ${errors?.join(", ")}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export function isSupabaseConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
