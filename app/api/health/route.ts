import { NextResponse } from "next/server";
import { APP_NAME, APP_VERSION } from "@/lib/config/constants";
import { getRedisConnectionInfo } from "@/lib/config/redis";
import { checkDatabaseConnection } from "@/lib/db/client";
import { writeAuditLog } from "@/lib/logger/audit";
import type { HealthResponse } from "@/lib/types";

export async function GET() {
  const [dbCheck, redisInfo] = await Promise.all([
    checkDatabaseConnection(),
    Promise.resolve(getRedisConnectionInfo()),
  ]);

  const response: HealthResponse = {
    status: dbCheck.status === "ok" ? "degraded" : "error",
    app: APP_NAME,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      redis: {
        status: "NOT_IMPLEMENTED",
        message: redisInfo.message,
      },
    },
  };

  await writeAuditLog({
    action: "HEALTH_CHECK",
    reasonCode: response.status,
    detail: { database: dbCheck.status, redis: "NOT_IMPLEMENTED" },
  });

  return NextResponse.json(response, {
    status: dbCheck.status === "ok" ? 200 : 503,
  });
}
