import { prisma } from "@/lib/db/client";

export const STALE_PRISMA_MESSAGE =
  "Prisma client is stale after schema changes. Stop dev server, run npm.cmd run db:generate, then restart.";

let lastDbWriteError: string | null = null;
let lastModelAccessError: string | null = null;
let lastSuccessfulDbWriteAt: string | null = null;

export function recordPaperDbWriteError(message: string): void {
  lastDbWriteError = message;
}

export function recordPaperModelAccessError(message: string): void {
  lastModelAccessError = message;
}

export function recordPaperSuccessfulWrite(): void {
  lastSuccessfulDbWriteAt = new Date().toISOString();
  lastDbWriteError = null;
  lastModelAccessError = null;
}

export function getLastSuccessfulDbWriteAt(): string | null {
  return lastSuccessfulDbWriteAt;
}

export function clearPaperPrismaErrors(): void {
  lastDbWriteError = null;
  lastModelAccessError = null;
}

/** True only for Prisma client/schema mismatch — not data validation errors. */
export function isPrismaStaleError(message: string): boolean {
  if (
    message.includes("Not a valid Decimal") ||
    message.includes("Invalid value for argument") ||
    message.includes("Expected ") ||
    /Argument `\w+` is missing/i.test(message)
  ) {
    return false;
  }
  return (
    message.includes("Unknown arg") ||
    message.includes("Unknown field") ||
    message.includes("P2022") ||
    /column\s+[`'"][\w.]+[`'"]\s+does not exist/i.test(message) ||
    /The column `[\w.]+` does not exist/i.test(message) ||
    /table\s+[`'"]?public\.\w+[`'"]?\s+does not exist/i.test(message)
  );
}

const PAPER_MODEL_DELEGATES = [
  "paperEvidenceRun",
  "paperScanCandidate",
  "paperMissedOpportunity",
  "paperRotationEvent",
  "paperTradeSnapshot",
  "paperSignal",
  "paperTrade",
] as const;

export async function checkPaperPrismaClientHealth(): Promise<{
  prismaClientLooksCurrent: boolean;
  newPaperModelsAvailable: boolean;
  latestDbWriteError: string | null;
  latestModelAccessError: string | null;
  lastSuccessfulDbWriteAt: string | null;
}> {
  const access = await confirmPaperModelsAccessible();
  return {
    prismaClientLooksCurrent: access.ok,
    newPaperModelsAvailable: access.ok,
    latestDbWriteError: lastDbWriteError,
    latestModelAccessError: access.stalePrismaReason ?? lastModelAccessError,
    lastSuccessfulDbWriteAt,
  };
}

/** Probe new schema fields — count() alone misses stale-client field mismatches. */
export async function confirmPaperModelsAccessible(): Promise<{
  ok: boolean;
  stalePrismaDetectedNow: boolean;
  stalePrismaReason: string | null;
}> {
  try {
    await prisma.paperEvidenceRun.findFirst({
      select: {
        id: true,
        reasonCode: true,
        candidatesStored: true,
        signalsStored: true,
        snapshotsStored: true,
        maxOpenTradesReached: true,
        runWarnings: true,
        runErrors: true,
      },
    });
    await prisma.paperScanCandidate.findFirst({
      select: { id: true, opportunityScore: true, reasonCode: true },
    });
    await prisma.paperMissedOpportunity.findFirst({
      select: { id: true, symbol: true, reason: true },
    });
    await prisma.paperRotationEvent.findFirst({
      select: { id: true, rotatedOutSymbol: true, rotatedInSymbol: true },
    });
    await prisma.paperTradeSnapshot.findFirst({
      select: { id: true, markPrice: true, unrealizedPnl: true },
    });
    clearPaperPrismaErrors();
    return { ok: true, stalePrismaDetectedNow: false, stalePrismaReason: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isPrismaStaleError(msg)) {
      recordPaperModelAccessError(msg);
      return { ok: false, stalePrismaDetectedNow: true, stalePrismaReason: msg };
    }
    return { ok: true, stalePrismaDetectedNow: false, stalePrismaReason: null };
  }
}

export async function verifyPaperDelegateCounts(): Promise<boolean> {
  for (const model of PAPER_MODEL_DELEGATES) {
    const delegate = (prisma as Record<string, { count?: () => Promise<number> }>)[model];
    if (!delegate?.count) return false;
    try {
      await delegate.count();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isPrismaStaleError(msg)) return false;
    }
  }
  return true;
}
