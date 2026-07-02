import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

if (process.env.NODE_ENV === "development") {
  prisma.$on("query" as never, (event: { query: string; duration: number }) => {
    logger.debug({ query: event.query, durationMs: event.duration }, "Prisma query");
  });
}

export async function checkDatabaseConnection(): Promise<{
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Database connection failed",
    };
  }
}
