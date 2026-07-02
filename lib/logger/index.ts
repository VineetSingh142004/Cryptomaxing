import pino from "pino";
import { env } from "@/lib/config/env";

const isDev = env.NODE_ENV === "development";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
  base: {
    app: env.APP_NAME,
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      "encryptedKey",
      "encryptedSecret",
      "apiKey",
      "apiSecret",
      "password",
      "token",
      "authorization",
      "*.encryptedKey",
      "*.encryptedSecret",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
